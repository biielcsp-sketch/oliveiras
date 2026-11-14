import { LoginOli } from "@/components/oli/login-oli";
import { cookies } from "next/headers";
import { RememberedLogin } from "./remembered-login";
import { REMEMBER_COOKIE, parseRememberedEmail } from "@/lib/remember";
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

  const remembered = parseRememberedEmail((await cookies()).get(REMEMBER_COOKIE)?.value);

  return (
    <main className="login-screen">
      <div className="mx-auto flex min-h-dvh w-full max-w-sm flex-col px-6 pb-6 pt-[max(1.5rem,env(safe-area-inset-top))]">
        <LoginOli />
        <div className="mb-4 flex flex-col items-center text-center">
          <h1 className="text-[24px] font-bold tracking-tight">Oliveira&apos;s</h1>
          <p className="ls-soft mt-1 text-sm">A vida da família em um só lugar.</p>
        </div>
        {/* Sair da conta cai aqui: apaga as carteirinhas offline deste aparelho. */}
        <OfflineCardsWipe />
        <div className="glass-card rounded-[24px] p-5">
          {remembered ? <RememberedLogin email={remembered} notice={notice} /> : <LoginForm notice={notice} />}
        </div>
      </div>
    </main>
  );
}
