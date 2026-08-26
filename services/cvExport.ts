/**
 * Saving the optimised CV to a file the user can send.
 *
 * PDF is rendered on the device from HTML via expo-print. Word is built on the
 * server as a real .docx (see cvApi.exportCVAsDocx) and written to disk here.
 *
 * Both end in the system share sheet rather than a silent "downloaded"
 * message: on a phone there is no visible downloads folder to point at, and a
 * file the user cannot find has not really been delivered.
 */
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { File, Paths } from "expo-file-system";
import { exportCVAsDocx } from "./cvApi";

export type ExportOutcome = { ok: true } | { ok: false; message: string };

/** Escapes text before it is placed into the print HTML. */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

/**
 * Renders the plain-text CV as print HTML.
 *
 * The model returns text with no markup, so structure is inferred by the same
 * convention the server uses when building the .docx: the first line is the
 * name, a short all-caps line is a section heading, and a leading dash or
 * bullet is a list item. Keeping the two readers aligned means the PDF and the
 * Word file look like the same document.
 */
function toPrintHtml(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const body: string[] = [];
  let first = true;
  let inList = false;

  const closeList = () => { if (inList) { body.push("</ul>"); inList = false; } };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { closeList(); continue; }

    if (first) {
      first = false;
      closeList();
      body.push(`<h1>${escapeHtml(line)}</h1>`);
      continue;
    }

    if (line.length <= 48 && line === line.toUpperCase() && /[A-Z]/.test(line)) {
      closeList();
      body.push(`<h2>${escapeHtml(line)}</h2>`);
      continue;
    }

    const bullet = line.match(/^[-•*]\s+(.*)$/);
    if (bullet) {
      if (!inList) { body.push("<ul>"); inList = true; }
      body.push(`<li>${escapeHtml(bullet[1])}</li>`);
      continue;
    }

    closeList();
    body.push(`<p>${escapeHtml(line)}</p>`);
  }
  closeList();

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { margin: 18mm; }
    body { font-family: Georgia, 'Times New Roman', serif; font-size: 11pt; line-height: 1.45; color: #111; }
    h1 { font-size: 18pt; text-align: center; margin: 0 0 4pt; letter-spacing: 0.5pt; }
    h2 { font-size: 11.5pt; margin: 14pt 0 4pt; padding-bottom: 2pt;
         border-bottom: 0.7pt solid #444; text-transform: uppercase; letter-spacing: 0.6pt; }
    p  { margin: 3pt 0; }
    ul { margin: 3pt 0 3pt 16pt; padding: 0; }
    li { margin: 2pt 0; }
  </style></head><body>${body.join("\n")}</body></html>`;
}

async function share(uri: string, mimeType: string, title: string): Promise<ExportOutcome> {
  if (!(await Sharing.isAvailableAsync())) {
    return { ok: false, message: "Sharing isn't available on this device." };
  }
  await Sharing.shareAsync(uri, { mimeType, dialogTitle: title, UTI: mimeType });
  return { ok: true };
}

/**
 * Saves any document — a CV or a cover letter — as PDF.
 *
 * Shared rather than duplicated: a cover letter and a CV want the same
 * typography and the same share flow, and two copies of this would drift.
 */
export async function exportAsPdf(text: string, name = "optimised-cv"): Promise<ExportOutcome> {
  try {
    const { uri } = await Print.printToFileAsync({ html: toPrintHtml(text) });
    return await share(uri, "application/pdf", "Save your CV as PDF");
  } catch (e: any) {
    return { ok: false, message: e?.message ?? "Couldn't create the PDF." };
  }
}

export async function exportAsWord(text: string, name = "optimised-cv"): Promise<ExportOutcome> {
  const built = await exportCVAsDocx(text);
  if (!built.ok) return { ok: false, message: built.message };

  try {
    // Written into the cache directory: this is a file on its way to the share
    // sheet, not something the app needs to keep.
    const file = new File(Paths.cache, `${name}.${built.data.extension}`);
    if (file.exists) file.delete();
    file.create();
    file.write(Uint8Array.from(atob(built.data.fileBase64), (c) => c.charCodeAt(0)));
    return await share(file.uri, built.data.mimeType, "Save your CV as Word");
  } catch (e: any) {
    return { ok: false, message: e?.message ?? "Couldn't save the Word file." };
  }
}

export const __testing = { toPrintHtml };
