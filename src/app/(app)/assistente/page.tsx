import { createClient } from "@/lib/supabase/server";
import { getAppContext } from "@/lib/data";
import { getRecentOliMessages } from "@/lib/oli/history";
import { OliHome } from "@/components/oli/oli-home";
import { PageTop } from "@/components/page-top";

export const metadata = { title: "Oli" };

/** Tela do Oli, o assistente da família (voz, texto e "+" de arquivo). */
export default async function AssistentePage() {
  // Exige família criada (sem ela, vai para /bem-vindo), como nas demais telas.
  await getAppContext();
  const history = await getRecentOliMessages(await createClient(), 40);
  const initialLog = history.map((m) => ({ id: m.id, role: m.role, text: m.content }));

  return (
    <>
      <PageTop title="Oli" backHref="/inicio" backLabel="Voltar para o Início" />
      <OliHome initialLog={initialLog} />
    </>
  );
}
