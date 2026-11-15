"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, FormError } from "@/components/ui";
import { FileLink } from "../shared";
import { ConfirmDelete } from "../shared";
import { formatSize } from "@/lib/saude/files";
import { deleteLabReport } from "../../exames-lab/actions";

export type ReportVM = { id: string; date: string; lab: string | null; mime: "application/pdf" | "image/jpeg" | null; size: number | null };

/** Coletas guardadas: abrir o PDF e apagar (com confirmação; apaga também os resultados e o arquivo). */
const dateLabel = (d: string) => d.split("-").reverse().join("/");

export function ReportsList({ reports }: { reports: ReportVM[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(id: string) {
    setPending(true);
    const r = await deleteLabReport(id);
    setPending(false);
    setError(r.ok ? null : (r.erro ?? "Não foi possível apagar."));
    setNotice(r.ok ? "Coleta apagada." : null);
    if (r.ok) router.refresh();
  }

  return (
    <section aria-label="Coletas guardadas" className="mt-2 flex flex-col gap-2">
      <h3 className="text-[15px] font-semibold">Coletas guardadas</h3>
      {notice && (
        <p role="status" className="text-sm text-primary">
          {notice}
        </p>
      )}
      <FormError message={error} />
      {reports.map((r) => (
        <Card key={r.id} data-testid="coleta" className="!p-3.5">
          <p className="text-[14px] font-medium">
            Coleta de {dateLabel(r.date)}
            {r.lab ? <span className="font-normal text-muted"> · {r.lab}</span> : null}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {r.mime && (
              <span>
                <FileLink href={`/saude/arquivo/exames-lab/${r.id}`} mime={r.mime} label={`Laudo de ${dateLabel(r.date)}`} />
                {r.size !== null && <span className="ml-2 text-xs text-muted">{formatSize(r.size)}</span>}
              </span>
            )}
            <ConfirmDelete what="esta coleta e todos os resultados dela" label="Apagar coleta" pending={pending} onConfirm={() => remove(r.id)} />
          </div>
        </Card>
      ))}
    </section>
  );
}
