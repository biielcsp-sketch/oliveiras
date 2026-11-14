import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { ResetRequestForm } from "./reset-request-form";

export const metadata = { title: "Esqueci minha senha" };

export default function EsqueciSenhaPage() {
  return (
    <AuthShell
      title="Esqueci minha senha"
      subtitle="Informe o e-mail da sua conta para receber um link de redefinição."
      footer={
        <Link href="/login" className="inline-flex min-h-11 items-center justify-center text-center text-sm font-medium text-link underline-offset-4 hover:underline">
          Voltar para o login
        </Link>
      }
    >
      <ResetRequestForm />
    </AuthShell>
  );
}
