"use client";

import { useState } from "react";
import { Plus, ShoppingCart } from "lucide-react";
import { Button, Card, Field, Input, Textarea } from "@/components/ui";
import { Modal } from "@/components/modal";
import { brDate } from "@/lib/agenda/dates";
import { formatQty } from "@/lib/casa/view";
import { PET_LIMITS } from "@/lib/casa/pet-input";
import { foodForecast, weightHistory, type PetFood, type PetWeight } from "@/lib/casa/pet";
import { deletePetFood, deletePetWeight, savePetFood, savePetWeight, sendFoodToShopping } from "../pet-actions";
import { ConfirmDelete, Feedback, smallBtn, useRunner } from "./shared";
import { ActionForm, decInput, StatusTag } from "./pet-shared";

const kg = (n: number) => `${formatQty(n)} kg`;

/** Peso: um registro por dia (registrar de novo no mesmo dia atualiza), com a variação desde a medição anterior. */
export function PetWeightSection({ petId, items, today }: { petId: string; items: PetWeight[]; today: string }) {
  const { notice, setNotice, error, pending, run } = useRunner();
  const [formKey, setFormKey] = useState(0);
  const rows = weightHistory(items);

  return (
    <section aria-label="Peso" className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold tracking-tight">Peso</h2>
      <Feedback notice={notice} error={error} />
      <Card>
        <ActionForm
          key={formKey}
          label="Registrar peso"
          action={savePetWeight}
          submit="Registrar peso"
          onDone={(m) => {
            setNotice(m ?? "Peso registrado.");
            setFormKey((k) => k + 1);
          }}
        >
          <input type="hidden" name="pet_id" value={petId} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Peso (kg)">
              <Input name="weight_kg" inputMode="decimal" placeholder="Ex.: 12,5" required autoComplete="off" />
            </Field>
            <Field label="Data da pesagem">
              <Input name="measured_on" type="date" max={today} defaultValue={today} required />
            </Field>
          </div>
        </ActionForm>
        {rows.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Nenhuma pesagem ainda.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line" aria-label="Histórico de peso">
            {rows.map((w) => (
              <li key={w.id} data-testid="pet-peso" className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-medium">{kg(w.weight_kg)}</span>
                  <span className="text-sm text-muted"> · {brDate(w.measured_on)}</span>
                  {w.delta !== null && (
                    <span className="text-sm text-muted" data-testid="variacao">
                      {" "}
                      · {w.delta === 0 ? "sem variação" : `${w.delta > 0 ? "+" : "−"}${formatQty(Math.abs(w.delta))} kg`}
                    </span>
                  )}
                </span>
                <ConfirmDelete label="Remover" what={`a pesagem de ${brDate(w.measured_on)}`} pending={pending} onConfirm={() => run(() => deletePetWeight(w.id), "Pesagem removida.")} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

function FoodForm({ petId, item, today, onDone }: { petId: string; item?: PetFood; today: string; onDone: (msg?: string) => void }) {
  return (
    <ActionForm action={savePetFood} onDone={onDone} submit={item ? "Salvar alterações" : "Salvar ração"}>
      {item && <input type="hidden" name="id" value={item.id} />}
      <input type="hidden" name="pet_id" value={petId} />
      <Field label="Ração">
        <Input name="brand" maxLength={PET_LIMITS.brand} defaultValue={item?.brand} placeholder="Ex.: Premier Adulto Raças Médias" required autoComplete="off" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Saco (kg)">
          <Input name="bag_kg" inputMode="decimal" defaultValue={decInput(item?.bag_kg ?? null)} placeholder="Ex.: 15" required autoComplete="off" />
        </Field>
        <Field label="Gramas por dia">
          <Input name="daily_grams" type="number" min={1} max={PET_LIMITS.dailyMax} defaultValue={item?.daily_grams ?? ""} placeholder="Ex.: 300" />
        </Field>
      </div>
      <Field label="Começou em">
        <Input name="started_on" type="date" defaultValue={item?.started_on ?? today} required />
      </Field>
      <Field label="Observações">
        <Textarea name="notes" maxLength={PET_LIMITS.foodNotes} defaultValue={item?.notes ?? ""} />
      </Field>
    </ActionForm>
  );
}

/** Ração ativa com a previsão de quando acaba e o botão para a lista de compras; as anteriores ficam no histórico. */
export function PetFoodSection({ petId, items, today }: { petId: string; items: PetFood[]; today: string }) {
  const [modal, setModal] = useState<{ item?: PetFood } | null>(null);
  const { notice, setNotice, error, pending, run } = useRunner();
  const active = items.find((f) => f.active) ?? null;
  const past = items.filter((f) => f !== active);
  const fc = active ? foodForecast(active, today) : null;

  return (
    <section aria-label="Ração" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight">Ração</h2>
        <Button type="button" className={smallBtn} onClick={() => setModal({})}>
          <Plus size={16} aria-hidden /> {active ? "Novo saco" : "Cadastrar ração"}
        </Button>
      </div>
      <Feedback notice={notice} error={error} />
      {active ? (
        <Card data-testid="pet-racao" aria-label={active.brand}>
          <div className="flex items-start justify-between gap-3">
            <p className="text-lg font-medium">{active.brand}</p>
            {fc?.low && <StatusTag tone={fc.daysLeft < 0 ? "danger" : "warning"}>{fc.daysLeft < 0 ? "Acabou" : "Acabando"}</StatusTag>}
          </div>
          <p className="text-sm text-muted">
            Saco de {kg(active.bag_kg)}
            {active.daily_grams ? ` · ${active.daily_grams} g por dia` : ""} · começou em {brDate(active.started_on)}
          </p>
          <p className="mt-1 text-sm" data-testid="previsao">
            {fc
              ? fc.daysLeft < 0
                ? `Pela previsão, acabou em ${brDate(fc.endsOn)}.`
                : fc.daysLeft === 0
                  ? "Pela previsão, acaba hoje."
                  : `Acaba por volta de ${brDate(fc.endsOn)} (em ${fc.daysLeft} dia${fc.daysLeft === 1 ? "" : "s"}).`
              : "Informe as gramas por dia para ver quando acaba."}
          </p>
          {active.notes && <p className="mt-1 whitespace-pre-wrap text-sm">{active.notes}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button type="button" variant="ghost" className={smallBtn} disabled={pending} onClick={() => run(() => sendFoodToShopping(active.id), (r) => r.message ?? null)}>
              <ShoppingCart size={16} aria-hidden /> Mandar ração para a lista de compras
            </Button>
            <Button type="button" variant="ghost" className={smallBtn} onClick={() => setModal({ item: active })}>
              Editar
            </Button>
            <ConfirmDelete what="esta ração" pending={pending} onConfirm={() => run(() => deletePetFood(active.id), "Ração apagada.")} />
          </div>
        </Card>
      ) : (
        <Card>
          <p className="text-sm text-muted">Nenhuma ração cadastrada.</p>
        </Card>
      )}
      {past.length > 0 && (
        <details>
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-medium text-link">Rações anteriores</summary>
          <ul className="text-sm text-muted">
            {past.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-1">
                <span>
                  {f.brand} · {kg(f.bag_kg)} · {brDate(f.started_on)}
                </span>
                <ConfirmDelete label="Remover" what="esta ração" pending={pending} onConfirm={() => run(() => deletePetFood(f.id), "Ração apagada.")} />
              </li>
            ))}
          </ul>
        </details>
      )}
      <Modal open={modal !== null} onClose={() => setModal(null)} title={modal?.item ? "Editar ração" : "Nova ração"}>
        {modal && (
          <FoodForm
            petId={petId}
            item={modal.item}
            today={today}
            onDone={(m) => {
              setNotice(m ?? "Ração salva.");
              setModal(null);
            }}
          />
        )}
      </Modal>
    </section>
  );
}
