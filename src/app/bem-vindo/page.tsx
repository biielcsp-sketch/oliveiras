import { redirect } from "next/navigation";
import { getHousehold } from "@/lib/data";
import { AuthShell } from "@/components/auth-shell";
import { OnboardingForm } from "./onboarding-form";

export const metadata = { title: "Bem-vindo" };

export default async function BemVindoPage() {
  if (await getHousehold()) redirect("/inicio");

  return (
    <AuthShell title="Bem-vindo" subtitle="Crie a família, ou entre com o código que está no app de quem já criou.">
      <OnboardingForm />
    </AuthShell>
  );
}
