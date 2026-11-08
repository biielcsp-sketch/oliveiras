"use client";

import { useActionState, useState } from "react";
import clsx from "clsx";
import { saveTransaction, type FormState } from "../actions";
import { Button, Field, FormError, Input, Select, Textarea } from "@/components/ui";
import type { Account, Category, Transaction } from "@/lib/financas/types";
import type { Member } from "@/lib/data";

type Props = {
  accounts: Account[];
  categories: Category[];
  members: Member[];
  defaultMemberId: string | null;
  today: string;
  tx?: Transaction;
};

export function TxForm({ accounts, categories, members, defaultMemberId, today, tx }: Props) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveTransaction, null);
  const initialCat = tx?.category_id ? categories.find((c) => c.id === tx.category_id) : undefined;
  const [direction, setDirection] = useState<"saida" | "entrada">(
    tx ? (tx.amount > 0 ? "entrada" : "saida") : "saida",
  );
  const visibleCats = categories.filter((c) =>
    c.kind === "transferencia" ? true : direction === "entrada" ? c.kind === "receita" : c.kind === "despesa",
  );
  const amountText = tx ? Math.abs(tx.amount).toFixed(2).replace(".", ",") : "";

  return (
    <form action={action} className="flex flex-col gap-4">
      {tx && <input type="hidden" name="id" value={tx.id} />}
      <input type="hidden" name="direction" value={direction} />

      <div className="grid grid-cols-2 rounded-full bg-surface-2 p-1 text-[15px]" role="radiogroup" aria-label="Tipo">
        {(["saida", "entrada"] as const).map((d) => (
          <button
            key={d}
            type="button"
            role="radio"
            aria-checked={direction === d}
            onClick={() => setDirection(d)}
            className={clsx("h-11 rounded-full transition", direction === d ? "bg-surface-solid font-medium text-ink shadow-soft" : "text-muted")}
          >
            {d === "saida" ? "Saída" : "Entrada"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Valor (R$)">
          <Input name="amount" inputMode="decimal" placeholder="0,00" defaultValue={amountText} required />
        </Field>
        <Field label="Data">
          <Input name="date" type="date" defaultValue={tx?.date ?? today} required />
        </Field>
      </div>
      <Field label="Descrição">
        <Input name="description" maxLength={200} defaultValue={tx?.description} required />
      </Field>
      <Field label="Conta">
        <Select name="account_id" defaultValue={tx?.account_id ?? accounts.find((a) => !a.archived)?.id} required>
          {accounts.filter((a) => !a.archived || a.id === tx?.account_id).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Categoria">
        <Select name="category_id" defaultValue={initialCat?.id ?? ""} key={direction}>
          <option value="">Sem categoria</option>
          {visibleCats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.kind === "transferencia" ? `↔ ${c.name}` : c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Quem">
        <Select name="member_id" defaultValue={tx ? (tx.member_id ?? "") : (defaultMemberId ?? "")}>
          <option value="">—</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Observação">
        <Textarea name="notes" maxLength={500} defaultValue={tx?.notes ?? ""} />
      </Field>
      <FormError message={state?.error} />
      <Button disabled={pending}>{pending ? "Salvando…" : tx ? "Salvar alterações" : "Lançar"}</Button>
    </form>
  );
}
