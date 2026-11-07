import { X } from "lucide-react";
import { Card } from "@/components/ui";
import { CATEGORY_KIND_LABEL, getFinanceBase, type CategoryKind } from "@/lib/financas/data";
import { deleteCategory, deleteRule } from "../actions";
import { AddCategoryForm, AddRuleForm, ApplyRulesButton } from "../_components/category-forms";

export const metadata = { title: "Categorias" };

const KINDS: CategoryKind[] = ["despesa", "receita", "transferencia"];

export default async function CategoriasPage() {
  const { categories, rules } = await getFinanceBase();
  const catById = new Map(categories.map((c) => [c.id, c]));

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <h2 className="font-medium">Regras automáticas</h2>
        <p className="mb-4 mt-1 text-sm text-muted">
          Na importação, a descrição que contém o texto recebe a categoria. Maiúsculas e acentos não importam.
        </p>
        <AddRuleForm categories={categories} />
        <ul className="mt-4 divide-y divide-line">
          {rules.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-2.5 text-sm">
              <span className="min-w-0 flex-1 truncate">
                <span className="font-mono">“{r.pattern}”</span>
                <span className="text-muted"> → {catById.get(r.category_id)?.name}</span>
              </span>
              <form action={deleteRule}>
                <input type="hidden" name="id" value={r.id} />
                <button aria-label={`Remover regra ${r.pattern}`} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-danger">
                  <X size={15} />
                </button>
              </form>
            </li>
          ))}
        </ul>
        <div className="mt-4">
          <ApplyRulesButton />
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 font-medium">Categorias</h2>
        <AddCategoryForm />
        {KINDS.map((kind) => (
          <section key={kind} className="mt-5">
            <h3 className="text-[13px] font-medium text-muted">{CATEGORY_KIND_LABEL[kind]}</h3>
            <ul className="mt-2 flex flex-wrap gap-2">
              {categories.filter((c) => c.kind === kind).map((c) => (
                <li key={c.id} className="flex items-center gap-1.5 rounded-full border border-line py-1 pl-3 pr-1 text-sm">
                  <span className="size-2 rounded-full" style={{ background: c.color }} />
                  {c.name}
                  <form action={deleteCategory}>
                    <input type="hidden" name="id" value={c.id} />
                    <button aria-label={`Remover categoria ${c.name}`} className="grid size-6 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-danger">
                      <X size={13} />
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <p className="mt-5 text-[13px] text-muted">
          Ao remover uma categoria, os lançamentos dela ficam “sem categoria”. Transferências (como pagamento de fatura) não
          entram em entradas e saídas, para a compra no cartão não ser contada duas vezes. Crédito sem categoria em cartão também fica fora; um estorno com categoria de despesa abate o gasto.
        </p>
      </Card>
    </div>
  );
}
