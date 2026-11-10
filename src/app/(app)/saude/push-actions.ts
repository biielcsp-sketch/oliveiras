"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getAppContext } from "@/lib/data";
import { isValidPushEndpoint, truncateUserAgent, validatePushSubscription } from "@/lib/saude/push";

type Result = { ok: boolean; erro?: string };

/**
 * Salva (ou renova) a assinatura push DESTE aparelho para a pessoa logada.
 * household_id e user_id vêm de getAppContext(); user_agent vem do cabeçalho da requisição, nunca do cliente.
 * Sempre com a sessão do usuário (RLS): ninguém grava assinatura em nome de outra pessoa.
 */
export async function savePushSubscription(input: unknown): Promise<Result> {
  const ctx = await getAppContext();
  const parsed = validatePushSubscription(input);
  if (!parsed.ok) return { ok: false, erro: parsed.erro };
  const db = await createClient();
  const { error } = await db.from("push_subscriptions").upsert(
    {
      household_id: ctx.household.id,
      user_id: ctx.user.id,
      ...parsed.value,
      user_agent: truncateUserAgent((await headers()).get("user-agent")),
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" },
  );
  if (error) return { ok: false, erro: "Não foi possível ativar os avisos. Tente de novo." };
  return { ok: true };
}

/** Apaga a assinatura deste aparelho (só as da própria pessoa; o RLS garante). */
export async function removePushSubscription(endpoint: unknown): Promise<Result> {
  await getAppContext();
  if (!isValidPushEndpoint(endpoint)) return { ok: false, erro: "Assinatura inválida." };
  const db = await createClient();
  const { error } = await db.from("push_subscriptions").delete().eq("endpoint", endpoint);
  if (error) return { ok: false, erro: "Não foi possível desativar os avisos. Tente de novo." };
  return { ok: true };
}

/** Este aparelho (endpoint) está inscrito para a pessoa logada? */
export async function hasPushSubscription(endpoint: unknown): Promise<boolean> {
  await getAppContext();
  if (!isValidPushEndpoint(endpoint)) return false;
  const db = await createClient();
  const { data } = await db.from("push_subscriptions").select("id").eq("endpoint", endpoint).maybeSingle();
  return !!data;
}
