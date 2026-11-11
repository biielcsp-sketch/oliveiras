import { createClient } from "@/lib/supabase/server";
import { fixedFileName, isFileMime, UUID_RE } from "@/lib/saude/files";
import { CASA_BUCKET, isCasaDocPath } from "@/lib/casa/docs";

/** Garantias, notas e manuais da Casa NUNCA têm URL pública: só por aqui, com sessão, lendo pelo RLS do usuário. */
const NO_STORE = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const fail = (status: number) =>
  new Response(status === 401 ? "Não autorizado" : "Não encontrado", { status, headers: { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8" } });

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) return fail(401);
  if (!UUID_RE.test(id)) return fail(404);

  // Com a sessão do usuário: o RLS devolve só documentos da família dele.
  const { data: row } = await supabase.from("casa_documents").select("file_path, file_mime").eq("id", id).maybeSingle();
  if (!row || !isCasaDocPath(row.file_path) || !isFileMime(row.file_mime)) return fail(404);

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
