import { FinanceSubnav } from "./_components/subnav";
import { AutoSync } from "./_components/open-finance-forms";

export default function FinancasLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <h1 className="mb-5 text-[26px] font-semibold tracking-tight">Finanças</h1>
      <FinanceSubnav />
      <AutoSync />
      {children}
    </>
  );
}
