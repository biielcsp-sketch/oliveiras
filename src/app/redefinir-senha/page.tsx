import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NewPasswordForm } from "./new-password-form";

export const metadata = { title: "Redefinir senha" };

export default async function RedefinirSenhaPage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  // Sem sessão de recuperação: volta ao login com aviso. Vindo do callback (`erro=link`), o link falhou
  // e não há sessão (inválido, expirado ou já usado). Com sessão, segue (link aberto duas vezes ao mesmo tempo).
  if (!data?.claims?.sub) {
    const { erro } = await searchParams;
    redirect(erro === "link" ? "/login?erro=link" : "/login?erro=sessao");
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-6 py-12">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Redefinir senha</h1>
        <p className="mt-1 text-sm text-muted">Escolha uma nova senha com pelo menos 8 caracteres.</p>
      </div>
      <NewPasswordForm />
    </main>
  );
}
