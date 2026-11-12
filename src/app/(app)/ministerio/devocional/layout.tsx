import { DevocionalTabs } from "../_components/subnav";

export default function DevocionalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-6">
      <DevocionalTabs />
      {children}
    </div>
  );
}
