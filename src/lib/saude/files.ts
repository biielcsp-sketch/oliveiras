/**
 * Arquivos de Saúde (PDF/JPG). Funções puras: o servidor decide o tipo pelos BYTES,
 * nunca pelo mime ou nome que o navegador mandou.
 */
import type { FileMime } from "./types";

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export type FileKind = { mime: FileMime; ext: "pdf" | "jpg" };

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const JPG = [0xff, 0xd8, 0xff];

const startsWith = (b: Uint8Array, sig: number[]) => b.length >= sig.length && sig.every((v, i) => b[i] === v);

/** Bytes mágicos: %PDF- ou FFD8FF. Qualquer outra coisa → null. */
export function detectFileKind(bytes: Uint8Array): FileKind | null {
  if (startsWith(bytes, PDF)) return { mime: "application/pdf", ext: "pdf" };
  if (startsWith(bytes, JPG)) return { mime: "image/jpeg", ext: "jpg" };
  return null;
}

export type UploadCheck = { ok: true; kind: FileKind } | { ok: false; erro: string };

export function checkUpload(bytes: Uint8Array): UploadCheck {
  if (bytes.length === 0) return { ok: false, erro: "O arquivo está vazio." };
  if (bytes.length > MAX_FILE_BYTES) return { ok: false, erro: "O arquivo passa de 5 MB." };
  const kind = detectFileKind(bytes);
  if (!kind) return { ok: false, erro: "Envie um arquivo PDF ou JPG." };
  return { ok: true, kind };
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type StorageDir = "cards" | "exams";

/** Caminho no bucket `saude`: {household_id}/{cards|exams}/{uuid}.{pdf|jpg}. O nome vem do servidor. */
export function storagePath(householdId: string, dir: StorageDir, id: string, ext: "pdf" | "jpg") {
  return `${householdId}/${dir}/${id}.${ext}`;
}

export const STORAGE_PATH_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(cards|exams)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg)$/i;

export const isStoragePath = (v: unknown): v is string => typeof v === "string" && STORAGE_PATH_RE.test(v);
export const isFileMime = (v: unknown): v is FileMime => v === "application/pdf" || v === "image/jpeg";

/** Nome fixo mostrado ao baixar/abrir; o nome enviado pelo cliente nunca é usado. */
export const fixedFileName = (mime: FileMime) => (mime === "application/pdf" ? "arquivo.pdf" : "arquivo.jpg");

export const formatSize = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
