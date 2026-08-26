/**
 * CVContext — the uploaded CV and what we know about it.
 *
 * Rebuilt from scratch. Holds one CV per user (a CV is not per target role, so
 * unlike the roadmap it is not scoped by activeRoleId).
 *
 * Upload is two steps by design, matching the workflow: the file is extracted
 * first and held as `pending`, then the user says which format it was written
 * in, and only then does it become the committed CV. Scoring depends on knowing
 * the format, so committing before that question is answered would mean scoring
 * against an assumption.
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import AsyncStorage from "@/services/syncedStorage";
import { useAuth } from "@/context/AuthContext";
import { extractCV, type CVFileKind } from "@/services/cvApi";

/** The formats offered, plus a free-text option for anything else. */
export const CV_FORMATS = ["Harvard", "MIT", "Corporate"] as const;
export type KnownCVFormat = (typeof CV_FORMATS)[number];

export interface CVDocument {
  fileName: string;
  kind: CVFileKind;
  rawText: string;
  chars: number;
  /** What the user says this CV was written in — one of CV_FORMATS or their own. */
  sourceFormat: string;
  uploadedAt: string;
}

/** Extracted, but the format question has not been answered yet. */
export interface PendingCV {
  fileName: string;
  kind: CVFileKind;
  rawText: string;
  chars: number;
}

/**
 * Accepts a stored CV only if it matches the shape this version writes.
 *
 * The previous CV engine used this same storage key for a completely different
 * object — no `chars`, no `kind`, a different notion of format — so a device
 * that had used the old engine handed this one a document whose fields were
 * undefined, and the screen crashed rendering it. Stored data has to be checked
 * like any other input; anything unrecognised is treated as no CV at all, which
 * is recoverable by uploading again.
 */
function parseStoredCV(raw: string | null): CVDocument | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw);
    if (
      d && typeof d === "object" &&
      typeof d.rawText === "string" && d.rawText.length > 0 &&
      typeof d.fileName === "string" &&
      typeof d.chars === "number" &&
      (d.kind === "pdf" || d.kind === "docx") &&
      typeof d.sourceFormat === "string"
    ) {
      return d as CVDocument;
    }
  } catch {
    /* fall through */
  }
  return null;
}

interface CVContextType {
  cv: CVDocument | null;
  pending: PendingCV | null;
  isLoading: boolean;
  isUploading: boolean;
  error: string | null;
  /** Opens the picker, uploads and extracts. Leaves the result in `pending`. */
  pickAndExtract: () => Promise<void>;
  /** Answers the format question and commits the pending CV. */
  confirmFormat: (format: string) => Promise<void>;
  discardPending: () => void;
  clearCV: () => Promise<void>;
  clearError: () => void;
}

const CVContext = createContext<CVContextType | undefined>(undefined);

export function CVProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  const [cv, setCv] = useState<CVDocument | null>(null);
  const [pending, setPending] = useState<PendingCV | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const storageKey = user ? `cv_${user.id}` : null;

  useEffect(() => {
    if (!storageKey) { setCv(null); setIsLoading(false); return; }
    let cancelled = false;
    setIsLoading(true);
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(storageKey);
        const parsed = parseStoredCV(raw);
        // A stored value we cannot use is cleared rather than left to fail the
        // same way on every launch.
        if (raw && !parsed) await AsyncStorage.removeItem(storageKey);
        if (!cancelled) setCv(parsed);
      } catch {
        if (!cancelled) setCv(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [storageKey]);

  const pickAndExtract = useCallback(async () => {
    setError(null);
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: [
          "application/pdf",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled || !picked.assets?.length) return;

      const asset = picked.assets[0];
      setIsUploading(true);

      let base64: string;
      try {
        base64 = await new File(asset.uri).base64();
      } catch {
        setError("Couldn't read that file from your device. Try picking it again.");
        return;
      }

      const result = await extractCV({
        fileBase64: base64,
        fileName: asset.name ?? "cv.pdf",
        mimeType: asset.mimeType,
      });

      if (!result.ok) { setError(result.message); return; }

      // Held, not committed: the format question comes next.
      setPending({
        fileName: asset.name ?? "cv.pdf",
        kind: result.data.kind,
        rawText: result.data.text,
        chars: result.data.chars,
      });
    } finally {
      setIsUploading(false);
    }
  }, []);

  const confirmFormat = useCallback(async (format: string) => {
    if (!pending) return;
    const doc: CVDocument = {
      ...pending,
      sourceFormat: format.trim() || "Unspecified",
      uploadedAt: new Date().toISOString(),
    };
    setCv(doc);
    setPending(null);
    if (storageKey) await AsyncStorage.setItem(storageKey, JSON.stringify(doc));
  }, [pending, storageKey]);

  const discardPending = useCallback(() => { setPending(null); setError(null); }, []);

  const clearCV = useCallback(async () => {
    setCv(null);
    setPending(null);
    setError(null);
    if (storageKey) await AsyncStorage.removeItem(storageKey);
  }, [storageKey]);

  const clearError = useCallback(() => setError(null), []);

  return (
    <CVContext.Provider
      value={{ cv, pending, isLoading, isUploading, error, pickAndExtract, confirmFormat, discardPending, clearCV, clearError }}
    >
      {children}
    </CVContext.Provider>
  );
}

export function useCV() {
  const ctx = useContext(CVContext);
  if (!ctx) throw new Error("useCV must be used within CVProvider");
  return ctx;
}
