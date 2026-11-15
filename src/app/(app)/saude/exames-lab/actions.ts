"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAppContext } from "@/lib/data";
import { todaySP } from "@/lib/financas/today";
import { checkDailyLimit } from "@/lib/oli/file-limit";
import { isStoragePath, storagePath, UUID_RE } from "@/lib/saude/files";
import { labsAiAllowedFor } from "@/lib/saude/labs/access";
import { checkLabUpload, toDraftRows, type DraftRow } from "@/lib/saude/labs/extraction";
import { extractLabReport } from "@/lib/saude/labs/extract";
import { sameLab, validateLabSave } from "@/lib/saude/labs/input";

/**
 * Exames de laboratório. Duas etapas, sempre com a sessão do usuário (RLS) e a família vinda do servidor:
 * 1) extractLabFile: lê o PDF/JPG com IA e devolve a lista para CONFERIR. NÃO grava nada.
 * 2) saveLabReport: só no "Confirmar e salvar": sobe o arquivo, cria a coleta e os resultados; se algo falhar,
 *    apaga o que criou (nunca fica coleta pela metade).
 * O conteúdo do arquivo é DADO: o texto lido nunca vira instrução nem decide o que é gravado.
 */
export type LabDraft = { collected_on: string | null; lab: string | null; rows: DraftRow[]; truncated: boolean };
export type LabExtractResult = { ok: true; draft: LabDraft } | { ok: false; erro: string };
export type LabSaveResult = { ok: true; member_id: string } | { ok: false; erro: string };

const BUCKET = "saude";
const GENERIC = "Não foi possível salvar. Tente de novo.";
const MAX_ROWS_JSON = 400_000;
const DUPLICATE = "Já existe uma coleta desta pessoa nesta data neste laboratório. Apague a anterior para reenviar.";

export async function extractLabFile(form: FormData): Promise<LabExtractResult> {
  const ctx = await getAppContext(); // sessão via auth.getClaims(); sem login, vai para /login
  if (!labsAiAllowedFor(ctx.household.id)) return { ok: false, erro: "A leitura automática de exames ainda não está liberada para esta família." };
  if (!(form instanceof FormData)) return { ok: false, erro: "Envio inválido." };
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, erro: "Escolha um PDF ou uma foto (JPG)." };
  if (file.size > 5 * 1024 * 1024) return { ok: false, erro: "O arquivo passa de 5 MB." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkLabUpload(bytes); // tipo pelos bytes, nunca pelo mime do navegador
  if (!check.ok) return { ok: false, erro: check.erro };

  // Limite diário (o mesmo do "+" e do ler_arquivo do Oli) ANTES de chamar a IA.
  const db = await createClient();
  const limit = await checkDailyLimit(db, ctx.household.id);
  if (limit) return { ok: false, erro: limit };

  const r = await extractLabReport(bytes, check.kind.mime);
  if (!r.ok) {
    if (r.motivo === "timeout") return { ok: false, erro: "A leitura demorou demais. Tente de novo." };
    if (r.motivo === "resposta_invalida") return { ok: false, erro: "Não encontrei resultados de exames neste arquivo. Confira se é o laudo do laboratório." };
    return { ok: false, erro: "Não consegui ler o arquivo agora. Tente de novo." };
  }
  const rows = toDraftRows(r.data.results);
  if (rows.length === 0) return { ok: false, erro: "Não encontrei resultados de exames neste arquivo." };
  return { ok: true, draft: { collected_on: r.data.collected_on, lab: r.data.lab, rows, truncated: r.data.truncated } };
}

export async function saveLabReport(form: FormData): Promise<LabSaveResult> {
  const ctx = await getAppContext();
  if (!(form instanceof FormData)) return { ok: false, erro: "Envio inválido." };

  const memberId = String(form.get("member_id") ?? "");
  // A pessoa precisa ser da família do usuário (o servidor decide; o RLS e a FK composta confirmam).
  if (!UUID_RE.test(memberId) || !ctx.members.some((m) => m.id === memberId)) return { ok: false, erro: "Escolha de quem é o exame." };

  const rowsRaw = String(form.get("rows") ?? "");
  if (rowsRaw.length > MAX_ROWS_JSON) return { ok: false, erro: "Resultados demais para salvar de uma vez." };
  let rows: unknown = null;
  try {
    rows = JSON.parse(rowsRaw);
  } catch {
    return { ok: false, erro: "Dados inválidos." };
  }
  const v = validateLabSave({ collected_on: form.get("collected_on"), lab: form.get("lab"), rows }, todaySP());
  if (!v.ok) return v;

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, erro: "O arquivo do laudo não chegou. Envie de novo." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkLabUpload(bytes);
  if (!check.ok) return { ok: false, erro: check.erro };

  const db = await createClient();
  const hh = ctx.household.id;

  // Mesmo laudo enviado duas vezes: mesma pessoa + data + laboratório (sem caixa/espaços; vazio = vazio). Antes do upload.
  const { data: same, error: sameError } = await db.from("health_lab_reports").select("lab").eq("household_id", hh).eq("member_id", memberId).eq("collected_on", v.value.collected_on);
  if (sameError) return { ok: false, erro: GENERIC };
  if ((same ?? []).some((r) => sameLab(r.lab as string | null, v.value.lab))) return { ok: false, erro: DUPLICATE };
  const path = storagePath(hh, "exams", randomUUID(), check.kind.ext);
  const up = await db.storage.from(BUCKET).upload(path, bytes, { contentType: check.kind.mime, upsert: false });
  if (up.error) return { ok: false, erro: "Não foi possível enviar o arquivo. Tente de novo." };

  const cleanup = async (reportId: string | null) => {
    if (reportId) await db.from("health_lab_reports").delete().eq("household_id", hh).eq("id", reportId); // apaga os resultados em cascata
    await db.storage.from(BUCKET).remove([path]);
  };

  const { data: report, error } = await db
    .from("health_lab_reports")
    .insert({
      household_id: hh,
      member_id: memberId,
      collected_on: v.value.collected_on,
      lab: v.value.lab,
      file_path: path,
      file_mime: check.kind.mime,
      file_size: bytes.length,
    })
    .select("id")
    .single();
  if (error || !report) {
    await cleanup(null);
    return { ok: false, erro: GENERIC };
  }
  const { error: resError } = await db
    .from("health_lab_results")
    .insert(v.value.results.map((r) => ({ ...r, report_id: report.id, household_id: hh, member_id: memberId })));
  if (resError) {
    await cleanup(report.id as string);
    return { ok: false, erro: GENERIC };
  }
  revalidatePath("/saude", "layout");
  return { ok: true, member_id: memberId };
}

export async function deleteLabReport(id: string): Promise<{ ok: boolean; erro?: string }> {
  const ctx = await getAppContext();
  if (typeof id !== "string" || !UUID_RE.test(id)) return { ok: false, erro: "Coleta inválida." };
  const db = await createClient();
  const { data: row } = await db.from("health_lab_reports").select("file_path").eq("household_id", ctx.household.id).eq("id", id).maybeSingle();
  if (!row) return { ok: false, erro: "Coleta não encontrada." };
  const { error } = await db.from("health_lab_reports").delete().eq("household_id", ctx.household.id).eq("id", id); // resultados saem em cascata
  if (error) return { ok: false, erro: "Não foi possível apagar. Tente de novo." };
  if (isStoragePath(row.file_path)) await db.storage.from(BUCKET).remove([row.file_path]);
  revalidatePath("/saude", "layout");
  return { ok: true };
}
