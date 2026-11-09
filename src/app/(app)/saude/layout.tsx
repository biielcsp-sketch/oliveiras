import { SaudeSubnav } from "./_components/subnav";

export default function SaudeLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <h1 className="mb-5 text-[26px] font-semibold tracking-tight">Saúde</h1>
      <SaudeSubnav />
      {children}
    </>
  );
}
