"use client";

import { startTransition, useActionState, useState } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { Button, Card, EmptyState, Field, FormError, Input, Select, Textarea } from "@/components/ui";
import { Modal } from "@/components/modal";
import { brDate, shortDayLabel } from "@/lib/agenda/dates";
import { LIMITS } from "@/lib/casa/input";
import { choreBuckets, frequencyLabel, WEEKDAY_SHORT } from "@/lib/casa/view";
import type { Frequency } from "@/lib/casa/types";
import { completeChore, deleteChore, saveChore, skipChoreTurn, type CasaState } from "../actions";
import { ConfirmDelete, Feedback, smallBtn, useOnSaved, useRunner, type Person } from "./shared";

export type ChoreVM = {
  id: string;
  name: string;
  notes: string | null;
  frequency: Frequency;
  weekdays: number[] | null;
  month_day: number | null;
  /** Rodízio já sem ids de quem saiu da família. */
  rotation: string[];
  responsible: string | null;
  validPeople: number;
  next_index: number;
  next_due_on: string | null;
  active: boolean;
  history: { id: string; done_on: string; person: string }[];
};

const WEEKDAY_LONG = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

/** Ordem do rodízio: adicionar pessoas (pode repetir), mover e tirar. Vai para o servidor como campos "rotation" em ordem. */
function RotationPicker({ people, initial }: { people: Person[]; initial: string[] }) {
  const [order, setOrder] = useState<string[]>(initial);
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const move = (i: number, d: -1 | 1) => {
    const next = [...order];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setOrder(next);
  };
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-[13px] font-medium text-muted">Rodízio (na ordem da vez)</legend>
      {order.length === 0 && <p className="text-sm text-muted">Adicione quem participa.</p>}
      <ol className="flex flex-col gap-2" aria-label="Ordem do rodízio">
        {order.map((id, i) => (
          <li key={`${id}-${i}`} className="flex items-center gap-2 rounded-2xl bg-surface-2 py-1 pl-4 pr-1">
            <input type="hidden" name="rotation" value={id} />
            <span className="flex-1 text-[15px]">
              {i + 1}. {nameOf.get(id)}
            </span>
            <button type="button" className="grid size-11 place-items-center disabled:opacity-30" aria-label={`Subir ${nameOf.get(id)}`} disabled={i === 0} onClick={() => move(i, -1)}>
              <ArrowUp size={18} aria-hidden />
            </button>
            <button
              type="button"
              className="grid size-11 place-items-center disabled:opacity-30"
              aria-label={`Descer ${nameOf.get(id)}`}
              disabled={i === order.length - 1}
              onClick={() => move(i, 1)}
            >
              <ArrowDown size={18} aria-hidden />
            </button>
            <button type="button" className="grid size-11 place-items-center" aria-label={`Tirar ${nameOf.get(id)} da posição ${i + 1}`} onClick={() => setOrder(order.filter((_, j) => j !== i))}>
              <X size={18} aria-hidden />
            </button>
          </li>
        ))}
      </ol>
      {order.length < LIMITS.rotation && (
        <div className="flex flex-wrap gap-2">
          {people.map((p) => (
            <Button key={p.id} type="button" variant="ghost" className={smallBtn} onClick={() => setOrder([...order, p.id])}>
              <Plus size={16} aria-hidden /> {p.name}
            </Button>
          ))}
        </div>
      )}
    </fieldset>
  );
}

