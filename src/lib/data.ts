import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Member = {
  id: string;
  user_id: string | null;
  name: string;
  relation: "titular" | "conjuge" | "filho" | "outro";
  birth_date: string | null;
  color: string;
};

export type Household = { id: string; name: string; invite_code: string };

/** Usuário logado (ou redireciona para o login). */
export const getUser = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) redirect("/login");
  return { id: claims.sub as string, email: (claims.email as string) ?? "" };
});

/** Família do usuário, ou null se ainda não tem. */
export const getHousehold = cache(async (): Promise<Household | null> => {
  const user = await getUser();
  const supabase = await createClient();
  const { data: link } = await supabase
    .from("household_users")
    .select("household_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!link) return null;

  const { data } = await supabase
    .from("households")
    .select("id, name, invite_code")
    .eq("id", link.household_id)
    .single();
  return data;
});

/** Contexto completo do app: exige família criada. */
export const getAppContext = cache(async () => {
  const user = await getUser();
  const household = await getHousehold();
  if (!household) redirect("/bem-vindo");

  const supabase = await createClient();
  const { data: members } = await supabase
    .from("members")
    .select("id, user_id, name, relation, birth_date, color")
    .eq("household_id", household.id)
    .order("created_at");

  const list = (members ?? []) as Member[];
  const me = list.find((m) => m.user_id === user.id) ?? null;
  return { user, household, members: list, me };
});
