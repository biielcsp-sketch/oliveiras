import { createClient } from "@/lib/supabase/server";
import { fixedFileName, isFileMime, UUID_RE } from "@/lib/saude/files";
import { CASA_BUCKET, isCasaPetPath } from "@/lib/casa/docs";
import { isPetPhotoPath, PET_PHOTO_MIME } from "@/lib/casa/pet-photo";
import { isPetFileKind, PET_FILE_TABLES } from "@/lib/casa/pet";

/**
 * Comprovantes e anexos do Pet NUNCA têm URL pública: só por aqui, com sessão, lendo pelo RLS do usuário.
 * `tipo` é uma lista fechada (saude → casa_pet_health, veterinario → casa_pet_vet, foto → foto de perfil em casa_pets). Mesmo padrão de /casa/documentos/[id]/arquivo.
 */
const NO_STORE = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const fail = (status: number) =>
  new Response(status === 401 ? "Não autorizado" : "Não encontrado", { status, headers: { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8" } });

export async function GET(_: Request, { params }: { params: Promise<{ tipo: string; id: string }> }) {
  const { tipo, id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) return fail(401);
  // Foto de perfil do pet: casa_pets.photo_*; sempre image/jpeg (o upload só aceita JPEG pelos bytes).
  if (tipo === "foto" && UUID_RE.test(id)) {
    const { data: pet } = await supabase.from("casa_pets").select("photo_path, photo_mime").eq("id", id).maybeSingle();
    if (!pet || !isPetPhotoPath(pet.photo_path) || pet.photo_mime !== PET_PHOTO_MIME) return fail(404);
    const { data: blob, error } = await supabase.storage.from(CASA_BUCKET).download(pet.photo_path);
    if (error || !blob) return fail(404);
    const bytes = await blob.arrayBuffer();
    return new Response(bytes, {
      headers: { ...NO_STORE, "Content-Type": PET_PHOTO_MIME, "Content-Disposition": 'inline; filename="foto.jpg"', "Content-Length": String(bytes.byteLength) },
    });
  }
  if (!isPetFileKind(tipo) || !UUID_RE.test(id)) return fail(404);

  // Com a sessão do usuário: o RLS devolve só registros da família dele.
  const { data: row } = await supabase.from(PET_FILE_TABLES[tipo]).select("file_path, file_mime").eq("id", id).maybeSingle();
  if (!row || !isCasaPetPath(row.file_path) || !isFileMime(row.file_mime)) return fail(404);

  const { data: blob, error } = await supabase.storage.from(CASA_BUCKET).download(row.file_path);
  if (error || !blob) return fail(404);
  const bytes = await blob.arrayBuffer();

  return new Response(bytes, {
    headers: {
      ...NO_STORE,
      // Tipo vem do registro (gravado pelo servidor após checar os bytes), nunca do cliente.
      "Content-Type": row.file_mime,
      "Content-Disposition": `inline; filename="${fixedFileName(row.file_mime)}"`,
      "Content-Length": String(bytes.byteLength),
    },
  });
}
