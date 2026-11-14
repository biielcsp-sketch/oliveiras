import { ModuleHeroCard } from "@/components/module-home";
import { getIgrejaResumo } from "@/lib/igreja/resumo";
import { IgrejaResumoTiles } from "./_components/resumo-tiles";

export const metadata = { title: "Igreja" };

/** Resumo da Igreja: só os itens do próprio usuário (dados pessoais). */
export default async function Page() {
  const tiles = await getIgrejaResumo();
  return (
    <div className="flex flex-col gap-6">
      <ModuleHeroCard title="Conecte-se com a sua igreja" subtitle="Faça parte desta família." image="/ilustracoes/igreja.webp" />
      <section aria-labelledby="resumo-titulo" className="min-w-0">
        <h2 id="resumo-titulo" className="mb-2 text-[15.5px] font-semibold tracking-tight">
          Resumo
        </h2>
        <IgrejaResumoTiles tiles={tiles} />
      </section>
    </div>
  );
}
