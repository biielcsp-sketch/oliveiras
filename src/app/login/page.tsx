import { LogoMark } from "@/components/logo";
import { LoginForm } from "./login-form";
import { OfflineCardsWipe } from "@/components/offline-cards";

export const metadata = { title: "Entrar" };

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-6 py-12">
      <div className="mb-10 flex flex-col items-center text-center">
        <LogoMark size={56} />
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">Oliveira&apos;s</h1>
        <p className="mt-1 text-sm text-muted">A vida da família em um só lugar.</p>
      </div>
      {/* Sair da conta cai aqui: apaga as carteirinhas offline deste aparelho. */}
      <OfflineCardsWipe />
      <LoginForm />
    </main>
  );
}
