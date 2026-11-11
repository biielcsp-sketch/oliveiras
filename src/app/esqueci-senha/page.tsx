import Link from "next/link";
import { ResetRequestForm } from "./reset-request-form";

export const metadata = { title: "Esqueci minha senha" };

export default function EsqueciSenhaPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-6 py-12">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Esqueci minha senha</h1>
        <p className="mt-1 text-sm text-muted">Informe o e-mail da sua conta para receber um link de redefinição.</p>
      </div>
      <ResetRequestForm />
      <Link href="/login" className="text-center text-sm text-muted underline-offset-4 hover:underline">
        Voltar para o login
      </Link>
    </main>
  );
}
