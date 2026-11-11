"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { confirmBoleto, confirmComprovante, discardDocument, keepDocument, type DocState } from "../documentos-actions";
import { Button, Field, FormError, Input, Select } from "@/components/ui";
import { monthOf, sameBillMonthDocs, type DocRef } from "@/lib/financas/documentos/rules";
import type { DocKind } from "@/lib/financas/documentos/schema";
import type { CategoryKind } from "@/lib/financas/types";

type Props = {
  doc: {
    id: string;
    kind: DocKind;
    payee: string | null;
    amount: number | null;
    dueDate: string | null;
    paidOn: string | null;
    linha: string;
    description: string | null;
  };
  today: string;
  avisos: string[];
  bills: { id: string; name: string; amount: number; due_day: number }[];
  suggestedBillId: string | null;
  accounts: { id: string; name: string }[];
  categories: { id: string; name: string; kind: CategoryKind }[];
  confirmedBoletos: DocRef[];
  paidKeys: string[];
  dupBoleto: string[];
  dupComprovante: string[];
  boletoLink: { billId: string; month: string } | null;
  /** "casa": veio de Casa > Contas (conta nova já é da casa; ao terminar volta para a Casa). */
  origem?: "casa" | null;
  mes?: string;
};

const KINDS: { key: DocKind; label: string }[] = [
  { key: "boleto", label: "Boleto" },
  { key: "comprovante", label: "Comprovante" },
  { key: "outro", label: "Outro" },
];

const money = (v: number | null) => (v === null ? "" : v.toFixed(2).replace(".", ","));
const monthBr = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;

function Warning({ children }: { children: React.ReactNode }) {
  return <div role="alert" className="rounded-2xl bg-warning-soft px-4 py-3 text-sm text-warning">{children}</div>;
}

function DiscardButton({ id, origem, mes }: { id: string; origem?: "casa" | null; mes?: string }) {
  return (
    <form action={discardDocument}>
      <input type="hidden" name="id" value={id} />
      {origem === "casa" && <input type="hidden" name="origem" value="casa" />}
      {origem === "casa" && mes && <input type="hidden" name="mes" value={mes} />}
      <Button variant="danger" className="w-full">Descartar este documento</Button>
    </form>
  );
}

/** Duplicata: sem formulário de confirmação; o botão de descartar fica logo abaixo. */
function Duplicate({ ids, what }: { ids: string[]; what: string }) {
  return (
    <Warning>
      Já existe {what} com o mesmo código de barras.{" "}
      <Link href={`/financas/documentos/${ids[0]}`} className="font-medium underline">
        Abrir o existente
      </Link>{" "}
      ou descarte este.
    </Warning>
  );
}

export function DocReview(p: Props) {
  const [kind, setKind] = useState<DocKind>(p.doc.kind);
  return (
    <div className="flex flex-col gap-4">
      {p.avisos.map((a, i) => (
        <Warning key={i}>{a}</Warning>
      ))}
      <div className="grid grid-cols-3 rounded-full bg-surface-2 p-1 text-[15px]" role="radiogroup" aria-label="Tipo de documento">
        {KINDS.map((k) => (
          <button
            key={k.key}
            type="button"
            role="radio"
            aria-checked={kind === k.key}
            onClick={() => setKind(k.key)}
            className={clsx("h-11 rounded-full transition", kind === k.key ? "bg-surface-solid font-medium text-ink shadow-soft" : "text-muted")}
          >
            {k.label}
          </button>
        ))}
      </div>

      {kind === "boleto" &&
        (p.dupBoleto.length > 0 ? <Duplicate ids={p.dupBoleto} what="um boleto" /> : <BoletoForm {...p} />)}
      {kind === "comprovante" &&
        (p.dupComprovante.length > 0 ? (
          <Duplicate ids={p.dupComprovante} what="um comprovante" />
        ) : (
          <ComprovanteForm {...p} />
        ))}
      {kind === "outro" && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">Não é boleto nem comprovante? Guarde o arquivo ou descarte.</p>
          <form action={keepDocument}>
            <input type="hidden" name="id" value={p.doc.id} />
            {p.origem === "casa" && <input type="hidden" name="origem" value="casa" />}
            {p.origem === "casa" && p.mes && <input type="hidden" name="mes" value={p.mes} />}
            <Button className="w-full">Guardar documento</Button>
          </form>
        </div>
      )}
      <DiscardButton id={p.doc.id} origem={p.origem} mes={p.mes} />
    </div>
  );
}

