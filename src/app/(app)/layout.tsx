import { getAppContext } from "@/lib/data";
import { BottomNav, MobileTopBar, Sidebar } from "@/components/nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { household } = await getAppContext();

  return (
    <div className="flex min-h-dvh">
      <Sidebar familyName={household.name} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileTopBar />
        <main className="pb-nav mx-auto w-full max-w-3xl flex-1 px-4 pt-6 md:px-10 md:pb-10 md:pt-10">
          {children}
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
