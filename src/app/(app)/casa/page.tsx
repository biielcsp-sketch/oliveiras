import { ModuleHeroCard } from "@/components/module-home";
import { getCasaResumo } from "@/lib/casa/resumo";
import { CasaResumoTiles } from "./_components/resumo-tiles";

export const metadata = { title: "Casa" };

/** Resumo da Casa: compras, pet, tarefas, manutenções, contas da casa do mês, garantias, cardápio de hoje e prestadores. */
export default async function Page() {
  const tiles = await getCasaResumo();
  return (
    <div className="flex flex-col gap-6">
      <ModuleHeroCard title="Sua casa sempre organizada" subtitle="Tudo sob controle." image="/ilustracoes/casa.webp" />
      <section aria-labelledby="resumo-titulo" className="min-w-0">
        <h2 id="resumo-titulo" className="mb-2 text-[15.5px] font-semibold tracking-tight">
          Resumo
        </h2>
        <CasaResumoTiles tiles={tiles} />
      </section>
    </div>
  );
}
