"use client";

import { startTransition, useActionState, useRef, useState } from "react";
import clsx from "clsx";
import { confirmImport, previewImport, type ImportState } from "../actions";
import { Button, Card, Field, FormError, Input, LinkButton, Select } from "@/components/ui";
import type { Account } from "@/lib/financas/types";
import { formatBRL } from "@/lib/financas/money";
import { shortDate } from "@/lib/financas/period";

export function ImportWizard({ accounts }: { accounts: Account[] }) {
  const [preview, previewAction, previewing] = useActionState<ImportState, FormData>(previewImport, null);
  const [result, confirmAction, confirming] = useActionState<ImportState, FormData>(confirmImport, null);
  const formRef = useRef<HTMLFormElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  if (result && "step" in result && result.step === "done") {
    return (
      <Card className="flex flex-col items-start gap-3">
        <p className="font-medium" role="status">
          {result.inserted} lançamentos importados
          {result.skipped > 0 && `, ${result.skipped} já existiam e foram ignorados`}.
        </p>
        <div className="flex gap-2">
          <LinkButton href="/financas/lancamentos">Ver lançamentos</LinkButton>
          <LinkButton href="/financas/importar" variant="ghost">Importar outro</LinkButton>
        </div>
      </Card>
    );
  }

  const p = preview && "step" in preview && preview.step === "preview" ? preview : null;
  const error = (result && "error" in result && result.error) || (preview && "error" in preview && preview.error) || fileError;
  const newRows = p ? p.rows.filter((r) => !r.duplicate) : [];

  return (
    <form
      ref={formRef}
      className="flex flex-col gap-4"
      // Envio manual: o React não limpa o formulário, então arquivo e opções continuam selecionados.
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
        startTransition(() => (submitter?.dataset.confirm ? confirmAction(data) : previewAction(data)));
      }}
    >
      <Card className="flex flex-col gap-4">
        <Field label="Conta ou cartão">
          <Select name="account_id" required defaultValue={p?.accountId ?? accounts[0]?.id}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Arquivo OFX ou CSV do banco">
          <Input
            name="file"
            type="file"
            accept=".ofx,.csv,.txt,application/x-ofx,text/csv"
            required
            className="pt-2"
            onChange={(e) => {
              const f = e.target.files?.[0];
              setFileError(f && f.size > 900 * 1024 ? "Arquivo muito grande (máximo 900 KB)." : null);
            }}
          />
        </Field>
        {p && (
          <label className="flex items-start gap-2 text-sm">
            <input type="hidden" name="invert_set" value="1" />
            <input
              type="checkbox"
              name="invert"
              defaultChecked={p.invert}
              className="mt-0.5 size-4 accent-[var(--primary)]"
              onChange={() => formRef.current?.requestSubmit()}
            />
            <span>
              Inverter sinais
              <span className="block text-muted">Use se as compras aparecem como entrada (comum em CSV de fatura).</span>
            </span>
          </label>
        )}
        <FormError message={error || null} />
        <Button type="submit" variant={p ? "ghost" : "primary"} disabled={previewing || Boolean(fileError)}>
          {previewing ? "Lendo arquivo…" : p ? "Ler de novo" : "Pré-visualizar"}
        </Button>
      </Card>

      {p && (
        <>
          <Card className="py-1">
            <p className="py-3 text-sm text-muted">
              {p.fileName}: {newRows.length} novos
              {p.rows.length - newRows.length > 0 && `, ${p.rows.length - newRows.length} já importados`}
            </p>
            <ul className="max-h-[50vh] divide-y divide-line overflow-y-auto">
              {p.rows.map((r, i) => (
                <li key={i} className={clsx("flex items-center gap-3 py-2.5 text-sm", r.duplicate && "opacity-40")}>
                  <span className="w-11 shrink-0 tabular-nums text-muted">{shortDate(r.date)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate">{r.description}</p>
                    <p className="text-[12px] text-muted">{r.duplicate ? "já importado" : (r.category ?? "sem categoria")}</p>
                  </div>
                  <span className={clsx("tabular-nums", r.amount > 0 && "text-olive")}>{formatBRL(r.amount)}</span>
                </li>
              ))}
            </ul>
            {p.errors.length > 0 && (
              <p className="border-t border-line py-3 text-[13px] text-danger">
                {p.errors.length} linhas ignoradas: {p.errors.slice(0, 3).join(" ")}
              </p>
            )}
          </Card>
          <Button
            type="submit"
            data-confirm="1"
            disabled={confirming || newRows.length === 0}
          >
            {confirming ? "Importando…" : `Importar ${newRows.length} lançamentos`}
          </Button>
        </>
      )}
    </form>
  );
}
