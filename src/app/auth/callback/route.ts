import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/auth-redirect";

/** Link de e-mail (confirmação ou redefinição de senha): troca o código pela sessão. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    // O destino vem de lista permitida: nunca redireciona para fora do app.
    if (!error) return NextResponse.redirect(`${origin}${safeNextPath(searchParams.get("next"))}`);
  }
  return NextResponse.redirect(`${origin}/login?erro=link`);
}
