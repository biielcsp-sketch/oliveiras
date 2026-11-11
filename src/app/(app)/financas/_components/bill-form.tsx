"use client";

import { useActionState } from "react";
import { saveBill, type PlanState } from "../planning-actions";
import { Button, Field, FormError, Input, Select } from "@/components/ui";
import type { Account, Bill, Category } from "@/lib/financas/types";

export function BillForm({ bill, categories, accounts }: { bill?: Bill; categories: Category[]; accounts: Account[] }) {
  const [state, action, pending] = useActionState<PlanState, FormData>(saveBill, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      {bill && <input type="hidden" name="id" value={bill.id} />}
      <Field label="Nome">
        <Input name="name" maxLength={60} defaultValue={bill?.name} placeholder="Ex.: Aluguel" required />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Valor esperado (R$)">
          <Input name="amount" inputMode="decimal" defaultValue={bill ? bill.amount.toFixed(2).replace(".", ",") : ""} required />
        </Field>
        <Field label="Vence todo dia">
          <Input name="due_day" type="number" min={1} max={31} defaultValue={bill?.due_day} required />
        </Field>
      </div>
      <Field label="Categoria">
        <Select name="category_id" defaultValue={bill?.category_id ?? ""}>
          <option value="">Sem categoria</option>
          {categories.filter((c) => c.kind === "despesa").map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Select>
      </Field>
      <Field label="Paga pela conta">
        <Select name="account_id" defaultValue={bill?.account_id ?? ""}>
          <option value="">Qualquer conta</option>
          {accounts.filter((a) => !a.archived).map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </Select>
      </Field>
      {bill && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="inactive" defaultChecked={!bill.active} className="size-4 accent-[var(--primary)]" />
          Pausada (não aparece nos próximos meses)
        </label>
      )}
      <FormError message={state?.error} />
      <Button disabled={pending}>{pending ? "Salvando…" : bill ? "Salvar conta" : "Criar conta fixa"}</Button>
    </form>
  );
}
