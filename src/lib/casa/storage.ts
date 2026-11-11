import "server-only";
import { randomUUID } from "node:crypto";
import type { createClient } from "@/lib/supabase/server";
import { checkUpload, MAX_FILE_BYTES } from "@/lib/saude/files";
import { checkPetPhoto, petPhotoPath } from "./pet-photo";
import { CASA_BUCKET, casaFilePath, isCasaFilePath, type CasaFileDir } from "./docs";

/**
 * Upload de arquivos da Casa (documentos e Pet). Tipo decidido pelos BYTES (PDF/JPG), até 5 MB, nome uuid
 * gerado aqui, envio com a sessão do usuário (RLS do bucket privado `casa`). Só roda no servidor.
 */
type Db = Awaited<ReturnType<typeof createClient>>;
export type Uploaded = { path: string; mime: "application/pdf" | "image/jpeg"; size: number };

export async function uploadCasaFile(db: Db, householdId: string, form: FormData, dir: CasaFileDir) {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: true as const, uploaded: null };
  if (file.size > MAX_FILE_BYTES) return { ok: false as const, erro: "O arquivo passa de 5 MB." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkUpload(bytes);
  if (!check.ok) return { ok: false as const, erro: check.erro };
  const path = casaFilePath(householdId, dir, randomUUID(), check.kind.ext);
  const { error } = await db.storage.from(CASA_BUCKET).upload(path, bytes, { contentType: check.kind.mime, upsert: false });
  if (error) return { ok: false as const, erro: "Não foi possível enviar o arquivo. Tente de novo." };
  return { ok: true as const, uploaded: { path, mime: check.kind.mime, size: bytes.length } satisfies Uploaded };
}

export async function removeCasaFile(db: Db, path: string | null | undefined, dir: CasaFileDir) {
  if (path && isCasaFilePath(path, dir)) await db.storage.from(CASA_BUCKET).remove([path]);
}

/** Colunas file_* do registro: arquivo novo, remoção pedida (tudo nulo) ou sem mudança. */
export function fileColumns(uploaded: Uploaded | null, remove: boolean) {
  if (uploaded) return { file_path: uploaded.path, file_mime: uploaded.mime, file_size: uploaded.size };
  if (remove) return { file_path: null, file_mime: null, file_size: null };
  return {};
}

/** Foto do pet (campo `photo`): só JPEG pelos bytes, até 5 MB, caminho {household_id}/pets/{uuid}.jpg, sessão do usuário. */
export async function uploadPetPhoto(db: Db, householdId: string, form: FormData) {
  const file = form.get("photo");
  if (!(file instanceof File) || file.size === 0) return { ok: true as const, uploaded: null };
  if (file.size > MAX_FILE_BYTES) return { ok: false as const, erro: "A foto passa de 5 MB." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkPetPhoto(bytes);
  if (!check.ok) return { ok: false as const, erro: check.erro };
  const path = petPhotoPath(householdId, randomUUID());
  const { error } = await db.storage.from(CASA_BUCKET).upload(path, bytes, { contentType: "image/jpeg", upsert: false });
  if (error) return { ok: false as const, erro: "Não foi possível enviar a foto. Tente de novo." };
  return { ok: true as const, uploaded: { path, size: bytes.length } };
}
