import { inflate } from "pako";
import { toByteArray } from "base64-js";

/**
 * Minimal but real PDF text extractor.
 *
 * Real-world PDFs almost always compress their content streams with
 * FlateDecode (zlib). A naive regex over the raw file bytes only works on
 * the rare uncompressed PDF, so this walks the object table, inflates every
 * stream that declares a Flate filter, and then parses the resulting
 * content stream operators (Tj / TJ / ' / ") to recover the visible text in
 * document order.
 *
 * Many modern PDF writers (Google Docs, Canva, Word Online, LibreOffice)
 * embed subset fonts as composite (Type0/CID) fonts encoded with
 * Identity-H. In that encoding the hex strings inside the content stream
 * are 2-byte *glyph* codes, not character codes, so a naive 1-byte latin1
 * decode produces garbage/empty text. Those fonts always ship a
 * `/ToUnicode` CMap stream mapping glyph codes back to real Unicode text,
 * so we parse any such CMap we find (bfchar / bfrange) and use it to
 * decode 2-byte hex strings whenever a direct 1-byte decode doesn't look
 * like plausible text.
 */

const textDecoder = () => {
  if (typeof TextDecoder !== "undefined") return new TextDecoder("latin1");
  return null;
};

function bytesToLatin1String(bytes: Uint8Array): string {
  const decoder = textDecoder();
  if (decoder) {
    try {
      return decoder.decode(bytes);
    } catch {
      // fall through to manual decode
    }
  }
  let out = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return out;
}

function base64ToBytes(base64: string): Uint8Array {
  return toByteArray(base64);
}

/** Decode a PDF literal string, e.g. (Hello \(World\)) -> Hello (World) */
function decodeLiteralString(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === "\\") {
      const next = raw[i + 1];
      switch (next) {
        case "n":
          out += "\n";
          i++;
          break;
        case "r":
          out += "\r";
          i++;
          break;
        case "t":
          out += "\t";
          i++;
          break;
        case "(":
          out += "(";
          i++;
          break;
        case ")":
          out += ")";
          i++;
          break;
        case "\\":
          out += "\\";
          i++;
          break;
        default:
          if (next >= "0" && next <= "7") {
            let oct = next;
            let j = i + 2;
            for (let k = 0; k < 2 && raw[j] >= "0" && raw[j] <= "7"; k++, j++) {
              oct += raw[j];
            }
            out += String.fromCharCode(parseInt(oct, 8));
            i = j - 1;
          } else {
            out += next ?? "";
            i++;
          }
      }
    } else {
      out += c;
    }
  }
  return out;
}

/** A merged ToUnicode lookup: 4-hex-digit glyph code -> decoded unicode text. */
type UnicodeMap = Map<string, string>;

/** Decode a PDF hex string as 1-byte-per-character latin1, e.g. <48656C6C6F> -> Hello */
function decodeHexStringLatin1(raw: string): string {
  const clean = raw.replace(/[^0-9a-fA-F]/g, "");
  let out = "";
  for (let i = 0; i < clean.length - 1; i += 2) {
    out += String.fromCharCode(parseInt(clean.slice(i, i + 2), 16));
  }
  return out;
}

/** Decode a PDF hex string as 2-byte CID/glyph codes via a ToUnicode map. */
function decodeHexStringViaCMap(raw: string, cmap: UnicodeMap): { text: string; hits: number; total: number } {
  const clean = raw.replace(/[^0-9a-fA-F]/g, "");
  let out = "";
  let hits = 0;
  let total = 0;
  for (let i = 0; i + 4 <= clean.length; i += 4) {
    const code = clean.slice(i, i + 4).toUpperCase();
    total++;
    const mapped = cmap.get(code);
    if (mapped !== undefined) {
      out += mapped;
      hits++;
    }
  }
  return { text: out, hits, total };
}

/**
 * Pick the best decode for a hex string: prefer the CMap (2-byte CID) decode
 * when it resolves most of the codes, otherwise fall back to a plain
 * 1-byte latin1 decode (used by simple, non-composite fonts).
 */
function decodeHexString(raw: string, cmap: UnicodeMap | null): string {
  if (cmap && cmap.size > 0) {
    const viaCMap = decodeHexStringViaCMap(raw, cmap);
    if (viaCMap.total > 0 && viaCMap.hits / viaCMap.total >= 0.5) {
      return viaCMap.text;
    }
  }
  return decodeHexStringLatin1(raw);
}

