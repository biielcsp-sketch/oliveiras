import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { getAppContext } from "@/lib/data";
import { todaySP } from "@/lib/financas/today";
import { brDate } from "@/lib/agenda/dates";
import { MEAL_LABEL, type Meal } from "@/lib/casa/types";
import { completeChore, deleteChore, deleteMaintenance, deleteShoppingItem, markMaintenanceDone, saveChore, saveMaintenance, saveShoppingItem, toggleShoppingItem } from "@/app/(app)/casa/actions";
import { deleteCasaDocument, saveCasaDocument } from "@/app/(app)/casa/documentos-actions";
import { deleteMeal, saveMeal } from "@/app/(app)/casa/cardapio-actions";
import { deleteProvider, saveProvider } from "@/app/(app)/casa/prestadores-actions";
import {
  deletePetCare,
  deletePetFood,
  deletePetHealth,
  deletePetVet,
  deletePetWeight,
  markPetCareDone,
  savePetCare,
  savePetFood,
  savePetHealth,
  savePetVet,
  savePetWeight,
} from "@/app/(app)/casa/pet-actions";
import { deletePrayer, deletePurpose, deleteWord, savePrayer, savePurpose, saveWord } from "@/app/(app)/ministerio/devocional-actions";
import { deleteLesson, saveLesson } from "@/app/(app)/ministerio/carisma-actions";
import { driveAviso, planAlteracao, planToFormEntries, specFor, type AlteracaoPlan, type AlterarArgs, type AlterarLookup, type Row } from "./alterar";

/**
 * Lado do servidor da escrita do Oli (Casa, Pet, Igreja): lê a linha atual com a sessão do usuário (RLS) e, no
 * Confirmar, grava pelas MESMAS server actions das telas (mesma validação, regras de dono da Igreja e remoção de
 * arquivo do storage). Nunca usa chave de serviço.
 */
type Ctx = Awaited<ReturnType<typeof getAppContext>>;
type Db = Awaited<ReturnType<typeof createClient>>;

export type Prepared = { ok: true; plan: AlteracaoPlan; row: Row | null } | { ok: false; erro: string };

async function lookup(ctx: Ctx, db: Db, aba: string): Promise<AlterarLookup> {
  let pets: { id: string; name: string }[] = [];
  if (aba === "pet") {
    const { data } = await db.from("casa_pets").select("id, name").eq("household_id", ctx.household.id).order("name").limit(50);
    pets = (data ?? []) as { id: string; name: string }[];
  }
  return {
    uid: ctx.user.id,
    me: ctx.me ? { id: ctx.me.id, name: ctx.me.name } : null,
    members: ctx.members.map((m) => ({ id: m.id, name: m.name, user_id: m.user_id })),
    pets,
    today: todaySP(),
  };
}

const ARQUIVO_AVISO = "O arquivo guardado também será apagado.";

const AVISO_FALHOU = "Não consegui conferir o item agora. Nada foi alterado: tente de novo.";

/**
 * Avisos que dependem do banco (arquivo junto, item que será substituído). Entram no painel e no conferir do Confirmar.
 * Se a consulta que decide o aviso falhar, recusa (nunca mostra um painel sem o aviso que deveria ter).
 */
async function avisoDe(ctx: Ctx, db: Db, plan: AlteracaoPlan, row: Row | null): Promise<{ ok: true; aviso: string | null } | { ok: false; erro: string }> {
  const { preview: p, raw } = plan;
  const hh = ctx.household.id;
  const aviso = (a: string | null) => ({ ok: true as const, aviso: a });
  const falhou = { ok: false as const, erro: AVISO_FALHOU };
  if (p.acao === "apagar") {
    if ((p.secao === "documentos" || p.secao === "saude" || p.secao === "veterinario") && row?.file_path) return aviso(ARQUIVO_AVISO);
    if (p.secao === "prestadores") return aviso("Manutenções ligadas a este prestador ficam sem prestador.");
    if (p.secao === "carisma") {
      const { count, error } = await db.from("igreja_carisma_files").select("id", { count: "exact", head: true }).eq("household_id", hh).eq("lesson_id", p.id!);
      if (error || typeof count !== "number") return falhou;
      return aviso(driveAviso(Boolean(row?.drive_folder_id), count));
    }
    return aviso(null);
  }
  if (p.acao === "criar" && p.secao === "cardapio") {
    const { data, error } = await db.from("casa_meal_plan").select("title").eq("household_id", hh).eq("day", String(raw.day)).eq("meal", String(raw.meal)).maybeSingle();
    if (error) return falhou;
    if (data) return aviso(`Já tem “${String(data.title).slice(0, 120)}” no ${MEAL_LABEL[raw.meal as Meal]?.toLowerCase() ?? "horário"} de ${brDate(String(raw.day))}: vai ser substituído.`);
  }
  if (p.acao === "criar" && p.secao === "peso") {
    const { data, error } = await db.from("casa_pet_weights").select("weight_kg").eq("household_id", hh).eq("pet_id", String(raw.pet_id)).eq("measured_on", String(raw.measured_on)).maybeSingle();
    if (error) return falhou;
    if (data) return aviso(`Já tem pesagem nesse dia (${String(Number(data.weight_kg)).replace(".", ",")} kg): vai ser substituída.`);
  }
  return aviso(null);
}

