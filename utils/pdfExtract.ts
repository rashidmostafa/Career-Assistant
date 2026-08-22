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

// React Native's built-in TextDecoder (Hermes) only implements the "utf-8"
// label and throws a RangeError for anything else, including the
// WHATWG-legal "latin1"/"windows-1252" alias we need here — so probe for
// support once (constructing it is what throws, not just decode()) and
// cache the result instead of trying and failing on every single call.
let latin1Decoder: TextDecoder | null | undefined;
function getLatin1Decoder(): TextDecoder | null {
  if (latin1Decoder !== undefined) return latin1Decoder;
  try {
    latin1Decoder = typeof TextDecoder !== "undefined" ? new TextDecoder("latin1") : null;
  } catch {
    latin1Decoder = null;
  }
  return latin1Decoder;
}

function bytesToLatin1String(bytes: Uint8Array): string {
  const decoder = getLatin1Decoder();
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

/**
 * Decode a PDF literal string, e.g. (Hello \(World\)) -> Hello (World).
 * When a ToUnicode CMap is available, also try mapping each raw byte
 * through it (subsetted simple fonts use custom 1-byte codes that only
 * resolve to real characters via their font's CMap) and prefer that
 * decode when it resolves most of the bytes.
 */
function decodeLiteralString(raw: string, cmap: UnicodeMap | null = null): string {
  const plain = decodeLiteralStringRaw(raw);
  if (cmap && cmap.size > 0) {
    let out = "";
    let hits = 0;
    for (let i = 0; i < plain.length; i++) {
      const code = plain.charCodeAt(i).toString(16).padStart(4, "0").toUpperCase();
      const mapped = cmap.get(code);
      if (mapped !== undefined) {
        out += mapped;
        hits++;
      } else {
        out += plain[i];
      }
    }
    if (plain.length > 0 && hits / plain.length >= 0.5) return out;
  }
  return plain;
}

function decodeLiteralStringRaw(raw: string): string {
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

/**
 * Decode a PDF hex string as fixed-width glyph codes via a ToUnicode map.
 * `bytesPerCode` is 2 for composite/CID (Type0, e.g. Identity-H) fonts, or 1
 * for simple fonts (Type1/TrueType) — both kinds may ship a ToUnicode CMap,
 * and the source-code width is only knowable by matching against the map.
 */
function decodeHexStringViaCMap(
  raw: string,
  cmap: UnicodeMap,
  bytesPerCode: 1 | 2
): { text: string; hits: number; total: number } {
  const clean = raw.replace(/[^0-9a-fA-F]/g, "");
  const step = bytesPerCode * 2;
  let out = "";
  let hits = 0;
  let total = 0;
  for (let i = 0; i + step <= clean.length; i += step) {
    const code = clean.slice(i, i + step).padStart(4, "0").toUpperCase();
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
 * Pick the best decode for a hex string. A ToUnicode CMap may key its glyph
 * codes as 1 byte (simple Type1/TrueType fonts) or 2 bytes (composite/CID
 * Type0 fonts, e.g. Identity-H) — try both widths and keep whichever
 * resolves the most codes, otherwise fall back to a plain 1-byte latin1
 * decode (used by simple fonts with a standard/WinAnsi encoding and no
 * ToUnicode map at all).
 */
function decodeHexString(raw: string, cmap: UnicodeMap | null): string {
  if (cmap && cmap.size > 0) {
    const via2Byte = decodeHexStringViaCMap(raw, cmap, 2);
    const via1Byte = decodeHexStringViaCMap(raw, cmap, 1);
    const ratio2 = via2Byte.total > 0 ? via2Byte.hits / via2Byte.total : 0;
    const ratio1 = via1Byte.total > 0 ? via1Byte.hits / via1Byte.total : 0;
    if (ratio1 >= 0.5 || ratio2 >= 0.5) {
      return ratio1 >= ratio2 ? via1Byte.text : via2Byte.text;
    }
  }
  return decodeHexStringLatin1(raw);
}

/**
 * Extract readable text from a single decompressed PDF content stream.
 *
 * A page's content stream can select a different font mid-stream via the
 * `/Name size Tf` operator, and each font may carry its own independent
 * ToUnicode CMap (subsetted fonts commonly restart glyph numbering from 1,
 * so a header font's code 0x01 and a body font's code 0x01 mean different
 * characters). We scan the stream as one ordered token pass — rather than
 * three independent regex passes over TJ/Tj/hex operators, which would
 * lose the interleaved Tf switches — and swap the active CMap every time a
 * Tf operator is seen, resolved via `fontCMaps` (resource name -> that
 * font's CMap). `fallbackCmap` (the merged CMap of every font in the
 * document) is used whenever the active font can't be resolved.
 */
function extractTextFromContentStream(
  stream: string,
  fallbackCmap: UnicodeMap | null,
  fontCMaps: Map<string, UnicodeMap>
): string {
  const pieces: string[] = [];
  let currentCmap: UnicodeMap | null = fallbackCmap;

  // Alternatives, tried in order at each position: font selection, a TJ
  // array, a literal-string Tj/'/" , or a hex-string Tj/'/".
  const tokenRegex =
    /\/([A-Za-z0-9#+._-]+)\s+[-\d.]+\s+Tf|\[((?:[^\[\]\\]|\\.)*)\]\s*TJ|\(((?:[^()\\]|\\.)*)\)\s*(?:Tj|'|")|<([0-9a-fA-F\s]+)>\s*(?:Tj|'|")/g;

  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(stream)) !== null) {
    if (match[1] !== undefined) {
      const fontCmap = fontCMaps.get(match[1]);
      currentCmap = fontCmap && fontCmap.size > 0 ? fontCmap : fallbackCmap;
      continue;
    }

    if (match[2] !== undefined) {
      const inner = match[2];
      // TJ arrays interleave shown strings with bare numbers that nudge the
      // pen (kerning): [(Hello)-278(World)]TJ. Many PDF writers use that gap
      // as the ONLY thing separating two words — there's no literal space
      // character anywhere in the string — so a sufficiently large negative
      // adjustment (letter-pair kerning is rarely beyond -100 in practice;
      // an actual word-space glyph is typically -150 to -400) must be
      // rendered back as a space or words silently run together.
      const partRegex = /\(((?:[^()\\]|\\.)*)\)|<([0-9a-fA-F\s]+)>|(-?\d+(?:\.\d+)?)/g;
      let partMatch: RegExpExecArray | null;
      let line = "";
      while ((partMatch = partRegex.exec(inner)) !== null) {
        if (partMatch[1] !== undefined) {
          line += decodeLiteralString(partMatch[1], currentCmap);
        } else if (partMatch[2] !== undefined) {
          line += decodeHexString(partMatch[2], currentCmap);
        } else if (partMatch[3] !== undefined) {
          const gap = parseFloat(partMatch[3]);
          if (gap <= -150 && line.length > 0 && !line.endsWith(" ")) line += " ";
        }
      }
      if (line) pieces.push(line);
      continue;
    }

    if (match[3] !== undefined) {
      pieces.push(decodeLiteralString(match[3], currentCmap));
      continue;
    }

    if (match[4] !== undefined) {
      pieces.push(decodeHexString(match[4], currentCmap));
    }
  }

  // Line/word breaks: PDFs usually mark new lines with Td/TD/T* operators.
  return pieces.join(" ");
}

interface StreamObject {
  num: number;
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
    streams.push({ num: parseInt(match[1], 10), dict, data });
  }

  return streams;
}

/**
 * Walk raw PDF bytes and pull out every indirect object's dictionary body
 * (non-stream objects too — Font dicts, Font-resource maps, Resources
 * dicts), keyed by object number. Used to resolve which ToUnicode CMap
 * belongs to which `/Name ... Tf` resource name.
 */
function findAllObjectDicts(bytes: Uint8Array): Map<number, string> {
  const latin1 = bytesToLatin1String(bytes);
  const objects = new Map<number, string>();
  const objRegex = /(\d+)\s+(\d+)\s+obj([\s\S]*?)(?:endobj|(?=\d+\s+\d+\s+obj)|$)/g;

  let match: RegExpExecArray | null;
  while ((match = objRegex.exec(latin1)) !== null) {
    let body = match[3];
    const streamIdx = body.indexOf("stream");
    if (streamIdx !== -1) {
      const before = body[streamIdx - 1];
      if (before === undefined || !/[A-Za-z]/.test(before)) {
        body = body.slice(0, streamIdx);
      }
    }
    objects.set(parseInt(match[1], 10), body);
  }
  return objects;
}

/**
 * Resolve a `/Name ... Tf` resource name (e.g. "F1") to the ToUnicode CMap
 * of the actual font it refers to. Font resource dicts (e.g.
 * `20 0 obj <</F1 19 0 R/F2 22 0 R>> endobj`) are found heuristically: any
 * object whose body consists solely of `/Name N 0 R` entries where at
 * least one referenced object is itself a `/Type/Font` dict. This avoids
 * needing full Page -> Resources tree resolution, which is unnecessary for
 * the single/few-page documents this parser targets (resumes/CVs).
 */
function buildFontCMaps(
  objects: Map<number, string>,
  streamsByNum: Map<number, StreamObject>
): Map<string, UnicodeMap> {
  const fontUnicodeMaps = new Map<number, UnicodeMap>();
  for (const [num, dict] of objects) {
    if (!/\/Type\s*\/Font\b/.test(dict)) continue;
    const toUnicodeMatch = dict.match(/\/ToUnicode\s+(\d+)\s+\d+\s+R/);
    if (!toUnicodeMatch) continue;
    const stream = streamsByNum.get(parseInt(toUnicodeMatch[1], 10));
    if (!stream) continue;
    const decoded = decodeStreamBytes(stream.dict, stream.data);
    if (!decoded) continue;
    const content = bytesToLatin1String(decoded);
    const map: UnicodeMap = new Map();
    parseToUnicodeCMap(content, map);
    if (map.size > 0) fontUnicodeMaps.set(num, map);
  }

  const resourceNameToCMap = new Map<string, UnicodeMap>();
  const refEntryRegex = /\/([A-Za-z0-9#+._-]+)\s+(\d+)\s+\d+\s+R/g;
  const applyFontMapBody = (body: string) => {
    let m: RegExpExecArray | null;
    refEntryRegex.lastIndex = 0;
    while ((m = refEntryRegex.exec(body)) !== null) {
      const map = fontUnicodeMaps.get(parseInt(m[2], 10));
      if (map) resourceNameToCMap.set(m[1], map);
    }
  };
  // A page's /Resources dict is often ONE object combining several resource
  // categories, and its `/Font` entry itself shows up in two different
  // shapes depending on the PDF writer:
  //  - inline:   /Font<</F1 5 0 R/F2 6 0 R>>            (e.g. pdftex)
  //  - indirect: /Font 28 0 R, with object 28 holding    (e.g. LibreOffice)
  //              the actual <</F1 27 0 R/F2 17 0 R>> map
  // Font dicts don't nest further, so a non-greedy match up to the first
  // `>>` is safe for the inline case.
  const fontKeyRegex = /\/Font\s*(?:<<([^>]*)>>|(\d+)\s+\d+\s+R)/g;
  for (const [, dict] of objects) {
    let subMatch: RegExpExecArray | null;
    fontKeyRegex.lastIndex = 0;
    while ((subMatch = fontKeyRegex.exec(dict)) !== null) {
      if (subMatch[1] !== undefined) {
        applyFontMapBody(subMatch[1]);
      } else if (subMatch[2] !== undefined) {
        const target = objects.get(parseInt(subMatch[2], 10));
        if (target) applyFontMapBody(target);
      }
    }
  }

  return resourceNameToCMap;
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
  const streamsByNum = new Map(streams.map((s) => [s.num, s] as const));

  // Resolve each `/Name ... Tf` resource name to the CMap of the exact font
  // it refers to (subsetted fonts restart glyph numbering per-font, so a
  // merged/shared map would collide across fonts — see buildFontCMaps).
  const fontCMaps = buildFontCMaps(findAllObjectDicts(bytes), streamsByNum);

  // Fallback: merge every ToUnicode CMap in the document into one map, for
  // content streams whose active font couldn't be resolved above. Better to
  // risk an occasional cross-font collision than leave the text empty.
  const fallbackCmap: UnicodeMap = new Map();
  for (const { dict, data } of streams) {
    const decoded = decodeStreamBytes(dict, data);
    if (!decoded) continue;
    const content = bytesToLatin1String(decoded);
    if (content.includes("beginbfchar") || content.includes("beginbfrange")) {
      parseToUnicodeCMap(content, fallbackCmap);
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

    const text = extractTextFromContentStream(content, fallbackCmap.size > 0 ? fallbackCmap : null, fontCMaps);
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

/**
 * TEMPORARY diagnostic helper — reports why a given PDF failed/succeeded to
 * extract, without changing extractPdfText's behavior. Not used by the
 * normal upload flow; wired up only from the CV screen's dev-mode logging
 * while debugging a specific extraction failure. Safe to delete once the
 * underlying bug is found and fixed.
 */
export function diagnosePdf(bytes: Uint8Array): Record<string, unknown> {
  const latin1 = bytesToLatin1String(bytes);
  const streams = findStreamObjects(bytes);
  const objects = findAllObjectDicts(bytes);
  const streamsByNum = new Map(streams.map((s) => [s.num, s] as const));
  const fontCMaps = buildFontCMaps(objects, streamsByNum);

  const filters = new Set<string>();
  for (const { dict } of streams) {
    const m = dict.match(/\/Filter\s*(\/[A-Za-z0-9]+|\[[^\]]*\])/);
    if (m) filters.add(m[1].replace(/\s+/g, ""));
    else filters.add("(none)");
  }

  let flateFailures = 0;
  let decodedContentLikeStreams = 0;
  let totalContentLikeStreams = 0;
  let charsFromTjOps = 0;
  for (const { dict, data } of streams) {
    if (!isContentLikeDict(dict) || isFontLikeDict(dict)) continue;
    if (dict.includes("beginbfchar") || dict.includes("beginbfrange")) continue;
    totalContentLikeStreams++;
    const decoded = decodeStreamBytes(dict, data);
    if (!decoded) {
      if (isFlateEncoded(dict)) flateFailures++;
      continue;
    }
    decodedContentLikeStreams++;
    const content = bytesToLatin1String(decoded);
    charsFromTjOps += (content.match(/Tj|TJ|'|"/g) || []).length;
  }

  let bfcharCount = 0;
  for (const { dict, data } of streams) {
    const decoded = decodeStreamBytes(dict, data);
    if (!decoded) continue;
    const content = bytesToLatin1String(decoded);
    bfcharCount += (content.match(/<[0-9a-fA-F]+>\s*<[0-9a-fA-F]+>/g) || []).length;
  }

  const text = extractPdfText(bytes);

  return {
    byteLength: bytes.length,
    pdfVersion: latin1.slice(0, 16).replace(/[^\x20-\x7e]/g, ""),
    totalIndirectObjects: objects.size,
    totalStreamObjects: streams.length,
    filtersSeen: Array.from(filters),
    hasObjStm: /\/Type\s*\/ObjStm/.test(latin1),
    hasXRefStream: /\/Type\s*\/XRef/.test(latin1),
    hasEncrypt: /\/Encrypt\b/.test(latin1),
    hasType0Font: /\/Subtype\s*\/Type0/.test(latin1),
    hasIdentityH: /Identity-H/.test(latin1),
    hasToUnicodeRef: /\/ToUnicode\b/.test(latin1),
    resolvedFontCMapCount: fontCMaps.size,
    resolvedFontResourceNames: Array.from(fontCMaps.keys()),
    totalContentLikeStreams,
    decodedContentLikeStreams,
    flateFailures,
    textShowingOperatorTokens: charsFromTjOps,
    bfcharPairsFoundRaw: bfcharCount,
    extractedTextLength: text.length,
    extractedTextPreview: text.slice(0, 300),
  };
}

/**
 * Whether extracted text is prose a human wrote, rather than decoding debris.
 *
 * PDF text extraction is a best-effort decode: with an embedded subset font or
 * a missing ToUnicode map, the bytes come back as plausible-looking but
 * meaningless characters. The only guard before this was a length check, so a
 * long enough run of garbage passed straight through, got sent to the model,
 * and came back as a "rewritten CV" full of nonsense.
 *
 * Two independent signals, because either alone has a blind spot: a page of
 * "!!!!!!" is all valid characters but no words, while a page of accented
 * mojibake can form word-shaped tokens out of characters prose never uses.
 */
export function readabilityScore(text: string): { sane: number; wordish: number; ok: boolean } {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (t.length < 40) return { sane: 0, wordish: 0, ok: false };

  const saneChars = t.match(/[A-Za-z0-9 .,;:'"()\-@/&+#%$!?\n]/g)?.length ?? 0;
  const sane = saneChars / t.length;

  const tokens = t.split(" ").filter(Boolean);
  const words = tokens.filter((w) => /^[A-Za-z][A-Za-z'’-]{1,}$/.test(w)).length;
  const wordish = tokens.length ? words / tokens.length : 0;

  // A real CV is overwhelmingly ordinary characters and mostly real words, even
  // allowing for dates, bullets, emails and version numbers.
  return { sane, wordish, ok: sane >= 0.85 && wordish >= 0.45 };
}
