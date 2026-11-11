import { ModuleHero } from "@/components/module-hero";
import { CasaSubnav } from "./_components/subnav";
import { RefreshOnFocus } from "./_components/refresh-on-focus";

export default function CasaLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ModuleHero title="Casa">
        <CasaSubnav />
      </ModuleHero>
      <RefreshOnFocus />
      {children}
    </>
  );
}
