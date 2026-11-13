import { ModuleTop } from "@/components/module-top";

export default function SaudeLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ModuleTop module="saude" />
      {children}
    </>
  );
}
