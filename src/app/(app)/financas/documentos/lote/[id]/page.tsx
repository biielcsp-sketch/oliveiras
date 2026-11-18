import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, LinkButton, PageHeader } from "@/components/ui";
import { formatBRL } from "@/lib/financas/money";
import { UUID_RE } from "@/lib/financas/transaction-input";
import { getBatchDocuments, getDocsByBarcodes } from "@/lib/financas/documentos/data";
import { batchCards, batchCodes } from "@/lib/financas/documentos/batch";
import { KIND_LABEL, STATUS_LABEL } from "@/lib/financas/documentos/rules";

export const metadata = { title: "Documentos do arquivo" };

const br = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "—");

/**
 * Lote: vários boletos/comprovantes lidos do mesmo arquivo. A URL leva só o id de um documento; a tela acha os
 * outros pelo mesmo arquivo, sempre pela sessão (RLS) e pela família do servidor. Cada card abre a conferência
 * de sempre (`?lote=1`), que volta para cá ao confirmar ou descartar. Texto lido do arquivo só como texto do React.
 */
export default async function LotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const docs = await getBatchDocuments(id);
  if (!docs) notFound();
  const { cards, done, total } = batchCards(docs, await getDocsByBarcodes(batchCodes(docs)));

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <PageHeader
          title={total === 1 ? "1 documento encontrado" : `${total} documentos encontrados`}
          subtitle={`${done} de ${total} conferidos`}
          action={
            <a href={`/financas/documentos/${id}/arquivo`} target="_blank" rel="noopener" className="text-[15px] font-medium text-link">
              Abrir arquivo
            </a>
          }
        />
        <p className="text-[15px] text-muted">Confira um por um. Nada vira conta ou lançamento sem você confirmar.</p>
      </Card>
      <ul className="grid gap-3 sm:grid-cols-2" data-testid="lote-documentos">
        {cards.map((c, i) => {
          const label = c.payee ?? `${KIND_LABEL[c.kind]} sem beneficiário`;
          return (
            <li key={c.id} className="h-full">
              <Card className="flex h-full flex-col gap-3" role="group" aria-label={`Documento ${i + 1} de ${total}`}>
                <div className="flex items-start justify-between gap-3">
                  <h2 className="min-w-0 truncate font-medium">{label}</h2>
                  <Badge tone={c.status === "pendente" ? "warning" : c.status === "confirmado" ? "success" : "neutral"}>{STATUS_LABEL[c.status]}</Badge>
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[15px]">
                  <dt className="text-muted">Valor</dt>
                  <dd className="tabular-nums">{c.amount !== null ? formatBRL(c.amount) : "—"}</dd>
                  {c.kind === "comprovante" ? (
                    <>
                      <dt className="text-muted">Pago em</dt>
                      <dd className="tabular-nums">{br(c.paid_on)}</dd>
                    </>
                  ) : (
                    <>
                      <dt className="text-muted">Vencimento</dt>
                      <dd className="tabular-nums">{br(c.due_date)}</dd>
                    </>
                  )}
                </dl>
                {c.aviso && (
                  <p role="alert" className="rounded-2xl bg-warning-soft px-3 py-2 text-sm text-warning">
                    {c.aviso}
                  </p>
                )}
                <div className="mt-auto flex justify-start">
                  {c.status === "pendente" ? (
                    <LinkButton href={`/financas/documentos/${c.id}?lote=1`} size="sm" aria-label={`Conferir ${label}`}>
                      Conferir
                    </LinkButton>
                  ) : (
                    <Link href={`/financas/documentos/${c.id}?lote=1`} className="text-sm font-medium text-link">
                      Ver documento
                    </Link>
                  )}
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
      <Link href="/financas/documentos" className="block text-center text-[15px] font-medium text-link">
        Ver todos os documentos
      </Link>
    </div>
  );
}