function BoletoForm(p: Props) {
  const [state, action, pending] = useActionState<DocState, FormData>(confirmBoleto, null);
  const [billChoice, setBillChoice] = useState(p.suggestedBillId ?? (p.bills.length ? "" : "nova"));
  const [dueDate, setDueDate] = useState(p.doc.dueDate ?? "");
  const [month, setMonth] = useState(monthOf(p.doc.dueDate) ?? p.today.slice(0, 7));
  const billId = billChoice && billChoice !== "nova" ? billChoice : null;
  const sameMonth = sameBillMonthDocs(p.doc.id, billId, month, p.confirmedBoletos);
  const paid = billId ? p.paidKeys.includes(`${billId}:${month}`) : false;
  const suggestedName = p.bills.find((b) => b.id === p.suggestedBillId)?.name;

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={p.doc.id} />
      {p.origem === "casa" && <input type="hidden" name="origem" value="casa" />}
      <Field label="Beneficiário">
        <Input name="payee" maxLength={120} defaultValue={p.doc.payee ?? ""} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Valor (R$)">
          <Input name="amount" inputMode="decimal" placeholder="0,00" defaultValue={money(p.doc.amount)} required />
        </Field>
        <Field label="Vencimento">
          <Input
            name="due_date"
            type="date"
            value={dueDate}
            onChange={(e) => {
              setDueDate(e.target.value);
              const m = monthOf(e.target.value);
              if (m) setMonth(m);
            }}
            required
          />
        </Field>
      </div>
      <Field label="Linha digitável">
        <Input name="barcode" inputMode="numeric" maxLength={60} defaultValue={p.doc.linha} />
      </Field>
      <Field label="Conta fixa">
        <Select name="bill_choice" value={billChoice} onChange={(e) => setBillChoice(e.target.value)} required>
          <option value="" disabled>Escolha…</option>
          {p.bills.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
          <option value="nova">+ Criar nova conta</option>
        </Select>
      </Field>
      {suggestedName && billChoice === p.suggestedBillId && (
        <p className="-mt-2 text-[12px] text-muted">Sugerida pelo nome do beneficiário. O valor fixo da conta não muda.</p>
      )}
      {billChoice === "nova" && (
        <div className="flex flex-col gap-4 rounded-2xl border border-line p-4">
          <Field label="Nome da conta">
            <Input name="new_name" maxLength={60} defaultValue={(p.doc.payee ?? "").slice(0, 60)} required />
          </Field>
          <Field label="Vence todo dia">
            <Input name="new_due_day" type="number" min={1} max={31} defaultValue={dueDate ? Number(dueDate.slice(8, 10)) : ""} required />
          </Field>
          <Field label="Categoria">
            <Select name="category_id" defaultValue="">
              <option value="">Sem categoria</option>
              {p.categories.filter((c) => c.kind === "despesa").map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Paga pela conta">
            <Select name="account_id" defaultValue="">
              <option value="">Qualquer conta</option>
              {p.accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </Select>
          </Field>
        </div>
      )}
      <Field label="Mês da conta">
        <Input name="bill_month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} required />
      </Field>
      {sameMonth.length > 0 && (
        <Warning>
          Esta conta já tem um boleto confirmado em {monthBr(month)}.{" "}
          <Link href={`/financas/documentos/${sameMonth[0].id}`} className="font-medium underline">Ver o boleto</Link>
          <label className="mt-2 flex items-center gap-2 text-ink">
            <input type="checkbox" name="replace_same_month" className="size-4 accent-[var(--primary)]" />
            Substituir o boleto do mês
          </label>
        </Warning>
      )}
      {paid && <Warning>Esta conta já está paga em {monthBr(month)}.</Warning>}
      <FormError message={state?.error} />
      <Button disabled={pending}>{pending ? "Salvando…" : "Confirmar conta fixa"}</Button>
    </form>
  );
}

function ComprovanteForm(p: Props) {
  const [state, action, pending] = useActionState<DocState, FormData>(confirmComprovante, null);
  const [date, setDate] = useState(p.doc.paidOn ?? p.today);
  const [payBill, setPayBill] = useState(p.boletoLink?.billId ?? "");
  const [payMonth, setPayMonth] = useState(p.boletoLink?.month ?? monthOf(p.doc.paidOn) ?? p.today.slice(0, 7));
  const paid = payBill ? p.paidKeys.includes(`${payBill}:${payMonth}`) : false;
  const cats = p.categories.filter((c) => c.kind !== "receita");

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={p.doc.id} />
      {p.origem === "casa" && <input type="hidden" name="origem" value="casa" />}
      <Field label="Favorecido">
        <Input name="payee" maxLength={120} defaultValue={p.doc.payee ?? ""} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Valor pago (R$)">
          <Input name="amount" inputMode="decimal" placeholder="0,00" defaultValue={money(p.doc.amount)} required />
        </Field>
        <Field label="Data do pagamento">
          <Input name="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
      </div>
      <Field label="Descrição">
        <Input name="description" maxLength={200} defaultValue={p.doc.description ?? p.doc.payee ?? ""} required />
      </Field>
      <Field label="Conta">
        <Select name="account_id" defaultValue={p.accounts[0]?.id} required>
          {p.accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </Select>
      </Field>
      <Field label="Categoria">
        <Select name="category_id" defaultValue="">
          <option value="">Sem categoria</option>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>{c.kind === "transferencia" ? `↔ ${c.name}` : c.name}</option>
          ))}
        </Select>
      </Field>
      <Field label="Código de barras pago (opcional)">
        <Input name="barcode" inputMode="numeric" maxLength={60} defaultValue={p.doc.linha} />
      </Field>
      <div className="flex flex-col gap-3 rounded-2xl border border-line p-4">
        <Field label="Marcar como paga a conta">
          <Select name="pay_bill_id" value={payBill} onChange={(e) => setPayBill(e.target.value)}>
            <option value="">Não marcar</option>
            {p.bills.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </Select>
        </Field>
        {payBill && (
          <Field label="Mês da conta paga">
            <Input name="pay_month" type="month" value={payMonth} onChange={(e) => setPayMonth(e.target.value)} required />
          </Field>
        )}
        {paid && <Warning>Esta conta já está paga em {monthBr(payMonth)}. Desmarque ou desfaça o pagamento antes.</Warning>}
      </div>
      {p.accounts.length === 0 && <FormError message="Cadastre uma conta bancária antes de lançar." />}
      <FormError message={state?.error} />
      <Button disabled={pending || p.accounts.length === 0}>{pending ? "Salvando…" : "Criar lançamento"}</Button>
    </form>
  );
}
