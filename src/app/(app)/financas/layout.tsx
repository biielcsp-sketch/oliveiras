import { ModuleHero } from "@/components/module-hero";
import { HeroDrawerProvider } from "@/components/hero-drawer";
import { FinanceSubnav } from "./_components/subnav";
import { AutoSync } from "./_components/open-finance-forms";

export default function FinancasLayout({ children }: { children: React.ReactNode }) {
  return (
    <HeroDrawerProvider>
      <ModuleHero title="Finanças" drawerLabel="saldo das contas">
        <FinanceSubnav />
      </ModuleHero>
      <AutoSync />
      {children}
    </HeroDrawerProvider>
  );
}
