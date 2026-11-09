"use client";

import { useActionState, useState } from "react";
import clsx from "clsx";
import { RefreshCw } from "lucide-react";
import { Button, Card, LinkButton } from "@/components/ui";
import { safeHex } from "@/lib/agenda/view";
import { disconnectGoogle, syncAgendaNow, toggleCalendar, type AgendaFormState } from "../actions";

export type AccountCalendarView = { id: string; summary: string; color: string | null; accessRole: string | null; selected: boolean };
export type AccountView = {
  id: string;
  email: string;
  status: "ok" | "revogado" | "erro";
  lastError: string | null;
  lastSyncAt: string | null;
  calendars: AccountCalendarView[];
};
export type PersonAccounts = { memberId: string; name: string; mine: boolean; accounts: AccountView[] };

const ROLE_LABEL: Record<string, string> = { owner: "dono", writer: "edita", reader: "só leitura", freeBusyReader: "livre/ocupado" };

function syncedAt(iso: string | null) {
  if (!iso) return "Ainda não sincronizado";
  return `Sincronizado em ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(iso))}`;
}

/** Contas Google de cada pessoa: estado, agendas (interruptor) e conectar/desconectar (só a própria). */
export function AccountsSection({ people }: { people: PersonAccounts[] }) {
  const [syncState, syncAction, syncing] = useActionState<AgendaFormState, FormData>(() => syncAgendaNow(), null);
  const anyAccount = people.some((p) => p.accounts.length > 0);

  return (
    <section aria-labelledby="contas-google" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 id="contas-google" className="text-xl font-semibold tracking-tight">
          Contas Google
        </h2>
        {anyAccount && (
          <form action={syncAction}>
            <Button type="submit" variant="ghost" className="h-11 px-4" disabled={syncing}>
              <RefreshCw size={18} aria-hidden className={clsx(syncing && "animate-spin")} />
              {syncing ? "Sincronizando…" : "Sincronizar agora"}
            </Button>
          </form>
        )}
      </div>
      <p role="status" className={clsx("min-h-5 text-sm", syncState?.error ? "text-danger" : "text-primary")}>
        {syncState?.error ?? syncState?.message}
      </p>

      {people.map((p) => (
        <Card key={p.memberId} data-testid={`conta-${p.mine ? "minha" : "outra"}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-[16px] font-semibold">{p.mine ? `${p.name} (você)` : p.name}</h3>
              {p.accounts.length === 0 && <p className="text-sm text-muted">Não conectado</p>}
            </div>
            {p.mine && p.accounts.length === 0 && (
              <LinkButton href="/api/google/connect" className="shrink-0">
                Conectar Google
              </LinkButton>
            )}
          </div>

          {p.accounts.map((a) => (
            <div key={a.id} className="mt-3 border-t border-line pt-3">
              <p className="text-[15px]">
                {a.status === "revogado" ? (
                  <span className="font-medium text-danger">Precisa reconectar</span>
                ) : (
                  <span className="font-medium text-primary">Conectado</span>
                )}{" "}
                <span className="break-all text-muted">· {a.email}</span>
              </p>
              <p className="text-[12px] text-muted">{syncedAt(a.lastSyncAt)}</p>
              {a.lastError && <p className="mt-1 text-sm text-danger">{a.lastError}</p>}

              {a.calendars.length > 0 && (
                <ul className="mt-3 flex flex-col gap-1" aria-label={`Agendas de ${a.email}`}>
                  {a.calendars.map((c) => (
                    <li key={c.id} className="flex items-center gap-3">
                      <span className="size-3 shrink-0 rounded-full" style={{ background: safeHex(c.color) }} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px]">{c.summary}</span>
                        <span className="block text-[12px] text-muted">{ROLE_LABEL[c.accessRole ?? ""] ?? "—"}</span>
                      </span>
                      {p.mine ? (
                        <form action={toggleCalendar}>
                          <input type="hidden" name="id" value={c.id} />
                          <input type="hidden" name="selected" value={String(!c.selected)} />
                          <button
                            type="submit"
                            role="switch"
                            aria-checked={c.selected}
                            aria-label={`Mostrar ${c.summary}`}
                            className="grid h-11 w-14 place-items-center"
                          >
                            <span className={clsx("relative h-7 w-12 rounded-full transition", c.selected ? "bg-hero" : "bg-surface-2 ring-1 ring-line")}>
                              <span
                                className={clsx(
                                  "absolute top-0.5 size-6 rounded-full bg-surface-solid shadow-soft transition-all",
                                  c.selected ? "left-[22px]" : "left-0.5",
                                )}
                              />
                            </span>
                          </button>
                        </form>
                      ) : (
                        <span className="text-[13px] text-muted">{c.selected ? "Visível" : "Oculta"}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {p.mine && <OwnerActions account={a} />}
            </div>
          ))}
        </Card>
      ))}
    </section>
  );
}

function OwnerActions({ account }: { account: AccountView }) {
  const [confirm, setConfirm] = useState(false);
  const [state, action, pending] = useActionState<AgendaFormState, FormData>(disconnectGoogle, null);
  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {account.status !== "ok" && <LinkButton href="/api/google/connect">Reconectar</LinkButton>}
        {!confirm && (
          <Button type="button" variant="danger" className="h-11 px-4" onClick={() => setConfirm(true)}>
            Desconectar
          </Button>
        )}
      </div>
      {confirm && (
        <form action={action} role="group" aria-label="Confirmar desconexão" className="rounded-2xl bg-surface-2 p-3">
          <input type="hidden" name="id" value={account.id} />
          <p className="text-[15px]">Desconectar {account.email}? Os eventos dessa conta somem do app (no Google continuam).</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Button type="button" variant="ghost" onClick={() => setConfirm(false)} disabled={pending}>
              Manter
            </Button>
            <Button type="submit" variant="ghost" className="font-semibold text-danger" disabled={pending}>
              {pending ? "Desconectando…" : "Desconectar"}
            </Button>
          </div>
        </form>
      )}
      {state?.error && <p className="text-sm text-danger">{state.error}</p>}
      {state?.message && <p role="status" className="text-sm text-primary">{state.message}</p>}
    </div>
  );
}
