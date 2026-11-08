import { createBrowserClient } from "@supabase/ssr";

/**
 * Cliente Supabase do navegador, usado só onde o navegador precisa falar com o Auth
 * diretamente (cerimônia WebAuthn das digitais). Usa apenas a chave publicável.
 * O @supabase/ssr guarda a sessão em cookies, então o servidor (`auth.getClaims()`
 * no proxy) reconhece o login feito aqui.
 *
 * Passkeys: no auth-js 2.119 já vêm ligadas por padrão (`auth.experimental.passkey`
 * está marcado como obsoleto e é ignorado), então não passamos a flag.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
