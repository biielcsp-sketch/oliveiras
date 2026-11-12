import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { agendaAllowedFor, carismaAllowedFor } from "@/lib/family-access";
import { googleConfigured } from "@/lib/google/config";
import { buildAuthUrl, encodeState, newOAuthState, STATE_COOKIE, STATE_COOKIE_PATH, STATE_TTL_S } from "@/lib/google/oauth";

/**
 * Início do "Conectar Google" (link GET, navegação de página inteira).
 * Exige sessão e família autorizada; guarda state + code_verifier num cookie httpOnly curto
 * e manda a pessoa para a tela de consentimento do Google.
 * `?drive=1` (Carisma): pede também o escopo drive.file (incremental) e volta para /ministerio/carisma.
 */
const noStore = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const uid = data?.claims?.sub as string | undefined;
  if (!uid) return NextResponse.redirect(`${origin}/login`, { headers: noStore });

  const drive = request.nextUrl.searchParams.get("drive") === "1";
  const { data: me } = await supabase.from("members").select("id, household_id").eq("user_id", uid).maybeSingle();
  const allowed = me && (drive ? carismaAllowedFor(me.household_id) : agendaAllowedFor(me.household_id));
  if (!allowed) {
    return new Response(drive ? "O Carisma ainda não está liberado para esta família." : "A Agenda ainda não está liberada para esta família.", {
      status: 403,
      headers: { ...noStore, "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  const back = drive ? "/ministerio/carisma" : "/agenda";
  if (!googleConfigured()) return NextResponse.redirect(`${origin}${back}?google=nao-configurado`, { headers: noStore });

  const state = newOAuthState(uid, Date.now(), { drive });
  const res = NextResponse.redirect(buildAuthUrl(state, `${origin}/api/google/callback`), { headers: noStore });
  res.cookies.set(STATE_COOKIE, encodeState(state), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: STATE_COOKIE_PATH,
    maxAge: STATE_TTL_S,
  });
  return res;
}
