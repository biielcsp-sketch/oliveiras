import { ModuleHero } from "@/components/module-hero";
import { RefreshOnFocus } from "../casa/_components/refresh-on-focus";
import { IgrejaSubnav } from "./_components/subnav";

export default function IgrejaLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ModuleHero title="Igreja">
        <IgrejaSubnav />
      </ModuleHero>
      <RefreshOnFocus />
      {children}
    </>
  );
}
