"use client";

import { useActionState, useEffect, useRef } from "react";
import { addCategory, addRule, applyRules, type FormState } from "../actions";
import { Button, FormError, Input, Select } from "@/components/ui";
import type { Category } from "@/lib/financas/types";

function useResetOnOk(state: FormState) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return ref;
}

export function AddCategoryForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(addCategory, null);
  const ref = useResetOnOk(state);
  return (
    <form ref={ref} action={action} className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
      <Input name="name" maxLength={40} placeholder="Nova categoria" aria-label="Nome da categoria" required />
      <Select name="kind" aria-label="Tipo da categoria" defaultValue="despesa" className="sm:w-40">
        <option value="despesa">Despesa</option>
        <option value="receita">Receita</option>
        <option value="transferencia">Transferência</option>
      </Select>
      <Button disabled={pending}>Adicionar</Button>
      <div className="sm:col-span-3">
        <FormError message={state?.error} />
      </div>
    </form>
  );
}

export function AddRuleForm({ categories }: { categories: Category[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(addRule, null);
  const ref = useResetOnOk(state);
  return (
    <form ref={ref} action={action} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
      <Input name="pattern" maxLength={60} placeholder="Se a descrição contém…" aria-label="Texto da regra" required />
      <Select name="category_id" aria-label="Categoria da regra" required defaultValue="">
        <option value="" disabled>…use a categoria</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </Select>
      <Button disabled={pending}>Criar regra</Button>
      <div className="sm:col-span-3">
        <FormError message={state?.error} />
      </div>
    </form>
  );
}

export function ApplyRulesButton() {
  const [state, action, pending] = useActionState<(FormState & { updated?: number; partial?: boolean }) | null, FormData>(
    () => applyRules(),
    null,
  );
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <Button variant="ghost" disabled={pending}>{pending ? "Aplicando…" : "Aplicar regras aos sem categoria"}</Button>
      {state?.ok && (
        <span className="text-sm text-muted" role="status">
          {state.updated === 1 ? "1 lançamento categorizado." : `${state.updated ?? 0} lançamentos categorizados.`}
          {state.partial && " Ainda pode haver lançamentos sem categoria: toque de novo."}
        </span>
      )}
    </form>
  );
}
