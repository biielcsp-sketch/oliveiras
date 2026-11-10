import { ModuleHero } from "@/components/module-hero";
import { FinanceSubnav } from "./_components/subnav";
import { AutoSync } from "./_components/open-finance-forms";

export default function FinancasLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ModuleHero title="Finanças">
        <FinanceSubnav />
      </ModuleHero>
      <AutoSync />
      {children}
    </>
  );
}
