"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import clsx from "clsx";
import { Check, FileSearch, Plus } from "lucide-react";
import { Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { FileButtons } from "@/components/file-buttons";
import { Modal } from "@/components/modal";
import { formatBRL } from "@/lib/financas/money";
import { brDate } from "@/lib/agenda/dates";
import {
  OLI_FILE_DEST_LABEL,
  OLI_FILE_DESTS,
  OLI_FILE_FIELDS,
  OLI_FILE_KEEPS_FILE,
  OLI_FILE_KIND_LABEL,
  prefillFor,
  type OliFileDest,
  type OliFileField,
  type OliFileOptions,
} from "@/lib/oli/arquivo";
import type { ArquivoPreview, ConfirmStatus } from "@/lib/oli/panels";

/** Botão "+" ao lado do campo de texto: abre a folha com PDF / Imagem / Foto. */
export function OliAddFile({ busy, onFile }: { busy: boolean; onFile: (file: File) => void }) {
  const [open, setOpen] = useState(false);

  function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite escolher o mesmo arquivo de novo
    if (!file) return;
    setOpen(false);
    onFile(file);
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        aria-label={busy ? "Lendo arquivo…" : "Adicionar arquivo"}
        aria-haspopup="dialog"
        size="icon"
        className="text-deep"
        disabled={busy}
        onClick={() => setOpen(true)}
      >
        <Plus size={22} aria-hidden className={clsx(busy && "animate-pulse")} />
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Adicionar arquivo">
        <p className="mb-4 text-[15px] leading-snug text-muted">
          O Oli lê o documento e sugere onde guardar. Nada é gravado sem você conferir e tocar em Confirmar.
        </p>
        <FileButtons label="PDF ou JPG, até 4 MB" onPick={pick} disabled={busy} />
      </Modal>
    </>
  );
}

const DONE: Record<Exclude<OliFileDest, "nenhum">, string> = {
  financas: "Documento criado. Abrindo a conferência em Finanças…",
  saude_exame: "Exame salvo em Saúde.",
  saude_vacina: "Vacina salva em Saúde.",
  saude_procedimento: "Procedimento salvo em Saúde.",
  saude_carteirinha: "Carteirinha salva em Saúde.",
  saude_medicamento: "Medicamento salvo em Saúde.",
  casa_documento: "Documento salvo em Casa.",
  pet_saude: "Registro salvo no Pet.",
};

