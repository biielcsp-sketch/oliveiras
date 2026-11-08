"use client";

import { useCallback, useEffect, useState } from "react";
import { Fingerprint, Pencil, Trash2 } from "lucide-react";
import type { PasskeyListItem } from "@supabase/supabase-js";
import { Button, Card, FormError, Input } from "@/components/ui";
import { createClient } from "@/lib/supabase/browser";
import { registerErrorMessage } from "@/lib/passkey-errors";
import { useWebAuthnSupport } from "@/lib/use-webauthn-support";

const fmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
const when = (iso?: string) => (iso ? fmt.format(new Date(iso)) : null);

/** "Entrar com digital": ativa, lista, renomeia e remove as passkeys do usuário logado. */
export function PasskeysSection() {
  const supported = useWebAuthnSupport();
  const [keys, setKeys] = useState<PasskeyListItem[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);

  const fetchKeys = () => createClient().auth.passkey.list();
  const applyKeys = useCallback(({ data, error }: Awaited<ReturnType<typeof fetchKeys>>) => {
    if (error) setError("Não foi possível carregar as digitais.");
    setKeys(data ?? []);
  }, []);
  const load = async () => applyKeys(await fetchKeys());

  useEffect(() => {
    createClient().auth.passkey.list().then(applyKeys);
  }, [applyKeys]);

  async function activate() {
    setPending(true);
    setError(null);
    const { error } = await createClient().auth.registerPasskey();
    if (error) setError(registerErrorMessage(error));
    await load();
    setPending(false);
  }

  async function rename(id: string) {
    const friendlyName = name.trim().slice(0, 120);
    if (!friendlyName) return;
    setPending(true);
    setError(null);
    const { error } = await createClient().auth.passkey.update({ passkeyId: id, friendlyName });
    if (error) setError("Não foi possível renomear.");
    setEditing(null);
    await load();
    setPending(false);
  }

  async function remove(id: string) {
    setPending(true);
    setError(null);
    const { error } = await createClient().auth.passkey.delete({ passkeyId: id });
    if (error) setError("Não foi possível remover.");
    setConfirming(null);
    await load();
    setPending(false);
  }

  return (
    <Card aria-labelledby="digital-titulo">
      <h2 id="digital-titulo" className="flex items-center gap-2 font-medium">
        <Fingerprint size={18} aria-hidden /> Entrar com digital
      </h2>
      <p className="mt-1 text-sm text-muted">
        Use a digital ou o rosto do celular em vez da senha. Ative em cada aparelho.
      </p>

      {keys && keys.length > 0 && (
        <ul className="mt-3 divide-y divide-line" aria-label="Digitais cadastradas">
          {keys.map((k) => {
            const label = k.friendly_name || "Digital";
            if (editing === k.id) {
              return (
                <li key={k.id} className="flex flex-col gap-2 py-3">
                  <form
                    className="flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void rename(k.id);
                    }}
                  >
                    <Input
                      aria-label="Nome da digital"
                      value={name}
                      maxLength={120}
                      onChange={(e) => setName(e.target.value)}
                      autoFocus
                      required
                    />
                    <Button type="submit" disabled={pending} className="shrink-0">
                      Salvar
                    </Button>
                  </form>
                  <button type="button" className="self-start text-sm text-muted" onClick={() => setEditing(null)}>
                    Cancelar
                  </button>
                </li>
              );
            }
            return (
              <li key={k.id} className="py-3">
                <div className="flex items-center gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 text-ink">
                    <Fingerprint size={16} aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{label}</p>
                    <p className="text-[13px] text-muted">
                      Criada em {when(k.created_at)}
                      {" · "}
                      {k.last_used_at ? `último uso ${when(k.last_used_at)}` : "ainda não usada"}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label={`Renomear ${label}`}
                    className="grid size-11 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink"
                    onClick={() => {
                      setConfirming(null);
                      setEditing(k.id);
                      setName(k.friendly_name ?? "");
                    }}
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Remover ${label}`}
                    className="grid size-11 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-danger"
                    onClick={() => {
                      setEditing(null);
                      setConfirming(k.id);
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                {confirming === k.id && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl bg-surface-2 p-3 text-sm">
                    <p className="w-full">Remover esta digital? Este aparelho não poderá mais entrar sem senha.</p>
                    <Button
                      type="button"
                      variant="danger"
                      className="h-11"
                      disabled={pending}
                      onClick={() => void remove(k.id)}
                    >
                      Confirmar remoção
                    </Button>
                    <Button type="button" variant="ghost" className="h-11" onClick={() => setConfirming(null)}>
                      Cancelar
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {supported && (
        <Button type="button" variant="ghost" className="mt-4 w-full" disabled={pending} onClick={activate}>
          <Fingerprint size={16} aria-hidden />
          {pending ? "Aguarde…" : "Ativar neste aparelho"}
        </Button>
      )}
      <div role="status" aria-live="polite" className="mt-2">
        <FormError message={error} />
      </div>
    </Card>
  );
}
