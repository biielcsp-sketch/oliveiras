"use client";

import { useActionState } from "react";
import Link from "next/link";
import { editDocument, type DocState } from "../documentos-actions";
import { Button, Field, FormError, Input, Select } from "@/components/ui";

const money = (v: number | null) => (v === null ? "" : v.toFixed(2).replace(".", ","));

type Props =
  | {
      kind: "boleto";
      id: string;
      amount: number | null;
      dueDate: string | null;
      billId: string | null;
      billMonth: string | null;
      bills: { id: string; name: string }[];
    }
  | { kind: "comprovante"; id: string; amount: number | null; paidOn: string | null; payee: string | null; transactionId: string | null };

/** Edição de documento confirmado. Os dados vêm do servidor; o servidor valida tudo de novo. */
export function DocEditForm(props: Props) {
  const [state, action, pending] = useActionState<DocState, FormData>(editDocument, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={props.id} />
      {props.kind === "boleto" ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Valor (R$)">
              <Input name="amount" inputMode="decimal" defaultValue={money(props.amount)} required />
            </Field>
            <Field label="Vencimento">
              <Input name="due_date" type="date" defaultValue={props.dueDate ?? ""} required />
            </Field>
          </div>
          <Field label="Conta fixa">
            <Select name="bill_id" defaultValue={props.billId ?? ""} required>
              <option value="" disabled>Escolha…</option>
              {props.bills.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Mês da conta">
            <Input name="bill_month" type="month" defaultValue={props.billMonth ?? ""} required />
          </Field>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Valor pago (R$)">
              <Input name="amount" inputMode="decimal" defaultValue={money(props.amount)} required />
            </Field>
            <Field label="Data do pagamento">
              <Input name="paid_on" type="date" defaultValue={props.paidOn ?? ""} required />
            </Field>
          </div>
          <Field label="Favorecido">
            <Input name="payee" maxLength={120} defaultValue={props.payee ?? ""} />
          </Field>
          {props.transactionId && (
            <p className="text-sm text-muted">
              Isto muda só os dados do comprovante. Para mudar o lançamento,{" "}
              <Link href={`/financas/lancamentos/${props.transactionId}`} className="font-medium text-link">
                edite o lançamento
              </Link>
              .
            </p>
          )}
        </>
      )}
      <FormError message={state?.error} />
      <Button disabled={pending}>{pending ? "Salvando…" : "Salvar alterações"}</Button>
    </form>
  );
}
