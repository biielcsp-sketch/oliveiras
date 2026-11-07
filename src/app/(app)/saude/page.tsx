import { ModulePlaceholder } from "@/components/module-placeholder";
import { MODULES } from "@/lib/modules";

export const metadata = { title: "Saúde" };

export default function Page() {
  return (
    <ModulePlaceholder
      module={MODULES[2]}
      items={[
        "Carteirinhas do convênio (funcionam offline)",
        "Consultas e retornos",
        "Exames com PDF anexado",
        "Procedimentos",
        "Medicamentos",
        "Vacinas do filho",
      ]}
    />
  );
}
