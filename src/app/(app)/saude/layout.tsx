import { ModuleHero } from "@/components/module-hero";
import { SaudeSubnav } from "./_components/subnav";

export default function SaudeLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ModuleHero title="Saúde">
        <SaudeSubnav />
      </ModuleHero>
      {children}
    </>
  );
}
