import { getAppContext } from "@/lib/data";
import { BottomNav, MobileTopBar, Sidebar } from "@/components/nav";
import { Plexus } from "@/components/plexus";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { household } = await getAppContext();

  return (
    <div className="relative flex min-h-dvh">
      <Plexus />
      <Sidebar familyName={household.name} />
      <div className="relative flex min-w-0 flex-1 flex-col">
        <MobileTopBar />
        <main className="pb-nav mx-auto w-full max-w-3xl flex-1 px-5 pt-5 md:px-10 md:pb-10 md:pt-10">
          {children}
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
