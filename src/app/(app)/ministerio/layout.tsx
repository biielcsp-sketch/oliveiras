import { ModuleTop } from "@/components/module-top";
import { RefreshOnFocus } from "../casa/_components/refresh-on-focus";

export default function IgrejaLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ModuleTop module="ministerio" />
      <RefreshOnFocus />
      {children}
    </>
  );
}