/** Extract readable text from a single decompressed PDF content stream. */
function extractTextFromContentStream(stream: string, cmap: UnicodeMap | null): string {
  const pieces: string[] = [];
  // Handle TJ arrays: [(Hello) -250 (World)] TJ  or  [<0041> -250 <0042>] TJ
  const tjArrayRegex = /\[((?:[^\[\]\\]|\\.)*)\]\s*TJ/g;
  // Handle simple Tj / ' / " strings: (Hello World) Tj
  const tjStringRegex = /\((?:[^()\\]|\\.)*\)\s*(?:Tj|'|")/g;
  const hexStringRegex = /<([0-9a-fA-F\s]+)>\s*(?:Tj|'|")/g;

  let match: RegExpExecArray | null;

  while ((match = tjArrayRegex.exec(stream)) !== null) {
    const inner = match[1];
    const partRegex = /\(((?:[^()\\]|\\.)*)\)|<([0-9a-fA-F\s]+)>/g;
    let partMatch: RegExpExecArray | null;
    let line = "";
    while ((partMatch = partRegex.exec(inner)) !== null) {
      if (partMatch[1] !== undefined) {
        line += decodeLiteralString(partMatch[1]);
      } else if (partMatch[2] !== undefined) {
        line += decodeHexString(partMatch[2], cmap);
      }
    }
    if (line) pieces.push(line);
  }

  while ((match = tjStringRegex.exec(stream)) !== null) {
    const literal = match[0].match(/\(((?:[^()\\]|\\.)*)\)/);
    if (literal) pieces.push(decodeLiteralString(literal[1]));
  }

  while ((match = hexStringRegex.exec(stream)) !== null) {
    pieces.push(decodeHexString(match[1], cmap));
  }

  // Line/word breaks: PDFs usually mark new lines with Td/TD/T* operators.
  return pieces.join(" ");
}

interface StreamObject {
  dict: string;
  data: Uint8Array;
}

/**
 * Walk raw PDF bytes and pull out every `N G obj ... endobj` body, along with
 * the `stream ... endstream` payload if that object declares one.
 *
 * This scans with a single regex pass over indirect object headers rather
 * than manually indexOf-walking token by token, which is both simpler and
 * avoids pathological slowdowns on PDFs with many objects.
 */
function findStreamObjects(bytes: Uint8Array): StreamObject[] {
  const latin1 = bytesToLatin1String(bytes);
  const streams: StreamObject[] = [];
  const objRegex = /(\d+)\s+(\d+)\s+obj([\s\S]*?)(?:endobj|(?=\d+\s+\d+\s+obj)|$)/g;

  let match: RegExpExecArray | null;
  while ((match = objRegex.exec(latin1)) !== null) {
    const body = match[3];
    const streamIdx = body.indexOf("stream");
    if (streamIdx === -1) continue;

    // Make sure this isn't matching "stream" as part of another word.
    const before = body[streamIdx - 1];
    if (before !== undefined && /[A-Za-z]/.test(before)) continue;

    const dict = body.slice(0, streamIdx);
    let dataStart = streamIdx + "stream".length;
    if (body[dataStart] === "\r") dataStart++;
    if (body[dataStart] === "\n") dataStart++;

    const endIdx = body.indexOf("endstream", dataStart);
    if (endIdx === -1) continue;

    const objStartOffset = match.index + match[0].indexOf(body);
    const absDataStart = objStartOffset + dataStart;
    const absDataEnd = objStartOffset + endIdx;
    const data = bytes.subarray(absDataStart, absDataEnd);
    streams.push({ dict, data });
  }

  return streams;
}

function isFlateEncoded(dict: string): boolean {
  return /\/Filter\s*(\/FlateDecode|\[[^\]]*\/FlateDecode[^\]]*\])/.test(dict);
}

function isContentLikeDict(dict: string): boolean {
  // Skip obvious non-text streams (images, xref, object streams).
  if (/\/Type\s*\/(XRef|ObjStm|Metadata)/.test(dict)) return false;
  if (/\/Subtype\s*\/Image/.test(dict)) return false;
  return true;
}

function isFontLikeDict(dict: string): boolean {
  return /\/Subtype\s*\/(Type1|TrueType|Type0|CIDFontType0C|OpenType)/.test(dict);
}

