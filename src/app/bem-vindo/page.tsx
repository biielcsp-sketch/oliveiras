import { redirect } from "next/navigation";
import { getHousehold } from "@/lib/data";
import { LogoMark } from "@/components/logo";
import { OnboardingForm } from "./onboarding-form";

export const metadata = { title: "Bem-vindo" };

export default async function BemVindoPage() {
  if (await getHousehold()) redirect("/inicio");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-6 py-12">
      <div className="mb-8">
        <LogoMark size={44} />
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">Bem-vindo</h1>
        <p className="mt-1 text-sm text-muted">
          Crie a família, ou entre com o código que está no app de quem já criou.
        </p>
      </div>
      <OnboardingForm />
    </main>
  );
}
