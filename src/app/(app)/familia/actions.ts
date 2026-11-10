"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAppContext } from "@/lib/data";
import { isValidPushEndpoint } from "@/lib/saude/push";

export type ActionState = { error?: string; ok?: boolean } | null;

const RELATIONS = ["filho", "outro"] as const;

export async function addDependent(_: ActionState, form: FormData): Promise<ActionState> {
  const { household } = await getAppContext();
  const name = String(form.get("name") ?? "").trim();
  const relation = String(form.get("relation") ?? "filho");
  const birth = String(form.get("birth_date") ?? "") || null;

  if (!name) return { error: "Informe o nome." };
  if (!RELATIONS.includes(relation as (typeof RELATIONS)[number])) return { error: "Relação inválida." };

  const supabase = await createClient();
  const { error } = await supabase.from("members").insert({
    household_id: household.id,
    name,
    relation,
    birth_date: birth,
    color: "#C08A3E",
  });
  if (error) return { error: "Não foi possível salvar. Tente de novo." };

  revalidatePath("/familia");
  return { ok: true };
}

export async function removeDependent(form: FormData) {
  await getAppContext();
  const id = String(form.get("id") ?? "");
  const supabase = await createClient();
  // RLS só permite remover membros sem login (dependentes)
  await supabase.from("members").delete().eq("id", id);
  revalidatePath("/familia");
}

/**
 * Sair da conta. Se este aparelho tinha assinatura de avisos push, o endpoint chega aqui e a linha é apagada
 * ANTES do signOut (ainda há sessão, então o RLS deixa apagar). Só o endpoint deste aparelho: os outros
 * aparelhos da pessoa continuam recebendo. Falha ao apagar nunca impede a saída da conta.
 */
export async function signOut(pushEndpoint?: string | null) {
  const supabase = await createClient();
  if (isValidPushEndpoint(pushEndpoint)) {
    try {
      await supabase.from("push_subscriptions").delete().eq("endpoint", pushEndpoint);
    } catch {
      /* segue para o signOut */
    }
  }
  await supabase.auth.signOut();
  redirect("/login");
}
