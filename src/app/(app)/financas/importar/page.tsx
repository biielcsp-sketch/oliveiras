import { redirect } from "next/navigation";
import { getFinanceBase } from "@/lib/financas/data";
import { ImportWizard } from "../_components/import-wizard";

export const metadata = { title: "Importar extrato" };

export default async function ImportarPage() {
  const { accounts } = await getFinanceBase();
  const active = accounts.filter((a) => !a.archived);
  if (active.length === 0) redirect("/financas/contas/nova");
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        Baixe o extrato ou a fatura no app do banco em OFX (preferível) ou CSV. Reimportar o mesmo arquivo não duplica nada.
      </p>
      <ImportWizard accounts={active} />
    </div>
  );
}