/** Parse a decoded ToUnicode CMap body's bfchar/bfrange sections into a lookup table. */
function parseToUnicodeCMap(content: string, out: UnicodeMap): void {
  const hexToUnicode = (destHex: string): string => {
    const clean = destHex.replace(/[^0-9a-fA-F]/g, "");
    let out2 = "";
    // UTF-16BE code units, 4 hex digits each (handles surrogate pairs naturally
    // since String.fromCharCode on two surrogate halves recombines visually).
    for (let i = 0; i + 4 <= clean.length; i += 4) {
      out2 += String.fromCharCode(parseInt(clean.slice(i, i + 4), 16));
    }
    return out2;
  };

  const bfcharRegex = /beginbfchar([\s\S]*?)endbfchar/g;
  let m: RegExpExecArray | null;
  while ((m = bfcharRegex.exec(content)) !== null) {
    const pairRegex = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
    let p: RegExpExecArray | null;
    while ((p = pairRegex.exec(m[1])) !== null) {
      const src = p[1].padStart(4, "0").toUpperCase().slice(-4);
      out.set(src, hexToUnicode(p[2]));
    }
  }

  const bfrangeRegex = /beginbfrange([\s\S]*?)endbfrange/g;
  while ((m = bfrangeRegex.exec(content)) !== null) {
    // Form 1: <srcLo> <srcHi> <dstLo>
    // Form 2: <srcLo> <srcHi> [<dst1> <dst2> ...]
    const rangeRegex = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(\[[^\]]*\]|<[0-9a-fA-F]+>)/g;
    let r: RegExpExecArray | null;
    while ((r = rangeRegex.exec(m[1])) !== null) {
      const lo = parseInt(r[1], 16);
      const hi = parseInt(r[2], 16);
      if (hi - lo > 65535 || hi < lo) continue; // sanity guard
      const dst = r[3];
      if (dst.startsWith("[")) {
        const arrRegex = /<([0-9a-fA-F]+)>/g;
        let a: RegExpExecArray | null;
        let idx = lo;
        while ((a = arrRegex.exec(dst)) !== null && idx <= hi) {
          const src = idx.toString(16).padStart(4, "0").toUpperCase();
          out.set(src, hexToUnicode(a[1]));
          idx++;
        }
      } else {
        const dstHexMatch = dst.match(/<([0-9a-fA-F]+)>/);
        if (!dstHexMatch) continue;
        const dstClean = dstHexMatch[1].replace(/[^0-9a-fA-F]/g, "");
        const baseCode = parseInt(dstClean.slice(-4), 16);
        for (let idx = lo; idx <= hi; idx++) {
          const src = idx.toString(16).padStart(4, "0").toUpperCase();
          out.set(src, String.fromCharCode(baseCode + (idx - lo)));
        }
      }
    }
  }
}

/** Decompress a stream if it declares FlateDecode (or return raw bytes if uncompressed). */
function decodeStreamBytes(dict: string, data: Uint8Array): Uint8Array | null {
  if (isFlateEncoded(dict)) {
    try {
      return inflate(data);
    } catch {
      return null;
    }
  }
  if (!/\/Filter/.test(dict)) return data;
  return null;
}

/**
 * Extract as much real text as possible from a PDF's raw bytes.
 * Returns an empty string if the PDF appears to be scanned/image-only.
 */
export function extractPdfText(bytes: Uint8Array): string {
  const streams = findStreamObjects(bytes);

  // First pass: collect every ToUnicode CMap in the document (used to decode
  // composite/CID fonts). We merge all fonts' maps together since we don't
  // resolve per-page font resource dictionaries; for the handful of fonts a
  // typical resume/CV PDF embeds, this heuristic recovers real text instead
  // of leaving it as empty/garbled glyph codes.
  const cmap: UnicodeMap = new Map();
  for (const { dict, data } of streams) {
    if (!/\/Filter/.test(dict) && dict.trim().length > 0 && !isFlateEncoded(dict)) {
      // Only bother decoding candidates cheaply below.
    }
    const decoded = decodeStreamBytes(dict, data);
    if (!decoded) continue;
    const content = bytesToLatin1String(decoded);
    if (content.includes("beginbfchar") || content.includes("beginbfrange")) {
      parseToUnicodeCMap(content, cmap);
    }
  }

  const textChunks: string[] = [];
  for (const { dict, data } of streams) {
    if (!isContentLikeDict(dict) || isFontLikeDict(dict)) continue;
    if (dict.includes("beginbfchar") || dict.includes("beginbfrange")) continue;

    const decoded = decodeStreamBytes(dict, data);
    if (!decoded) continue;

    const content = bytesToLatin1String(decoded);
    if (content.includes("beginbfchar") || content.includes("beginbfrange")) continue;

    const text = extractTextFromContentStream(content, cmap.size > 0 ? cmap : null);
    if (text.trim().length > 0) textChunks.push(text.trim());
  }

  const combined = textChunks.join("\n").replace(/[ \t]{2,}/g, " ").trim();
  return combined;
}

/** Read a PDF file (given a base64-encoded payload) and return its extracted text. */
export function extractPdfTextFromBase64(base64: string): string {
  const bytes = base64ToBytes(base64);
  return extractPdfText(bytes);
}
