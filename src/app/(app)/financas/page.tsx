import { ModulePlaceholder } from "@/components/module-placeholder";
import { MODULES } from "@/lib/modules";

export const metadata = { title: "Finanças" };

export default function Page() {
  return (
    <ModulePlaceholder
      module={MODULES[0]}
      items={[
        "Contas e cartões via Open Finance (Meu Pluggy)",
        "Importação de extrato OFX/CSV",
        "Categorias com regras automáticas",
        "Faturas de cartão e contas a pagar",
        "Orçamento mensal do casal",
        "Metas e patrimônio",
      ]}
    />
  );
}
