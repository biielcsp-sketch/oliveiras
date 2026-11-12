"use client";

import { useActionState } from "react";
import { saveOneOff, type OneOffState } from "../avulsas-actions";
import { Button, Field, FormError, Input, Select } from "@/components/ui";
import type { OneOffBill } from "@/lib/financas/avulsas";
import type { Account, Category } from "@/lib/financas/types";

/** Editar conta avulsa: o pagamento (se houver) não muda aqui; desfaz na lista. */
export function OneOffForm({ oneOff, categories, accounts }: { oneOff: OneOffBill; categories: Category[]; accounts: Account[] }) {
  const [state, action, pending] = useActionState<OneOffState, FormData>(saveOneOff, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={oneOff.id} />
      <Field label="Nome">
        <Input name="name" maxLength={60} defaultValue={oneOff.name} required />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Valor (R$)">
          <Input name="amount" inputMode="decimal" defaultValue={oneOff.amount.toFixed(2).replace(".", ",")} required />
        </Field>
        <Field label="Vencimento">
          <Input name="due_date" type="date" defaultValue={oneOff.due_date} required />
        </Field>
      </div>
      <Field label="Categoria">
        <Select name="category_id" defaultValue={oneOff.category_id ?? ""}>
          <option value="">Sem categoria</option>
          {categories.filter((c) => c.kind === "despesa").map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Select>
      </Field>
      <Field label="Paga pela conta">
        <Select name="account_id" defaultValue={oneOff.account_id ?? ""}>
          <option value="">Qualquer conta</option>
          {accounts.filter((a) => !a.archived).map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </Select>
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="is_home" defaultChecked={oneOff.is_home} className="size-4 accent-[var(--primary)]" />
        Conta da casa (aparece também em Casa)
      </label>
      <FormError message={state?.error} />
      <Button disabled={pending}>{pending ? "Salvando…" : "Salvar conta avulsa"}</Button>
    </form>
  );
}
