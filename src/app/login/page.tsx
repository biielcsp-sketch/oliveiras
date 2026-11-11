import { LoginOli } from "@/components/oli/login-oli";
import { LoginForm } from "./login-form";
import { OfflineCardsWipe } from "@/components/offline-cards";

export const metadata = { title: "Entrar" };

// Só chaves conhecidas viram mensagem: nada vindo da URL é exibido.
const NOTICES: Record<string, string> = {
  link: "Este link é inválido ou expirou. Peça um novo link em “Esqueci minha senha”.",
  sessao: "Abra o link de redefinição enviado ao seu e-mail para escolher uma nova senha.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const { erro } = await searchParams;
  const notice = typeof erro === "string" && Object.hasOwn(NOTICES, erro) ? NOTICES[erro] : undefined;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-6 py-12">
      <div className="mb-8 flex flex-col items-center text-center">
        <LoginOli />
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">Oliveira&apos;s</h1>
        <p className="mt-1 text-sm text-muted">A vida da família em um só lugar.</p>
      </div>
      {/* Sair da conta cai aqui: apaga as carteirinhas offline deste aparelho. */}
      <OfflineCardsWipe />
      <LoginForm notice={notice} />
    </main>
  );
}
