import { getAppContext } from "@/lib/data";
import { BottomNav, Sidebar } from "@/components/nav";
import { InstallPrompt } from "@/components/install-prompt";
import { OfflineCardsSync } from "@/components/offline-cards";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { household, user } = await getAppContext();

  return (
    <div className="relative flex min-h-dvh">
      <Sidebar familyName={household.name} />
      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* Cada tela traz o próprio topo (cabeçalho azul no Início; voltar + título nas demais). */}
        <main className="pb-nav mx-auto w-full max-w-3xl flex-1 px-4 pt-[calc(env(safe-area-inset-top)+12px)] md:px-10 md:pb-10 md:pt-8">
          {children}
        </main>
      </div>
      <BottomNav />
      <InstallPrompt />
      {/* Outro usuário neste aparelho: apaga as carteirinhas offline do anterior. */}
      <OfflineCardsSync userId={user.id} />
    </div>
  );
}
