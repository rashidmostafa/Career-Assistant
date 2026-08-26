/**
 * cvApi — talks to the server's CV endpoints.
 *
 * Extraction runs server-side: the previous version parsed PDFs on the device
 * with hand-rolled byte decoding, which produced convincing gibberish on any
 * file using an embedded subset font. The server uses real parsers and handles
 * .docx as well, so Word CVs work without shipping a second parser to the phone.
 */
import { apiFetch } from "./authApiService";

export type CVFileKind = "pdf" | "docx";

export interface ExtractedCV {
  text: string;
  chars: number;
  kind: CVFileKind;
  readability: { sane: number; wordish: number; ok: boolean };
}

export type ExtractResult =
  | { ok: true; data: ExtractedCV }
  /** `message` is written for the user — the server explains what to do next. */
  | { ok: false; message: string };

/** Parsing a CV is slower than a normal request, and a cold instance slower still. */
const EXTRACT_TIMEOUT_MS = 60_000;

export async function extractCV(params: {
  fileBase64: string;
  fileName: string;
  mimeType?: string;
}): Promise<ExtractResult> {
  try {
    const data = await apiFetch<ExtractedCV>(
      "/api/cv/extract",
      { method: "POST", body: JSON.stringify(params), timeoutMs: EXTRACT_TIMEOUT_MS },
      true,
    );
    return { ok: true, data };
  } catch (e: any) {
    // The server's 4xx bodies carry a message meant to be read — an unreadable
    // scan, a password-protected file, an unsupported type. Anything without
    // one is a genuine failure and gets a generic line.
    return {
      ok: false,
      message: e?.message && e?.status
        ? e.message
        : "Couldn't upload your CV. Check your connection and try again.",
    };
  }
}
