/**
 * Foto de perfil do pet (funções puras, sem dependência de servidor/navegador).
 * O cliente reduz para JPEG; o servidor decide o tipo pelos BYTES (FF D8 FF) e nunca confia no mime enviado.
 */
export const PET_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
/** Lado maior da foto depois da redução no navegador, e qualidade do JPEG. */
export const PET_PHOTO_MAX_SIDE = 1024;
export const PET_PHOTO_QUALITY = 0.85;
export const PET_PHOTO_MIME = "image/jpeg" as const;

const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PHOTO_PATH_RE = new RegExp(`^${UUID}/pets/(${UUID})\\.jpg$`, "i");

export const isJpegBytes = (b: Uint8Array) => b.length >= JPEG_SIGNATURE.length && JPEG_SIGNATURE.every((v, i) => b[i] === v);

export type PhotoCheck = { ok: true } | { ok: false; erro: string };

export function checkPetPhoto(bytes: Uint8Array): PhotoCheck {
  if (bytes.length === 0) return { ok: false, erro: "A foto está vazia." };
  if (bytes.length > PET_PHOTO_MAX_BYTES) return { ok: false, erro: "A foto passa de 5 MB." };
  if (!isJpegBytes(bytes)) return { ok: false, erro: "Envie uma foto JPG ou PNG." };
  return { ok: true };
}

/** Caminho no bucket `casa`: {household_id}/pets/{uuid}.jpg (nome sempre gerado no servidor). */
export const petPhotoPath = (householdId: string, id: string) => `${householdId}/pets/${id}.jpg`;
export const isPetPhotoPath = (v: unknown): v is string => typeof v === "string" && PHOTO_PATH_RE.test(v);
/** Uuid do arquivo: serve de versão na URL (foto trocada = endereço novo, o navegador não reaproveita a antiga). */
export const petPhotoVersion = (path: unknown): string | null => (typeof path === "string" ? (PHOTO_PATH_RE.exec(path)?.[1] ?? null) : null);

export const petPhotoHref = (petId: string, version: string | null) => `/casa/pet/arquivo/foto/${petId}${version ? `?v=${version}` : ""}`;

export type PhotoPlan = { columns: "new" | "clear" | "keep"; deleteOld: boolean };
/** Novo arquivo vence o pedido de remover. O antigo só sai se havia e algo mudou (e só depois do banco confirmar). */
export function petPhotoPlan(input: { hasOld: boolean; hasNew: boolean; remove: boolean }): PhotoPlan {
  if (input.hasNew) return { columns: "new", deleteOld: input.hasOld };
  if (input.remove) return { columns: "clear", deleteOld: input.hasOld };
  return { columns: "keep", deleteOld: false };
}

export function petPhotoColumns(plan: PhotoPlan["columns"], uploaded: { path: string; size: number } | null) {
  if (plan === "new" && uploaded) return { photo_path: uploaded.path, photo_mime: PET_PHOTO_MIME, photo_size: uploaded.size };
  if (plan === "clear") return { photo_path: null, photo_mime: null, photo_size: null };
  return {};
}

/** Tamanho final mantendo a proporção, com o lado maior limitado a `max` (nunca amplia). */
export function scaleToFit(width: number, height: number, max = PET_PHOTO_MAX_SIDE) {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const k = max / longest;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** Inicial do nome para o avatar sem foto. */
export const petInitial = (name: string) => (name.trim().charAt(0) || "?").toLocaleUpperCase("pt-BR");

/** O que o formulário envia sobre a foto: JPEG novo vence "remover"; erro de leitura não remove a foto atual. */
export const petPhotoFormFields = (hasBlob: boolean, remove: boolean) => ({ photo: hasBlob, remove_photo: remove && !hasBlob });
