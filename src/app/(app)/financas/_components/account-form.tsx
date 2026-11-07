"use client";

import { useActionState, useState } from "react";
import { deleteAccount, saveAccount, type FormState } from "../actions";
import { Button, Field, FormError, Input, Select } from "@/components/ui";
import { ACCOUNT_KIND_LABEL, type Account, type AccountKind } from "@/lib/financas/types";
import type { Member } from "@/lib/data";

const money = (v: number | null | undefined) => (v === null || v === undefined ? "" : v.toFixed(2).replace(".", ","));

export function AccountForm({ account, members }: { account?: Account; members: Member[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveAccount, null);
  const [delState, delAction, deleting] = useActionState<FormState, FormData>(deleteAccount, null);
  const [kind, setKind] = useState<AccountKind>(account?.kind ?? "corrente");
  const isCard = kind === "cartao";

  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-col gap-4">
        {account && <input type="hidden" name="id" value={account.id} />}
        <Field label="Nome">
          <Input name="name" maxLength={60} defaultValue={account?.name} placeholder="Ex.: Nubank Gabriel" required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tipo">
            <Select name="kind" value={kind} onChange={(e) => setKind(e.target.value as AccountKind)}>
              {Object.entries(ACCOUNT_KIND_LABEL).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Instituição">
            <Input name="institution" maxLength={60} defaultValue={account?.institution ?? ""} />
          </Field>
        </div>
        <Field label="Titular">
          <Select name="owner_member_id" defaultValue={account?.owner_member_id ?? ""}>
            <option value="">Conjunta</option>
            {members.filter((m) => m.user_id).map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </Select>
        </Field>
        {isCard ? (
          <div className="grid grid-cols-3 gap-3">
            <Field label="Limite (R$)">
              <Input name="credit_limit" inputMode="decimal" defaultValue={money(account?.credit_limit)} />
            </Field>
            <Field label="Fecha dia">
              <Input name="closing_day" type="number" min={1} max={31} defaultValue={account?.closing_day ?? ""} />
            </Field>
            <Field label="Vence dia">
              <Input name="due_day" type="number" min={1} max={31} defaultValue={account?.due_day ?? ""} />
            </Field>
          </div>
        ) : (
          <Field label="Saldo inicial (R$)">
            <Input name="opening_balance" inputMode="decimal" defaultValue={money(account?.opening_balance ?? 0)} />
          </Field>
        )}
        {account && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="archived" defaultChecked={account.archived} className="size-4 accent-[var(--olive)]" />
            Arquivada (some das listas, mantém o histórico)
          </label>
        )}
        <FormError message={state?.error} />
        <Button disabled={pending}>{pending ? "Salvando…" : account ? "Salvar conta" : "Criar conta"}</Button>
      </form>

      {account && (
        <form action={delAction} className="flex flex-col gap-2">
          <input type="hidden" name="id" value={account.id} />
          <FormError message={delState?.error} />
          <Button variant="danger" disabled={deleting}>Excluir conta</Button>
        </form>
      )}
    </div>
  );
}
