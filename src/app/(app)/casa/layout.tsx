import { ModuleTop } from "@/components/module-top";
import { RefreshOnFocus } from "./_components/refresh-on-focus";

export default function CasaLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ModuleTop module="casa" />
      <RefreshOnFocus />
      {children}
    </>
  );
}
