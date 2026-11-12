import Link from "next/link";
import clsx from "clsx";
import { Plus } from "lucide-react";
import { Card, EmptyState, LinkButton } from "@/components/ui";
import { getBillPayments, getBills, getOneOffBillsForMonth, getOneOffBoletoDocs } from "@/lib/financas/planning-data";
import { countPendingDocuments, getConfirmedBillDocs } from "@/lib/financas/documentos/data";
import { getAllBaixaSuggestions } from "@/lib/financas/baixa-data";
import { formatBRL } from "@/lib/financas/money";
import { parseMonth, shortDate } from "@/lib/financas/period";
import { todaySP } from "@/lib/financas/today";
import { HOME_STATUS_LABEL, homeBillsForMonth, type HomeBillStatus } from "@/lib/casa/contas";
import { billDeletePath, oneOffDeletePath, oneOffPath } from "@/lib/financas/routes";
import { MonthSwitcher } from "../../financas/_components/month-switcher";
import { DocUpload } from "../../financas/_components/doc-upload";

export const metadata = { title: "Contas · Casa" };

const statusCls: Record<HomeBillStatus, string> = {
  paga: "bg-accent-soft text-primary",
  em_aberto: "bg-surface-2 text-muted",
  atrasada: "bg-badge text-on-badge",
};

/** Contas fixas e avulsas marcadas como "da casa": os dados e as regras são os das Finanças (nada duplicado aqui). */
export default async function Page({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const month = parseMonth((await searchParams).mes);
  const today = todaySP();
  const [bills, payments, docs, suggestions, pendingDocs, oneOffs] = await Promise.all([
    getBills(),
    getBillPayments(month),
    getConfirmedBillDocs(month),
    getAllBaixaSuggestions(month),
    countPendingDocuments(),
    getOneOffBillsForMonth(month),
  ]);
  const homeOneOffs = oneOffs.filter((o) => o.is_home);
  const oneOffDocs = await getOneOffBoletoDocs(homeOneOffs.map((o) => o.id));
  const rows = homeBillsForMonth({
    bills,
    payments,
    docs,
    suggestionBillIds: suggestions.fixed.map((s) => s.bill_id),
    oneOffs: homeOneOffs,
    oneOffDocs,
    oneOffSuggestionIds: suggestions.oneOff.map((s) => s.one_off_bill_id),
    month,
    today,
  });
  const total = rows.reduce((s, r) => s + Math.round(r.amount * 100), 0) / 100;
  const financas = `/financas/contas-fixas?mes=${month}`;

  return (
    <div className="flex flex-col gap-4">
      <MonthSwitcher month={month} basePath="/casa/contas" />
      <div className="flex flex-wrap items-center justify-end gap-3">
        <LinkButton href="/financas/contas-fixas/nova?casa=1">
          <Plus size={16} aria-hidden /> Nova conta da casa
        </LinkButton>
      </div>
      <DocUpload pending={pendingDocs} origem="casa" mes={month} />
      {rows.length === 0 ? (
        <EmptyState title="Nenhuma conta da casa neste mês.">
          Marque “Conta da casa” numa conta fixa das Finanças (aluguel, condomínio, luz, água, gás, internet).
        </EmptyState>
      ) : (
        <Card className="py-1">
          <div className="flex items-baseline justify-between pt-3">
            <h2 className="font-medium">Contas da casa</h2>
            <span className="text-sm tabular-nums text-muted">{formatBRL(total)}</span>
          </div>
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={`${r.kind}:${r.id}`} data-testid="conta-casa" aria-label={r.name} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{r.name}</p>
                  {r.kind === "avulsa" && <p className="text-[12px] text-muted">Conta avulsa (só esta vez)</p>}
                  <p className="text-[12px] text-muted">
                    vence {shortDate(r.due)}
                    {r.paidOn && ` · paga em ${shortDate(r.paidOn)}`}
                    {r.doc && (
                      <>
                        {" · "}
                        <a href={`/financas/documentos/${r.doc.id}/arquivo`} target="_blank" rel="noopener" className="font-medium text-link">
                          {r.doc.mime === "application/pdf" ? "boleto (PDF)" : "boleto (foto)"}
                        </a>
                      </>
                    )}
                  </p>
                  {r.suggestions > 0 && (
                    <p className="text-[12px]">
                      <Link href={financas} className="font-medium text-link">
                        Possível pagamento no extrato: confira nas Finanças
                      </Link>
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="tabular-nums">{formatBRL(r.amount)}</span>
                  <span className="flex items-center gap-2">
                    <span data-testid="status" className={clsx("rounded-full px-2.5 py-1 text-[12px] font-medium leading-none", statusCls[r.status])}>
                      {HOME_STATUS_LABEL[r.status]}
                    </span>
                    {r.status !== "paga" && (
                      <Link
                        href={r.kind === "avulsa" ? `${oneOffPath(r.id)}/pagar` : `/financas/contas-fixas/${r.id}/pagar?mes=${month}`}
                        className="inline-flex min-h-11 items-center text-[12px] font-medium text-olive"
                      >
                        Marcar paga
                      </Link>
                    )}
                    <Link href={r.kind === "avulsa" ? oneOffDeletePath(r.id, "casa", month) : billDeletePath(r.id, "casa", month)} aria-label={`Excluir ${r.name}`} className="inline-flex min-h-11 items-center text-[12px] font-medium text-danger">
                      Excluir
                    </Link>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Link href={financas} className="self-start text-sm font-medium text-link">
        Ver na Finanças
      </Link>
    </div>
  );
}
