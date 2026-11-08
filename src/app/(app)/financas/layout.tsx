import { FinanceSubnav } from "./_components/subnav";
import { AutoSync } from "./_components/open-finance-forms";

export default function FinancasLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Finanças</h1>
      <FinanceSubnav />
      <AutoSync />
      {children}
    </>
  );
}