/** Prepara (sem gravar): linha atual + plano + painel. */
export async function prepararAlteracao(ctx: Ctx, a: AlterarArgs): Promise<Prepared> {
  const spec = specFor(a.aba, a.secao);
  if (!spec) return { ok: false, erro: "Seção inválida." };
  const db = await createClient();
  let row: Row | null = null;
  if (a.id) {
    const { data, error } = await db.from(spec.table).select(spec.cols).eq("household_id", ctx.household.id).eq("id", a.id).maybeSingle();
    if (error) return { ok: false, erro: "Não consegui ler o item agora." };
    row = (data as Row | null) ?? null;
  }
  const r = planAlteracao(a, row, await lookup(ctx, db, a.aba));
  if (!r.ok) return r;
  const av = await avisoDe(ctx, db, r.plan, row);
  if (!av.ok) return av;
  r.plan.preview.aviso = av.aviso;
  return { ok: true, plan: r.plan, row };
}

type SaveFn = (prev: null, form: FormData) => Promise<{ ok?: boolean; error?: string; message?: string } | null>;
type DeleteFn = (id: string) => Promise<{ ok: boolean; erro?: string; aviso?: string }>;

const SAVE: Record<string, SaveFn> = {
  "casa/tarefas": saveChore,
  "casa/compras": saveShoppingItem,
  "casa/manutencao": saveMaintenance,
  "casa/documentos": saveCasaDocument,
  "casa/cardapio": saveMeal,
  "casa/prestadores": saveProvider,
  "pet/saude": savePetHealth,
  "pet/veterinario": savePetVet,
  "pet/cuidados": savePetCare,
  "pet/peso": savePetWeight,
  "pet/racao": savePetFood,
  "igreja/palavras": saveWord,
  "igreja/promessas": saveWord,
  "igreja/oracoes": savePrayer,
  "igreja/propositos": savePurpose,
  "igreja/carisma": saveLesson,
};

const DELETE: Record<string, DeleteFn> = {
  "casa/tarefas": deleteChore,
  "casa/compras": deleteShoppingItem,
  "casa/manutencao": deleteMaintenance,
  "casa/documentos": deleteCasaDocument, // remove o arquivo do storage, como a tela
  "casa/cardapio": deleteMeal,
  "casa/prestadores": deleteProvider,
  "pet/saude": deletePetHealth, // idem
  "pet/veterinario": deletePetVet, // idem
  "pet/cuidados": deletePetCare,
  "pet/peso": deletePetWeight,
  "pet/racao": deletePetFood,
  "igreja/palavras": deleteWord,
  "igreja/promessas": deleteWord,
  "igreja/oracoes": deletePrayer,
  "igreja/propositos": deletePurpose,
  "igreja/carisma": deleteLesson, // arquivos e pasta vão para a lixeira do Drive, como a tela
};

export type ExecResult = { ok: true; aviso?: string } | { ok: false; erro: string };

/** Grava pelo caminho da tela. `prep` vem de prepararAlteracao feito AGORA (no Confirmar), nunca do cliente. */
export async function executarAlteracao(prep: Extract<Prepared, { ok: true }>): Promise<ExecResult> {
  const { plan, row } = prep;
  const key = `${plan.preview.aba}/${plan.preview.secao}`;
  const id = plan.preview.id;
  switch (plan.preview.acao) {
    case "apagar": {
      const r = await DELETE[key](id!);
      return r.ok ? { ok: true, ...(r.aviso ? { aviso: r.aviso } : {}) } : { ok: false, erro: r.erro ?? "Não foi possível apagar." };
    }
    case "concluir": {
      const fail = (erro?: string) => ({ ok: false as const, erro: erro ?? "Não foi possível registrar." });
      if (key === "casa/tarefas") {
        // Estado lido agora: o "Feita" da tela confere índice e data (outro celular pode ter marcado antes).
        const r = await completeChore(id!, { next_index: Number(row?.next_index ?? 0), next_due_on: (row?.next_due_on as string | null) ?? null });
        return r.ok ? { ok: true } : fail(r.erro);
      }
      if (key === "casa/compras") {
        const r = await toggleShoppingItem(id!, plan.raw.done === "true");
        return r.ok ? { ok: true } : fail(r.erro);
      }
      const done = key === "casa/manutencao" ? markMaintenanceDone : key === "pet/cuidados" ? markPetCareDone : null;
      if (!done) return fail("Não dá para concluir este item.");
      const fd = new FormData();
      for (const [k, v] of planToFormEntries(plan)) fd.append(k, v);
      const r = await done(null, fd);
      return r?.ok ? { ok: true } : fail(r?.error);
    }
    default: {
      const fd = new FormData();
      for (const [k, v] of planToFormEntries(plan)) fd.append(k, v);
      const r = await SAVE[key](null, fd);
      return r?.ok ? { ok: true } : { ok: false, erro: r?.error ?? "Não foi possível salvar." };
    }
  }
}
