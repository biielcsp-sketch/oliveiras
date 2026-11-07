import { ModulePlaceholder } from "@/components/module-placeholder";
import { MODULES } from "@/lib/modules";

export const metadata = { title: "Agenda" };

export default function Page() {
  return (
    <ModulePlaceholder
      module={MODULES[1]}
      items={[
        "Sincronização com o Google Calendar de cada um",
        "Visão combinada do casal",
        "Consultas, escalas e manutenções aparecem sozinhas",
        "Lembretes",
      ]}
    />
  );
}
