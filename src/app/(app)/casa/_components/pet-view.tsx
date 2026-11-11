"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PawPrint, Plus } from "lucide-react";
import { Button, Card, chipClass, EmptyState, Field, Input, Select, Textarea } from "@/components/ui";
import { Modal } from "@/components/modal";
import { brDate } from "@/lib/agenda/dates";
import { PET_LIMITS } from "@/lib/casa/pet-input";
import { PET_SEX_LABEL, PET_SEXES, petAge, SPECIES, SPECIES_LABEL, type Pet, type PetFood, type PetHealth, type PetVet, type PetWeight } from "@/lib/casa/pet";
import { deletePet, savePet } from "../pet-actions";
import { ConfirmDelete, Feedback, smallBtn, useRunner } from "./shared";
import { ActionForm } from "./pet-shared";
import { PetHealthSection } from "./pet-health-view";
import { PetVetSection } from "./pet-vet-view";
import { PetCareSection, type CareVM } from "./pet-care-view";
import { PetFoodSection, PetWeightSection } from "./pet-body-view";
import type { ProviderOption } from "./maintenance-view";

export type PetData = { pet: Pet; health: PetHealth[]; vet: PetVet[]; care: CareVM[]; weights: PetWeight[]; food: PetFood[] };

function PetForm({ pet, today, onDone }: { pet?: Pet; today: string; onDone: (msg?: string, id?: string) => void }) {
  return (
    <ActionForm action={savePet} onDone={onDone} submit={pet ? "Salvar alterações" : "Cadastrar pet"}>
      {pet && <input type="hidden" name="id" value={pet.id} />}
      <Field label="Nome do pet">
        <Input name="name" maxLength={PET_LIMITS.petName} defaultValue={pet?.name} placeholder="Ex.: Moisés" required autoComplete="off" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Espécie">
          <Select name="species" defaultValue={pet?.species ?? "cachorro"}>
            {SPECIES.map((s) => (
              <option key={s} value={s}>
                {SPECIES_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Sexo">
          <Select name="sex" defaultValue={pet?.sex ?? ""}>
            <option value="">Não informado</option>
            {PET_SEXES.map((s) => (
              <option key={s} value={s}>
                {PET_SEX_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Raça">
        <Input name="breed" maxLength={PET_LIMITS.breed} defaultValue={pet?.breed ?? ""} autoComplete="off" />
      </Field>
      <Field label="Nascimento">
        <Input name="birth_date" type="date" max={today} defaultValue={pet?.birth_date ?? ""} />
      </Field>
      <Field label="Observações">
        <Textarea name="notes" maxLength={PET_LIMITS.petNotes} defaultValue={pet?.notes ?? ""} placeholder="Alergias, temperamento, microchip…" />
      </Field>
    </ActionForm>
  );
}

/** Aba Pet: um pet abre direto; com mais de um, seletor no topo. Sem pets, convite para cadastrar. */
export function PetView({ pets, data, providers, today }: { pets: { id: string; name: string }[]; data: PetData | null; providers: ProviderOption[]; today: string }) {
  const router = useRouter();
  const [modal, setModal] = useState<{ pet?: Pet } | null>(null);
  const { notice, setNotice, error, pending, run } = useRunner();
  const pet = data?.pet ?? null;

  const form = (
    <Modal open={modal !== null} onClose={() => setModal(null)} title={modal?.pet ? `Editar ${modal.pet.name}` : "Novo pet"}>
      {modal && (
        <PetForm
          pet={modal.pet}
          today={today}
          onDone={(m, id) => {
            setNotice(m ?? "Pet salvo.");
            setModal(null);
            // Primeiro pet: a revalidação já abre nele. Outro pet: troca para ele (a página remonta com o novo ?pet=).
            if (!modal.pet && id && pets.length > 0) router.push(`/casa/pet?pet=${id}`, { scroll: false });
          }}
        />
      )}
    </Modal>
  );

  // O modal fica sempre na mesma posição da árvore: ao cadastrar o primeiro pet a tela troca de "vazia" para o pet
  // na mesma resposta da action, e um modal remontado perderia o resultado (e o aviso de sucesso).
  if (!pet || !data) {
    return (
      <>
        {form}
        <div className="flex flex-col gap-6">
          <Feedback notice={notice} error={error} />
          <EmptyState title="Nenhum pet cadastrado.">Cadastre o pet da família para acompanhar vacinas, veterinário, banho, peso e ração.</EmptyState>
          <div className="flex justify-center">
            <Button onClick={() => setModal({})}>
              <Plus size={18} aria-hidden /> Cadastrar pet
            </Button>
          </div>
        </div>
      </>
    );
  }

  const age = petAge(pet.birth_date, today);
  const info = [SPECIES_LABEL[pet.species], pet.breed, pet.sex ? PET_SEX_LABEL[pet.sex] : null, age].filter(Boolean).join(" · ");

  return (
    <>
      {form}
      <div className="flex flex-col gap-8">
        {pets.length > 1 && (
          <nav aria-label="Escolher pet" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {pets.map((p) => (
              <Link key={p.id} href={`/casa/pet?pet=${p.id}`} scroll={false} aria-current={p.id === pet.id ? "page" : undefined} className={chipClass(p.id === pet.id)}>
                {p.name}
              </Link>
            ))}
          </nav>
        )}
        <Card aria-label={`Pet ${pet.name}`} data-testid="pet">
          <div className="flex items-start gap-4">
            <span className="grid size-12 shrink-0 place-items-center rounded-full border border-line bg-accent-soft text-primary">
              <PawPrint size={22} aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 className="text-2xl font-semibold tracking-tight">{pet.name}</h2>
              <p className="text-sm text-muted">{info}</p>
              {pet.birth_date && <p className="text-sm text-muted">Nascimento: {brDate(pet.birth_date)}</p>}
              {pet.notes && <p className="mt-1 whitespace-pre-wrap text-sm">{pet.notes}</p>}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button type="button" variant="ghost" className={smallBtn} onClick={() => setModal({ pet })}>
              Editar
            </Button>
            <Button type="button" variant="ghost" className={smallBtn} onClick={() => setModal({})}>
              <Plus size={16} aria-hidden /> Outro pet
            </Button>
            <ConfirmDelete
              what={`${pet.name} e todos os registros dele`}
              pending={pending}
              onConfirm={async () => {
                const r = await run(() => deletePet(pet.id), `${pet.name} foi apagado.`);
                if (r.ok) router.push("/casa/pet", { scroll: false });
              }}
            />
          </div>
        </Card>
        <Feedback notice={notice} error={error} />
        <PetHealthSection key={`saude-${pet.id}`} petId={pet.id} petName={pet.name} items={data.health} today={today} />
        <PetCareSection key={`cuidados-${pet.id}`} petId={pet.id} items={data.care} providers={providers} today={today} />
        <PetVetSection key={`vet-${pet.id}`} petId={pet.id} items={data.vet} today={today} />
        <PetWeightSection key={`peso-${pet.id}`} petId={pet.id} items={data.weights} today={today} />
        <PetFoodSection key={`racao-${pet.id}`} petId={pet.id} items={data.food} today={today} />
      </div>
    </>
  );
}
