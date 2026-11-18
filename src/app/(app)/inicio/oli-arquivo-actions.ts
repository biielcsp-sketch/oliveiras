"use server";

import { createClient } from "@/lib/supabase/server";
import { getAppContext } from "@/lib/data";
import { oliAllowedFor } from "@/lib/oli/access";
import { extractOliFile } from "@/lib/oli/arquivo-extract";
import { checkDailyLimit } from "@/lib/oli/file-limit";
import {
  financeExtracted, MAX_OLI_FILE_ITEMS, routeForList, sanitizeOliReading, type OliFileDest, type OliFileOptions, type OliFileReading,
} from "@/lib/oli/arquivo";
import { applyExtraction, readUploadedFile, revalidateDocPaths, storePendingDocuments } from "@/lib/financas/documentos/store";
import { docBatchPath } from "@/lib/financas/routes";

/**
 * "+" do Oli. Ler NÃO grava nada: devolve a leitura validada, o destino da tabela fixa e as opções
 * (pessoas e pets da família) para o painel. A gravação acontece só no toque em Confirmar:
 * - Saúde, Casa e Pet: o navegador chama as server actions dos próprios módulos (validação de sempre);
 * - Finanças: confirmOliArquivoFinancas cria o(s) documento(s) pendente(s) e leva para a conferência
 *   (um documento) ou para o lote (vários boletos/comprovantes no mesmo arquivo).
 * Tudo com a sessão do usuário (RLS), nunca com chave de serviço.
 */
export type OliFileReadResult =
  | {
      ok: true;
      /** Primeiro item (o painel de Saúde/Casa/Pet usa este). */
      leitura: OliFileReading;
      /** Todos os itens lidos do arquivo (até 20). */
      leituras: OliFileReading[];
      truncado: boolean;
      destino: OliFileDest;
      opcoes: OliFileOptions;
    }
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
    leitura: r.data.documentos[0],
    leituras: r.data.documentos,
    truncado: r.data.truncado,
    destino: routeForList(r.data.documentos),
    opcoes: {
      pessoas: ctx.members.map((m) => ({ id: m.id, name: m.name })),
      pets: (pets ?? []).map((p) => ({ id: p.id as string, name: p.name as string })),
    },
  };
}

const fromBrowser = (raw: unknown) => (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null);

/**
 * Boleto/comprovante: cria os documentos PENDENTES de Finanças (mesma função do envio em Finanças, arquivo enviado
 * UMA vez e todos com o mesmo arquivo) com as sugestões lidas, e devolve o caminho da conferência (um documento)
 * ou do lote (vários), onde a pessoa confere e confirma cada um.
 * - `leituras` (JSON, lista): vários itens; cada um mantém o tipo lido; só boleto/comprovante entram (até 20).
 * - `leitura` (JSON) + `tipo`: um item; o tipo escolhido no painel prevalece sobre o que a IA classificou.
 * A leitura volta do navegador, então é validada de novo (sanitizeOliReading); o arquivo é conferido pelos bytes.
 * O limite diário conta todos os novos: se estourar, nenhum é criado.
 */
export async function confirmOliArquivoFinancas(form: FormData): Promise<{ ok: true; url: string } | { ok: false; erro: string }> {
  const { household } = await getAppContext();
  if (!oliAllowedFor(household.id)) return { ok: false, erro: NOT_ALLOWED };
  if (!(form instanceof FormData)) return { ok: false, erro: "Envio inválido." };
  let leituras: OliFileReading[];
  try {
    if (form.has("leituras")) {
      const raw: unknown = JSON.parse(String(form.get("leituras") ?? "null"));
      if (!Array.isArray(raw)) return { ok: false, erro: "Dados inválidos." };
      leituras = raw
        .slice(0, MAX_OLI_FILE_ITEMS)
        .map((x) => fromBrowser(x))
        .filter((x): x is object => x !== null)
        .map((x) => sanitizeOliReading(x));
    } else {
      const raw: unknown = JSON.parse(String(form.get("leitura") ?? "null"));
      const tipo = String(form.get("tipo") ?? "");
      leituras = [sanitizeOliReading(fromBrowser(raw) ? { ...fromBrowser(raw), tipo } : null)];
    }
  } catch {
    return { ok: false, erro: "Dados inválidos." };
  }
  leituras = leituras.filter((l) => l.tipo === "boleto" || l.tipo === "comprovante");
  if (leituras.length === 0) return { ok: false, erro: "Este documento não é boleto nem comprovante." };
  const file = await readUploadedFile(form);
  if (!file.ok) return { ok: false, erro: file.error };

  const db = await createClient();
  const stored = await storePendingDocuments(db, household.id, file, leituras.length);
  if (!stored.ok) return { ok: false, erro: stored.error };
  for (let i = 0; i < stored.ids.length; i++) await applyExtraction(db, household.id, stored.ids[i], financeExtracted(leituras[i]));
  revalidateDocPaths();
  // Caminho montado aqui (id do banco); o navegador só navega para ele.
  return { ok: true, url: stored.ids.length > 1 ? docBatchPath(stored.ids[0]) : `/financas/documentos/${stored.ids[0]}` };
}
