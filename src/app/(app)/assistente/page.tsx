import { ModulePlaceholder } from "@/components/module-placeholder";
import { ASSISTANT } from "@/lib/modules";

export const metadata = { title: "Assistente" };

export default function Page() {
  return (
    <ModulePlaceholder
      module={ASSISTANT}
      items={[
        "Chat com acesso a todas as áreas",
        "Resumo da semana no Início",
        "Lança gastos e eventos (com sua confirmação)",
        "Gemini, com troca fácil de provedor",
      ]}
    />
  );
}
