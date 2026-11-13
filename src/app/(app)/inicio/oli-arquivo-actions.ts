"use server";

import { createClient } from "@/lib/supabase/server";
import { getAppContext } from "@/lib/data";
import { oliAllowedFor } from "@/lib/oli/access";
import { extractOliFile } from "@/lib/oli/arquivo-extract";
import { checkDailyLimit } from "@/lib/oli/file-limit";
import {
  financeExtracted, routeFor, sanitizeOliReading, type OliFileDest, type OliFileOptions, type OliFileReading,
} from "@/lib/oli/arquivo";
import { applyExtraction, readUploadedFile, revalidateDocPaths, storePendingDocument } from "@/lib/financas/documentos/store";

/**
 * "+" do Oli. Ler NÃO grava nada: devolve a leitura validada, o destino da tabela fixa e as opções
 * (pessoas e pets da família) para o painel. A gravação acontece só no toque em Confirmar:
 * - Saúde, Casa e Pet: o navegador chama as server actions dos próprios módulos (validação de sempre);
 * - Finanças: confirmOliArquivoFinancas cria o documento pendente e leva para a conferência.
 * Tudo com a sessão do usuário (RLS), nunca com chave de serviço.
 */
export type OliFileReadResult =
  | { ok: true; leitura: OliFileReading; destino: OliFileDest; opcoes: OliFileOptions }
  | { ok: false; erro: string };

const NOT_ALLOWED = "O Oli ainda não está liberado para esta família.";

export async function readOliFile(form: FormData): Promise<OliFileReadResult> {
  const ctx = await getAppContext(); // sessão via auth.getClaims(); sem login, vai para /login
  if (!oliAllowedFor(ctx.household.id)) return { ok: false, erro: NOT_ALLOWED };
  if (!(form instanceof FormData)) return { ok: false, erro: "Envio inválido." };

  // Limite diário ANTES de ler o arquivo e de chamar a IA: registra a tentativa e conta as do dia (sessão, RLS).
  const db = await createClient();
  const limit = await checkDailyLimit(db, ctx.household.id);
  if (limit) return { ok: false, erro: limit };

  const file = await readUploadedFile(form);
  if (!file.ok) return { ok: false, erro: file.error };

  const r = await extractOliFile(file.bytes, file.kind.mime);
  if (!r.ok) {
    return { ok: false, erro: r.motivo === "timeout" ? "A leitura demorou demais. Tente de novo." : "Não consegui ler o arquivo agora. Tente de novo." };
  }

  const { data: pets } = await db.from("casa_pets").select("id, name").eq("household_id", ctx.household.id).order("name").limit(50);
  return {
    ok: true,
    leitura: r.data,
    destino: routeFor(r.data.tipo),
    opcoes: {
      pessoas: ctx.members.map((m) => ({ id: m.id, name: m.name })),
      pets: (pets ?? []).map((p) => ({ id: p.id as string, name: p.name as string })),
    },
  };
}

/**
 * Boleto/comprovante: cria o documento PENDENTE de Finanças (mesma função do envio em Finanças) com as
 * sugestões lidas, e devolve o caminho da tela de conferência, onde a pessoa escolhe conta fixa/avulsa e confirma.
 * A leitura volta do navegador, então é validada de novo (sanitizeOliReading); o arquivo é conferido pelos bytes.
 */
export async function confirmOliArquivoFinancas(form: FormData): Promise<{ ok: true; url: string } | { ok: false; erro: string }> {
  const { household } = await getAppContext();
  if (!oliAllowedFor(household.id)) return { ok: false, erro: NOT_ALLOWED };
  if (!(form instanceof FormData)) return { ok: false, erro: "Envio inválido." };
  let raw: unknown = null;
  try {
    raw = JSON.parse(String(form.get("leitura") ?? "null"));
  } catch {
    return { ok: false, erro: "Dados inválidos." };
  }
  // O tipo escolhido no painel (boleto ou comprovante) prevalece sobre o que a IA classificou.
  const tipo = String(form.get("tipo") ?? "");
  const leitura = sanitizeOliReading(raw && typeof raw === "object" && !Array.isArray(raw) ? { ...raw, tipo } : null);
  if (leitura.tipo !== "boleto" && leitura.tipo !== "comprovante") return { ok: false, erro: "Este documento não é boleto nem comprovante." };
  const file = await readUploadedFile(form);
  if (!file.ok) return { ok: false, erro: file.error };

  const db = await createClient();
  const stored = await storePendingDocument(db, household.id, file);
  if (!stored.ok) return { ok: false, erro: stored.error };
  await applyExtraction(db, household.id, stored.id, financeExtracted(leitura));
  revalidateDocPaths();
  // Caminho montado aqui (id do banco); o navegador só navega para ele.
  return { ok: true, url: `/financas/documentos/${stored.id}` };
}