function ChoreForm({ item, people, onDone }: { item?: ChoreVM; people: Person[]; onDone: (msg?: string) => void }) {
  const [state, action, pending] = useActionState<CasaState, FormData>(saveChore, null);
  const [freq, setFreq] = useState<Frequency>(item?.frequency ?? "semanal");
  useOnSaved(state, onDone);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
      className="flex flex-col gap-4"
    >
      {item && <input type="hidden" name="id" value={item.id} />}
      <Field label="Tarefa">
        <Input name="name" maxLength={LIMITS.name} defaultValue={item?.name} placeholder="Ex.: Lavar a louça" required autoComplete="off" />
      </Field>
      <Field label="Frequência">
        <Select name="frequency" value={freq} onChange={(e) => setFreq(e.target.value as Frequency)}>
          <option value="diaria">Diária</option>
          <option value="semanal">Semanal</option>
          <option value="mensal">Mensal</option>
        </Select>
      </Field>
      {freq === "semanal" && (
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium text-muted">Dias da semana</legend>
          <div className="flex flex-wrap gap-2">
            {WEEKDAY_SHORT.map((d, i) => (
              <label key={i} className="inline-flex h-11 items-center gap-2 rounded-full bg-surface-2 px-4 text-[15px] has-[:checked]:bg-accent-soft has-[:checked]:font-medium">
                <input type="checkbox" name="weekdays" value={i} defaultChecked={item?.weekdays?.includes(i)} aria-label={WEEKDAY_LONG[i]} className="accent-primary" />
                {d}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {freq === "mensal" && (
        <Field label="Dia do mês (em meses curtos, vale o último dia)">
          <Input name="month_day" type="number" min={1} max={31} defaultValue={item?.month_day ?? ""} required />
        </Field>
      )}
      <RotationPicker people={people} initial={item?.rotation ?? []} />
      <Field label="Observações">
        <Textarea name="notes" maxLength={LIMITS.choreNotes} defaultValue={item?.notes ?? ""} />
      </Field>
      <FormError message={state?.error} />
      <Button disabled={pending}>{pending ? "Salvando…" : item ? "Salvar alterações" : "Criar tarefa"}</Button>
    </form>
  );
}

export function ChoresView({ chores, people, today }: { chores: ChoreVM[]; people: Person[]; today: string }) {
  const [modal, setModal] = useState<{ item?: ChoreVM } | null>(null);
  const { notice, setNotice, error, pending, run } = useRunner();
  const { overdue, today: forToday, upcoming } = choreBuckets(chores, today);

  function row(x: ChoreVM) {
    const late = x.next_due_on && x.next_due_on < today;
    return (
      <Card key={x.id} data-testid="tarefa" aria-label={x.name}>
        <p className="text-lg font-medium">{x.name}</p>
        <p className="mt-1 text-sm">
          Vez de <strong data-testid="responsavel">{x.responsible ?? "ninguém (revise o rodízio)"}</strong>
        </p>
        <p className="text-sm text-muted">
          {frequencyLabel(x)}
          {x.next_due_on ? ` · ${late ? "era para " : ""}${x.next_due_on === today ? "hoje" : shortDayLabel(x.next_due_on)}` : ""}
        </p>
        {x.notes && <p className="mt-2 whitespace-pre-wrap text-sm">{x.notes}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button type="button" className={smallBtn} disabled={pending} onClick={() => run(() => completeChore(x.id, { next_index: x.next_index, next_due_on: x.next_due_on }), `${x.name}: feita.`)}>
            Feita
          </Button>
          {x.validPeople > 1 && (
            <Button type="button" variant="ghost" className={smallBtn} disabled={pending} onClick={() => run(() => skipChoreTurn(x.id, { next_index: x.next_index, next_due_on: x.next_due_on }), "Vez passada para a próxima pessoa.")}>
              Pular a vez
            </Button>
          )}
          <Button type="button" variant="ghost" className={smallBtn} onClick={() => setModal({ item: x })}>
            Editar
          </Button>
          <ConfirmDelete what="esta tarefa" pending={pending} onConfirm={() => run(() => deleteChore(x.id), "Tarefa apagada.")} />
        </div>
        <details className="mt-2">
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-medium text-link">Histórico</summary>
          {x.history.length === 0 ? (
            <p className="text-sm text-muted">Ainda não foi feita.</p>
          ) : (
            <ul className="text-sm text-muted" aria-label={`Histórico de ${x.name}`}>
              {x.history.map((h) => (
                <li key={h.id}>
                  {brDate(h.done_on)} · {h.person}
                </li>
              ))}
            </ul>
          )}
        </details>
      </Card>
    );
  }

  function section(title: string, list: ChoreVM[], empty?: string) {
    if (list.length === 0 && !empty) return null;
    return (
      <section aria-label={title} className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">{title}</h2>
        {list.length === 0 ? <p className="text-sm text-muted">{empty}</p> : list.map(row)}
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-end">
        <Button onClick={() => setModal({})}>
          <Plus size={18} aria-hidden /> Nova tarefa
        </Button>
      </div>
      <Feedback notice={notice} error={error} />
      {chores.length === 0 ? (
        <EmptyState title="Nenhuma tarefa ainda.">Crie as tarefas da casa e o rodízio de quem faz.</EmptyState>
      ) : (
        <>
          {section("Atrasadas", overdue)}
          {section("Hoje", forToday, "Nada para hoje.")}
          {section("Próximas", upcoming)}
        </>
      )}
      <Modal open={modal !== null} onClose={() => setModal(null)} title={modal?.item ? "Editar tarefa" : "Nova tarefa"}>
        <ChoreForm
          item={modal?.item}
          people={people}
          onDone={(m) => {
            setNotice(m ?? "Tarefa salva.");
            setModal(null);
          }}
        />
      </Modal>
    </div>
  );
}
