"use client";

import { useActionState, useState, useTransition } from "react";
import clsx from "clsx";
import { addCategoryInline, saveTransaction, type FormState } from "../actions";
import { Button, Field, FormError, Input, Select, Textarea } from "@/components/ui";
import type { Account, Category, CategoryKind, Transaction } from "@/lib/financas/types";
import type { Member } from "@/lib/data";
import { cleanDescription } from "@/lib/financas/rules";
import { accountLabel } from "@/lib/financas/account-label";

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
  const [created, setCreated] = useState<Category[]>([]);
  const allCats = [...categories, ...created.filter((c) => !categories.some((x) => x.id === c.id))];
  const [direction, setDirection] = useState<"saida" | "entrada">(
    tx ? (tx.amount > 0 ? "entrada" : "saida") : "saida",
  );
  const [categoryId, setCategoryId] = useState(tx?.category_id ?? "");
  const [description, setDescription] = useState(tx?.description ?? "");
  // Ao editar, corrigir a categoria costuma valer para os próximos parecidos; ao criar à mão, não.
  const [learn, setLearn] = useState(Boolean(tx));
  const [newCatOpen, setNewCatOpen] = useState(false);
  const visibleCats = allCats.filter((c) =>
    c.id === categoryId || c.kind === "transferencia" ? true : direction === "entrada" ? c.kind === "receita" : c.kind === "despesa",
  );
  const amountText = tx ? Math.abs(tx.amount).toFixed(2).replace(".", ",") : "";
  const memberName = new Map(members.map((m) => [m.id, m.name]));
  const learnKey = cleanDescription(description);

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
            onClick={() => {
              setDirection(d);
              const cat = allCats.find((c) => c.id === categoryId);
              if (cat && cat.kind !== "transferencia" && cat.kind !== (d === "entrada" ? "receita" : "despesa")) setCategoryId("");
            }}
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
        <Input name="description" maxLength={200} value={description} onChange={(e) => setDescription(e.target.value)} required />
      </Field>
      <Field label="Conta">
        <Select name="account_id" defaultValue={tx?.account_id ?? accounts.find((a) => !a.archived)?.id} required>
          {accounts.filter((a) => !a.archived || a.id === tx?.account_id).map((a) => (
            <option key={a.id} value={a.id}>
              {accountLabel(a, memberName)}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex flex-col gap-2">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Field label="Categoria">
              <Select name="category_id" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">Sem categoria</option>
                {visibleCats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.kind === "transferencia" ? `↔ ${c.name}` : c.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <button
            type="button"
            onClick={() => setNewCatOpen(true)}
            aria-expanded={newCatOpen}
            className="h-11 shrink-0 rounded-full border border-line bg-surface-solid px-4 text-[14px] font-medium shadow-soft hover:bg-surface-2"
          >
            + Nova
          </button>
        </div>
        {newCatOpen && <NewCategoryInline
          defaultKind={direction === "entrada" ? "receita" : "despesa"}
          onClose={() => setNewCatOpen(false)}
          onCreated={(c) => {
            setCreated((list) => [...list, c]);
            setCategoryId(c.id);
          }}
        />}
        <label className="flex items-start gap-2 text-[14px]">
          <input
            type="checkbox"
            name="learn"
            checked={learn}
            onChange={(e) => setLearn(e.target.checked)}
            className="mt-1 size-4 accent-[var(--primary)]"
          />
          <span>
            Usar para os próximos parecidos
            <span className="block text-[12.5px] text-muted" data-testid="regra-preview">
              {learnKey ? <>Regra: descrição com “{learnKey}”</> : "Descrição curta demais para virar regra."}
            </span>
          </span>
        </label>
      </div>
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

/** "+ Nova" categoria sem sair do formulário. Campos sem `name`: não vão junto com o lançamento. */
function NewCategoryInline({
  defaultKind,
  onCreated,
  onClose,
}: {
  defaultKind: CategoryKind;
  onCreated: (c: Category) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<CategoryKind>(defaultKind);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-surface-2 p-3" role="group" aria-label="Nova categoria">
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          placeholder="Nome da categoria"
          aria-label="Nome da nova categoria"
        />
        <Select value={kind} onChange={(e) => setKind(e.target.value as CategoryKind)} aria-label="Tipo da nova categoria" className="sm:w-40">
          <option value="despesa">Despesa</option>
          <option value="receita">Receita</option>
          <option value="transferencia">Transferência</option>
        </Select>
      </div>
      <FormError message={error} />
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const r = await addCategoryInline(name, kind);
              if ("error" in r) setError(r.error);
              else {
                setError(null);
                setName("");
                onCreated(r.category);
                onClose();
              }
            })
          }
        >
          {pending ? "Criando…" : "Criar categoria"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
