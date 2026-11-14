"use client";

import { startTransition, useActionState, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Copy, ShoppingCart } from "lucide-react";
import clsx from "clsx";
import { Button, Card, Field, FormError, Input, Textarea } from "@/components/ui";
import { Modal } from "@/components/modal";
import { addDays, brDate, longDayLabel } from "@/lib/agenda/dates";
import { LIMITS } from "@/lib/casa/input";
import { weekDays } from "@/lib/casa/menu";
import { MEAL_LABEL, MEALS, type Meal, type MealPlan } from "@/lib/casa/types";
import { copyPreviousWeek, deleteMeal, saveMeal, sendIngredientsToList, type MealState } from "../cardapio-actions";
import { ConfirmDelete, Feedback, smallBtn, useOnSaved, useRunner } from "./shared";

type Slot = { day: string; meal: Meal; item?: MealPlan };

function MealForm({ slot, onDone }: { slot: Slot; onDone: (msg?: string) => void }) {
  const [state, action, pending] = useActionState<MealState, FormData>(saveMeal, null);
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
      <input type="hidden" name="day" value={slot.day} />
      <input type="hidden" name="meal" value={slot.meal} />
      <Field label="Prato">
        <Input name="title" maxLength={LIMITS.mealTitle} defaultValue={slot.item?.title} placeholder="Ex.: Arroz, feijão e frango" required autoComplete="off" />
      </Field>
      <Field label="Ingredientes (um por linha)">
        <Textarea name="ingredients" rows={6} defaultValue={slot.item?.ingredients.join("\n") ?? ""} placeholder={"Arroz\nFeijão\nFrango"} />
      </Field>
      <Field label="Observações">
        <Textarea name="notes" maxLength={LIMITS.mealNotes} defaultValue={slot.item?.notes ?? ""} />
      </Field>
      <FormError message={state?.error} />
      <Button disabled={pending}>{pending ? "Salvando…" : "Salvar refeição"}</Button>
    </form>
  );
}

const navBtn =
  "glass-card grid size-11 shrink-0 place-items-center rounded-full text-ink transition hover:text-primary";

export function MenuView({ monday, today, meals }: { monday: string; today: string; meals: MealPlan[] }) {
  const [slot, setSlot] = useState<Slot | null>(null);
  const { notice, setNotice, error, pending, run } = useRunner();
  const byKey = new Map(meals.map((m) => [`${m.day}|${m.meal}`, m]));
  const days = weekDays(monday);
  const hasIngredients = meals.some((m) => m.ingredients.length > 0);
  const msg = (r: { message?: string }) => r.message ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex w-full items-center justify-between gap-2">
        <Link href={`/casa/cardapio?semana=${addDays(monday, -7)}`} aria-label="Semana anterior" className={navBtn}>
          <ChevronLeft size={18} />
        </Link>
        <span className="flex-1 text-center text-base font-semibold" data-testid="semana">
          {brDate(monday).slice(0, 5)} a {brDate(addDays(monday, 6))}
        </span>
        <Link href={`/casa/cardapio?semana=${addDays(monday, 7)}`} aria-label="Próxima semana" className={navBtn}>
          <ChevronRight size={18} />
        </Link>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="ghost" className={smallBtn} disabled={pending} onClick={() => run(() => copyPreviousWeek(monday), msg)}>
          <Copy size={16} aria-hidden /> Copiar a semana anterior
        </Button>
        <Button type="button" variant="ghost" className={smallBtn} disabled={pending || !hasIngredients} onClick={() => run(() => sendIngredientsToList({ week: monday }), msg)}>
          <ShoppingCart size={16} aria-hidden /> Mandar ingredientes da semana para a lista de compras
        </Button>
      </div>
      <Feedback notice={notice} error={error} />
      <div className="grid gap-3 lg:grid-cols-2">
        {days.map((day) => (
          <Card key={day} role="region" aria-label={longDayLabel(day)} className={clsx(day === today && "ring-2 ring-primary")}>
            <h2 className="font-medium">
              {longDayLabel(day)}
              {day === today && <span className="ml-2 text-sm text-primary">hoje</span>}
            </h2>
            <ul className="mt-1 divide-y divide-line">
              {MEALS.map((meal) => {
                const item = byKey.get(`${day}|${meal}`);
                return (
                  <li key={meal} data-testid="refeicao" aria-label={`${MEAL_LABEL[meal]} de ${longDayLabel(day)}`} className="py-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[12px] text-muted">{MEAL_LABEL[meal]}</p>
                        <p className={item ? "font-medium" : "text-sm text-muted"}>{item ? item.title : "—"}</p>
                        {item && item.ingredients.length > 0 && <p className="text-sm text-muted">{item.ingredients.join(", ")}</p>}
                        {item?.notes && <p className="whitespace-pre-wrap text-sm">{item.notes}</p>}
                      </div>
                      <Button type="button" variant="ghost" className={clsx(smallBtn, "shrink-0")} onClick={() => setSlot({ day, meal, item })}>
                        {item ? "Editar" : "Planejar"}
                      </Button>
                    </div>
                    {item && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {item.ingredients.length > 0 && (
                          <Button type="button" variant="ghost" className={smallBtn} disabled={pending} onClick={() => run(() => sendIngredientsToList({ mealId: item.id }), msg)}>
                            <ShoppingCart size={16} aria-hidden /> Mandar para a lista
                          </Button>
                        )}
                        <ConfirmDelete label="Remover" what="esta refeição" pending={pending} onConfirm={() => run(() => deleteMeal(item.id), "Refeição removida.")} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}
      </div>
      <Modal open={slot !== null} onClose={() => setSlot(null)} title={slot ? `${MEAL_LABEL[slot.meal]} · ${longDayLabel(slot.day)}` : ""}>
        {slot && (
          <MealForm
            slot={slot}
            onDone={(m) => {
              setNotice(m ?? "Refeição salva.");
              setSlot(null);
            }}
          />
        )}
      </Modal>
    </div>
  );
}
