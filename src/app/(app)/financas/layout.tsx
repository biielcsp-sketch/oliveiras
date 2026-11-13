import { ModuleTop } from "@/components/module-top";
import { HeroDrawerProvider } from "@/components/hero-drawer";
import { AutoSync } from "./_components/open-finance-forms";

export default function FinancasLayout({ children }: { children: React.ReactNode }) {
  return (
    <HeroDrawerProvider>
      <ModuleTop module="financas" />
      <AutoSync />
      {children}
    </HeroDrawerProvider>
  );
}
