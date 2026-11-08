"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { addItem, autoSync, linkAccount, syncNow, type OfState } from "../open-finance-actions";
import { Button, Field, FormError, Input, Select } from "@/components/ui";

export function AddItemForm() {
  const [state, action, pending] = useActionState<OfState, FormData>(addItem, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={action} className="flex flex-col gap-3">
      <Field label="Id do item (Connected Items, no dashboard da Pluggy)">
        <Input name="item_id" placeholder="00000000-0000-0000-0000-000000000000" className="font-mono text-sm" required />
      </Field>
      <Field label="Nome (opcional)">
        <Input name="label" maxLength={60} placeholder="Ex.: Nubank Gabriel" />
      </Field>
      <FormError message={state?.error} />
      <Button disabled={pending}>{pending ? "Conferindo na Pluggy…" : "Conectar"}</Button>
    </form>
  );
}

export function SyncButton() {
  const [state, action, pending] = useActionState<OfState, FormData>(() => syncNow(), null);
  return (
    <form action={action} className="flex flex-col gap-2">
      <Button variant="ghost" disabled={pending}>
        <RefreshCw size={16} className={pending ? "animate-spin" : ""} />
        {pending ? "Sincronizando…" : "Sincronizar agora"}
      </Button>
      {state?.message && <p role="status" className="text-sm text-muted">{state.message}</p>}
      <FormError message={state?.error} />
    </form>
  );
}

type LinkProps = {
  itemRef: string;
  remoteId: string;
  options: { id: string; name: string }[];
};

export function LinkAccountForm({ itemRef, remoteId, options }: LinkProps) {
  const [state, action, pending] = useActionState<OfState, FormData>(linkAccount, null);
  const [target, setTarget] = useState("new");
  return (
    <form action={action} className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
      <input type="hidden" name="item_ref" value={itemRef} />
      <input type="hidden" name="remote_id" value={remoteId} />
      <Select name="target" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Vincular a">
        <option value="new">Criar conta nova no app</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>Vincular a: {o.name}</option>
        ))}
      </Select>
      <Input
        name="sync_from"
        type="date"
        aria-label="Importar a partir de"
        title="Vazio: 90 dias atrás (conta nova) ou o dia seguinte ao último lançamento já existente"
        className="sm:w-40"
      />
      <button disabled={pending} className="h-11 rounded-full bg-hero px-5 text-[15px] font-medium text-on-primary shadow-soft disabled:opacity-50">
        {pending ? "…" : "Vincular"}
      </button>
      <div className="sm:col-span-3">
        <FormError message={state?.error} />
      </div>
    </form>
  );
}

/** Ao abrir Finanças, pede uma sincronização (o servidor só faz se passou de 6h). */
export function AutoSync() {
  const router = useRouter();
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    autoSync().then((r) => r.changed && router.refresh());
  }, [router]);
  return null;
}
