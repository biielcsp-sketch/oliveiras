"use client";

import { useActionState } from "react";
import { saveGoal, type PlanState } from "../planning-actions";
import { Button, Field, FormError, Input, Select } from "@/components/ui";
import type { Account, Goal } from "@/lib/financas/types";

export function GoalForm({ goal, accounts }: { goal?: Goal; accounts: Account[] }) {
  const [state, action, pending] = useActionState<PlanState, FormData>(saveGoal, null);
  const savings = accounts.filter((a) => !a.archived && a.kind !== "cartao");
  return (
    <form action={action} className="flex flex-col gap-4">
      {goal && <input type="hidden" name="id" value={goal.id} />}
      <Field label="Nome da meta">
        <Input name="name" maxLength={60} defaultValue={goal?.name} placeholder="Ex.: Reserva de emergência" required />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Valor alvo (R$)">
          <Input name="target" inputMode="decimal" defaultValue={goal ? goal.target.toFixed(2).replace(".", ",") : ""} required />
        </Field>
        <Field label="Até quando (opcional)">
          <Input name="target_date" type="date" defaultValue={goal?.target_date ?? ""} />
        </Field>
      </div>
      <Field label="Conta onde o dinheiro fica">
        <Select name="account_id" defaultValue={goal?.account_id ?? savings.find((a) => a.kind !== "corrente")?.id ?? ""} required>
          <option value="" disabled>Escolha a conta</option>
          {savings.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </Select>
      </Field>
      <p className="text-[13px] text-muted">O progresso é o saldo dessa conta. Use uma poupança ou investimento separado para a meta.</p>
      <FormError message={state?.error} />
      <Button disabled={pending}>{pending ? "Salvando…" : goal ? "Salvar meta" : "Criar meta"}</Button>
    </form>
  );
}
