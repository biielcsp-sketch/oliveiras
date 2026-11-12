import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { agendaAllowedFor, carismaAllowedFor } from "@/lib/family-access";
import { DRIVE_SCOPE, googleConfigured, googleCredentials, hasScope } from "@/lib/google/config";
import { sealToken, tokenAad } from "@/lib/google/crypto";
import {
  checkState,
  decodeState,
  exchangeCode,
  GoogleOAuthError,
  rememberAccessToken,
  revokeToken,
  STATE_COOKIE,
  STATE_COOKIE_PATH,
} from "@/lib/google/oauth";
import { refreshCalendarList } from "@/lib/google/agenda";

/**
 * Volta do Google: confere state (tempo constante) e sessão, troca o code (com code_verifier),
 * valida o id_token, cifra o refresh token e salva a conta + agendas. Erros não vazam detalhes.
 * Pedido do Carisma (state.drive): volta para /ministerio/carisma e avisa se o Drive não foi autorizado.
 */
export async function GET(request: NextRequest) {
  const { origin, searchParams } = request.nextUrl;
  const saved = decodeState(request.cookies.get(STATE_COOKIE)?.value);
  const back = saved?.drive ? "/ministerio/carisma" : "/agenda";
  const go = (google: string) => {
    const res = NextResponse.redirect(`${origin}${back}?google=${google}`, { headers: { "Cache-Control": "no-store" } });
    res.cookies.set(STATE_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: STATE_COOKIE_PATH, maxAge: 0 });
    return res;
  };

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const uid = data?.claims?.sub as string | undefined;
  if (!uid) return NextResponse.redirect(`${origin}/login`);
  if (!checkState(saved, searchParams.get("state"), uid)) return go("erro");
  if (searchParams.get("error")) return go("cancelado");
  const code = searchParams.get("code");
  if (!code || code.length > 2048) return go("erro");

  const { data: me } = await supabase.from("members").select("id, household_id").eq("user_id", uid).maybeSingle();
  const agendaOn = !!me && agendaAllowedFor(me.household_id);
  const carismaOn = !!me && saved?.drive === true && carismaAllowedFor(me.household_id);
  if (!me || !(agendaOn || carismaOn) || !googleConfigured()) return go("erro");
  const hid = me.household_id as string;

  let tokens: Awaited<ReturnType<typeof exchangeCode>>;
  try {
    tokens = await exchangeCode(code, saved!.verifier, `${origin}/api/google/callback`);
  } catch (e) {
    const reason = e instanceof GoogleOAuthError && e.code === "missing_scopes" ? "permissoes" : "erro";
    console.error("Google: falha na troca do código:", e instanceof GoogleOAuthError ? (e.code ?? e.message) : "erro");
    return go(reason);
  }

  try {
    const { sub, email } = tokens.identity;
    const { data: existing } = await supabase
      .from("google_accounts")
      .select("id, member_id")
      .eq("household_id", hid)
      .eq("google_sub", sub)
      .maybeSingle();
    if (existing && existing.member_id !== me.id) {
      // A mesma conta Google já é de outra pessoa da família: não troca o dono.
      await revokeToken(tokens.refreshToken).catch(() => false);
      return go("em-uso");
    }
    const ciphertext = sealToken(tokens.refreshToken, googleCredentials().clientSecret, tokenAad(hid, sub));
    const fields = { email, token_ciphertext: ciphertext, scopes: tokens.scope.slice(0, 1000), status: "ok", last_error: null };
    let accountId: string;
    if (existing) {
      // Reconexão: só colunas que o app pode atualizar (dono, família e sub são imutáveis).
      const { error } = await supabase.from("google_accounts").update(fields).eq("id", existing.id).eq("household_id", hid);
      if (error) throw new Error("update");
      accountId = existing.id;
    } else {
      const { data: row, error } = await supabase
        .from("google_accounts")
        .insert({ ...fields, household_id: hid, member_id: me.id, google_sub: sub })
        .select("id")
        .single();
      if (error || !row) throw new Error("insert");
      accountId = row.id;
    }
    rememberAccessToken(accountId, ciphertext, tokens.accessToken, tokens.expiresIn);
    if (agendaOn) await refreshCalendarList(supabase, hid, accountId, tokens.accessToken);
    // A tela de consentimento deixa desmarcar o Drive: a conta fica salva (Agenda segue), mas o Carisma avisa.
    if (saved?.drive && !hasScope(tokens.scope, DRIVE_SCOPE)) return go("sem-drive");
    return go("conectado");
  } catch (e) {
    console.error("Google: falha ao salvar a conta:", e instanceof Error ? e.message : "erro");
    return go("erro");
  }
}