/** Painel do arquivo lido: o que foi lido, destino (trocável) e campos editáveis; grava só no Confirmar. */
export function ArquivoPanel({
  id,
  data,
  status,
  erro,
  onConfirm,
  onCancel,
}: {
  id: string;
  data: ArquivoPreview;
  status: ConfirmStatus;
  erro?: string;
  onConfirm: (id: string, dest: OliFileDest, values: Record<string, string>) => void;
  onCancel: (id: string) => void;
}) {
  const [dest, setDest] = useState<OliFileDest>(data.destino);
  const open = status === "pendente" || status === "salvando";
  const r = data.leitura;
  const fields = OLI_FILE_FIELDS[dest];
  const initial = prefillFor(r, dest, data.opcoes);
  const noPets = dest === "pet_saude" && data.opcoes.pets.length === 0;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (dest === "nenhum" || noPets) return;
    const fd = new FormData(e.currentTarget);
    const values: Record<string, string> = {};
    for (const f of fields) values[f.name] = String(fd.get(f.name) ?? "");
    onConfirm(id, dest, values);
  }

  return (
    <Card className={clsx(open && "ring-2 ring-primary/40")} role="group" aria-label="Arquivo lido pelo Oli">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="flex min-w-0 items-center gap-2 text-[15px] font-semibold">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-primary">
            <FileSearch size={16} aria-hidden />
          </span>
          <span className="truncate">{OLI_FILE_KIND_LABEL[r.tipo]}</span>
        </h3>
        <span className="min-w-0 truncate text-[13px] text-muted">{data.nome_arquivo}</span>
      </div>

      {r.resumo && <p className="mb-3 text-[15px] leading-relaxed" data-testid="arquivo-resumo">{r.resumo}</p>}
      <dl className="mb-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[15px]">
        {r.beneficiario && (<><dt className="text-muted">Beneficiário</dt><dd className="truncate">{r.beneficiario}</dd></>)}
        {r.valor !== null && (<><dt className="text-muted">Valor</dt><dd className="tabular-nums">{formatBRL(r.valor)}</dd></>)}
        {r.vencimento && (<><dt className="text-muted">Vencimento</dt><dd className="tabular-nums">{brDate(r.vencimento)}</dd></>)}
        {r.data_pagamento && (<><dt className="text-muted">Pago em</dt><dd className="tabular-nums">{brDate(r.data_pagamento)}</dd></>)}
      </dl>

      {open ? (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field label="Guardar em">
            <Select value={dest} onChange={(e) => setDest(e.target.value as OliFileDest)} disabled={status === "salvando"}>
              {OLI_FILE_DESTS.map((d) => (
                <option key={d} value={d}>
                  {OLI_FILE_DEST_LABEL[d]}
                </option>
              ))}
            </Select>
          </Field>
          {/* key: trocar o destino recria os campos com os valores lidos para ele */}
          <fieldset key={dest} disabled={status === "salvando"} className="flex flex-col gap-3">
            {fields.map((f) => (
              <FieldInput key={f.name} field={f} value={initial[f.name] ?? ""} opcoes={data.opcoes} />
            ))}
          </fieldset>
          {dest === "financas" && <p className="text-[13px] text-muted">Conta fixa ou avulsa, valor e vencimento você confere na próxima tela.</p>}
          {!OLI_FILE_KEEPS_FILE[dest] && dest !== "nenhum" && <p className="text-[13px] text-muted">Este destino guarda só os dados, sem o arquivo.</p>}
          {noPets && <p className="text-[13px] text-danger">Cadastre o pet em Casa › Pet antes.</p>}
          {erro && (
            <p role="alert" className="text-sm font-medium text-danger">
              {erro}
            </p>
          )}
          {dest === "nenhum" ? (
            <Button type="button" variant="ghost" className="mt-1 min-h-11" onClick={() => onCancel(id)}>
              Fechar sem guardar
            </Button>
          ) : (
            <div className="mt-1 grid grid-cols-2 gap-3">
              <Button type="button" variant="ghost" className="min-h-11" disabled={status === "salvando"} onClick={() => onCancel(id)}>
                Cancelar
              </Button>
              <Button type="submit" className="min-h-11" disabled={status === "salvando" || noPets}>
                {status === "salvando" ? "Salvando…" : (<><Check size={18} aria-hidden /> Confirmar</>)}
              </Button>
            </div>
          )}
        </form>
      ) : (
        <p role="status" className={clsx("text-sm font-medium", status === "erro" ? "text-danger" : "text-muted")}>
          {status === "erro"
            ? (erro ?? "Não foi possível concluir.")
            : status === "criado"
              ? dest !== "nenhum"
                ? DONE[dest]
                : "Pronto."
              : "Nada foi guardado."}
        </p>
      )}
    </Card>
  );
}

function FieldInput({ field: f, value, opcoes }: { field: OliFileField; value: string; opcoes: OliFileOptions }) {
  if (f.type === "select") {
    const options =
      f.options === "pessoas" || f.options === "pets"
        ? opcoes[f.options].map((o) => ({ value: o.id, label: o.name }))
        : (f.options ?? []);
    const dynamic = f.options === "pessoas" || f.options === "pets";
    return (
      <Field label={f.label}>
        <Select name={f.name} defaultValue={value} required={f.required}>
          {dynamic && <option value="">Escolha…</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>
    );
  }
  if (f.type === "textarea") {
    return (
      <Field label={f.label}>
        <Textarea name={f.name} defaultValue={value} maxLength={f.max} required={f.required} />
      </Field>
    );
  }
  return (
    <Field label={f.label}>
      <Input name={f.name} type={f.type} defaultValue={value} maxLength={f.max} required={f.required} autoComplete="off" />
    </Field>
  );
}
