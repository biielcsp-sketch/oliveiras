"use client";

import { useActionState } from "react";
import { saveBill, type PlanState } from "../planning-actions";
import { Button, Field, FormError, Input, Select } from "@/components/ui";
import type { Account, Bill, Category } from "@/lib/financas/types";

/** `fromCasa`: aberto por Casa > Contas ("Nova conta da casa"): já vem marcada como da casa e volta para a Casa. */
export function BillForm({ bill, categories, accounts, fromCasa = false }: { bill?: Bill; categories: Category[]; accounts: Account[]; fromCasa?: boolean }) {
  const [state, action, pending] = useActionState<PlanState, FormData>(saveBill, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      {bill && <input type="hidden" name="id" value={bill.id} />}
      {fromCasa && <input type="hidden" name="voltar" value="casa" />}
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
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="is_home" defaultChecked={bill ? Boolean(bill.is_home) : fromCasa} className="size-4 accent-[var(--primary)]" />
        Conta da casa (aparece também em Casa)
      </label>
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
