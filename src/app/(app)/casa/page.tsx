import { ModulePlaceholder } from "@/components/module-placeholder";
import { MODULES } from "@/lib/modules";

export const metadata = { title: "Casa" };

export default function Page() {
  return (
    <ModulePlaceholder
      module={MODULES[3]}
      items={[
        "Lista de compras",
        "Despensa e estoque",
        "Tarefas domésticas com rodízio",
        "Manutenção recorrente",
        "Contas fixas da casa",
        "Documentos e garantias",
        "Cardápio da semana",
        "Contatos de prestadores",
      ]}
    />
  );
}
