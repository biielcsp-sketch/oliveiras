import { FinanceSubnav } from "./_components/subnav";

export default function FinancasLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Finanças</h1>
      <FinanceSubnav />
      {children}
    </>
  );
}
