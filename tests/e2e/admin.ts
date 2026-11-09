// Acesso de administrador ao Supabase LOCAL, só para preparar dados de teste.
// A chave vem do `supabase status` no CI/local; nunca existe no app.
import { createClient } from "@supabase/supabase-js";

export function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
  if (!url || !key || !/127\.0\.0\.1|localhost/.test(url)) {
    throw new Error("Testes de admin só rodam contra o Supabase local (defina SUPABASE_TEST_SERVICE_ROLE_KEY).");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Cria usuário confirmado + família com id fixo (o id autorizado para a Pluggy nos testes). */
export async function createFamilyWithId(householdId: string, email: string, password: string) {
  const admin = adminClient();
  await admin.from("households").delete().eq("id", householdId);
  const { data: user, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !user.user) throw error ?? new Error("usuário não criado");
  const uid = user.user.id;
  for (const [table, row] of [
    ["households", { id: householdId, name: "Família E2E", created_by: uid }],
    ["household_users", { household_id: householdId, user_id: uid, role: "owner" }],
    ["members", { household_id: householdId, user_id: uid, name: "Gabriel", relation: "titular" }],
  ] as const) {
    const { error: e } = await admin.from(table).insert(row);
    if (e) throw e;
  }
}

/** Segundo adulto (cônjuge) na família: usuário confirmado + vínculo + membro. */
export async function addSpouse(householdId: string, email: string, password: string, name: string) {
  const admin = adminClient();
  const { data: user, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !user.user) throw error ?? new Error("usuário não criado");
  const uid = user.user.id;
  for (const [table, row] of [
    ["household_users", { household_id: householdId, user_id: uid, role: "member" }],
    ["members", { household_id: householdId, user_id: uid, name, relation: "conjuge" }],
  ] as const) {
    const { error: e } = await admin.from(table).insert(row);
    if (e) throw e;
  }
}
