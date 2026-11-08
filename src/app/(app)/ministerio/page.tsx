import { ModulePlaceholder } from "@/components/module-placeholder";
import { MODULES } from "@/lib/modules";

export const metadata = { title: "Igreja" };

export default function Page() {
  return (
    <ModulePlaceholder
      module={MODULES[4]}
      items={[
        "Escalas de serviço (vão para a agenda)",
        "Pessoas acompanhadas e follow-up",
        "Consolidação e GC",
        "Estudos, materiais e anotações",
      ]}
    />
  );
}
