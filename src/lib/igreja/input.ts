/**
 * Validação de entrada da Igreja (Devocional e Carisma). Roda no servidor; no navegador só ajuda.
 * household_id e owner_id nunca vêm do formulário: as actions usam getAppContext() (usuário da sessão).
 * Limites iguais aos checks da migração da Igreja.
 */
import { isDate } from "@/lib/agenda/dates";

export const IGREJA_LIMITS = {
  wordTitle: 120,
  wordBody: 5000,
  reference: 120,
  prayerTitle: 120,
  person: 120,
  prayerDetails: 2000,
  answerNotes: 2000,
  purposeTitle: 120,
  purposeDescription: 2000,
  purposeNotes: 2000,
  lessonTitle: 160,
  subject: 120,
  teacher: 120,
  lessonNotes: 10000,
  summary: 20000,
} as const;

export const WORD_KINDS = ["anotacao", "promessa"] as const;
export type WordKind = (typeof WORD_KINDS)[number];
export const PRAYER_STATUSES = ["orando", "respondida"] as const;
export type PrayerStatus = (typeof PRAYER_STATUSES)[number];
export const PURPOSE_STATUSES = ["planejado", "em_andamento", "concluido"] as const;
export type PurposeStatus = (typeof PURPOSE_STATUSES)[number];
export const SUMMARY_STATUSES = ["nenhum", "pronto", "erro"] as const;
export type SummaryStatus = (typeof SUMMARY_STATUSES)[number];

export const PURPOSE_STATUS_LABEL: Record<PurposeStatus, string> = {
  planejado: "Planejado",
  em_andamento: "Em andamento",
  concluido: "Concluído",
};

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

type Fail = { ok: false; erro: string };
type Ok<T> = { ok: true; value: T };
const fail = (erro: string): Fail => ({ ok: false, erro });

/** Texto com quebras de linha preservadas (\r\n → \n), sem caracteres de controle (exceto \n e \t). */
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const clean = (v: unknown) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n").replace(CONTROL, "").trim() : "");
const oneLine = (v: unknown) => clean(v).replace(/\s+/g, " ");
const orNull = (s: string) => s || null;
const tooLong = (label: string, s: string, max: number): Fail | null => (s.length > max ? fail(`${label} muito longo (máximo ${max}).`) : null);

/** "on"/"true"/"1" → true (checkbox "Compartilhar com a família"). */
export const isChecked = (v: unknown) => v === "on" || v === "true" || v === "1";

function optionalDate(v: unknown, label: string): Ok<string | null> | Fail {
  const s = clean(v);
  if (!s) return { ok: true, value: null };
  return isDate(s) ? { ok: true, value: s } : fail(`${label} inválida.`);
}

/* ---------- Anotações e Promessas ---------- */

export type WordInput = {
  kind: WordKind;
  title: string | null;
  body: string;
  received_on: string;
  reference: string | null;
  fulfilled_on: string | null;
  shared: boolean;
};

export function validateWordInput(raw: Record<string, unknown>, today: string): Ok<WordInput> | Fail {
  const kind = clean(raw.kind) as WordKind;
  if (!WORD_KINDS.includes(kind)) return fail("Tipo inválido.");
  const title = oneLine(raw.title);
  const body = clean(raw.body);
  const reference = oneLine(raw.reference);
  if (!body) return fail(kind === "promessa" ? "Escreva a promessa." : "Escreva a anotação.");
  const err =
    tooLong("Título", title, IGREJA_LIMITS.wordTitle) ??
    tooLong("Texto", body, IGREJA_LIMITS.wordBody) ??
    tooLong("Referência", reference, IGREJA_LIMITS.reference);
  if (err) return err;
  const received = optionalDate(raw.received_on, "Data");
  if (!received.ok) return received;
  let fulfilled: string | null = null;
  if (kind === "promessa") {
    const f = optionalDate(raw.fulfilled_on, "Data do cumprimento");
    if (!f.ok) return f;
    fulfilled = f.value;
  }
  return {
    ok: true,
    value: {
      kind,
      title: orNull(title),
      body,
      received_on: received.value ?? today,
      reference: orNull(reference),
      fulfilled_on: fulfilled,
      shared: isChecked(raw.shared),
    },
  };
}

/* ---------- Orações ---------- */

export type PrayerInput = {
  title: string;
  person: string | null;
  details: string | null;
  status: PrayerStatus;
  answered_on: string | null;
  answer_notes: string | null;
  shared: boolean;
};

export function validatePrayerInput(raw: Record<string, unknown>, today: string): Ok<PrayerInput> | Fail {
  const title = oneLine(raw.title);
  if (!title) return fail("Informe o motivo da oração.");
  const person = oneLine(raw.person);
  const details = clean(raw.details);
  const err =
    tooLong("Motivo", title, IGREJA_LIMITS.prayerTitle) ??
    tooLong("Pessoa", person, IGREJA_LIMITS.person) ??
    tooLong("Detalhes", details, IGREJA_LIMITS.prayerDetails);
  if (err) return err;
  const status = (clean(raw.status) || "orando") as PrayerStatus;
  if (!PRAYER_STATUSES.includes(status)) return fail("Situação inválida.");
  let answeredOn: string | null = null;
  let answerNotes: string | null = null;
  if (status === "respondida") {
    const a = optionalDate(raw.answered_on, "Data da resposta");
    if (!a.ok) return a;
    answeredOn = a.value ?? today;
    const notes = clean(raw.answer_notes);
    const e = tooLong("Testemunho", notes, IGREJA_LIMITS.answerNotes);
    if (e) return e;
    answerNotes = orNull(notes);
  }
  return {
    ok: true,
    value: { title, person: orNull(person), details: orNull(details), status, answered_on: answeredOn, answer_notes: answerNotes, shared: isChecked(raw.shared) },
  };
}

/* ---------- Propósitos ---------- */

export type PurposeInput = {
  title: string;
  description: string | null;
  status: PurposeStatus;
  starts_on: string | null;
  ends_on: string | null;
  notes: string | null;
  shared: boolean;
};

export function validatePurposeInput(raw: Record<string, unknown>): Ok<PurposeInput> | Fail {
  const title = oneLine(raw.title);
  if (!title) return fail("Informe o propósito.");
  const description = clean(raw.description);
  const notes = clean(raw.notes);
  const err =
    tooLong("Propósito", title, IGREJA_LIMITS.purposeTitle) ??
    tooLong("Descrição", description, IGREJA_LIMITS.purposeDescription) ??
    tooLong("Anotações", notes, IGREJA_LIMITS.purposeNotes);
  if (err) return err;
  const status = (clean(raw.status) || "planejado") as PurposeStatus;
  if (!PURPOSE_STATUSES.includes(status)) return fail("Situação inválida.");
  const starts = optionalDate(raw.starts_on, "Data de início");
  if (!starts.ok) return starts;
  const ends = optionalDate(raw.ends_on, "Data de término");
  if (!ends.ok) return ends;
  if (starts.value && ends.value && ends.value < starts.value) return fail("O término não pode ser antes do início.");
  return {
    ok: true,
    value: { title, description: orNull(description), status, starts_on: starts.value, ends_on: ends.value, notes: orNull(notes), shared: isChecked(raw.shared) },
  };
}

/* ---------- Aulas do Carisma ---------- */

export type LessonInput = {
  title: string;
  lesson_date: string | null;
  subject: string | null;
  teacher: string | null;
  notes: string | null;
};

export function validateLessonInput(raw: Record<string, unknown>): Ok<LessonInput> | Fail {
  const title = oneLine(raw.title);
  if (!title) return fail("Informe o título da aula.");
  const subject = oneLine(raw.subject);
  const teacher = oneLine(raw.teacher);
  const notes = clean(raw.notes);
  const err =
    tooLong("Título", title, IGREJA_LIMITS.lessonTitle) ??
    tooLong("Disciplina", subject, IGREJA_LIMITS.subject) ??
    tooLong("Professor", teacher, IGREJA_LIMITS.teacher) ??
    tooLong("Anotações", notes, IGREJA_LIMITS.lessonNotes);
  if (err) return err;
  const date = optionalDate(raw.lesson_date, "Data da aula");
  if (!date.ok) return date;
  return { ok: true, value: { title, lesson_date: date.value, subject: orNull(subject), teacher: orNull(teacher), notes: orNull(notes) } };
}

/** Resumo editado à mão: texto simples, até 20000. Vazio volta o status para 'nenhum'. */
export function validateSummaryEdit(raw: unknown): Ok<string | null> | Fail {
  const s = clean(raw);
  const err = tooLong("Resumo", s, IGREJA_LIMITS.summary);
  if (err) return err;
  return { ok: true, value: orNull(s) };
}

/* ---------- Compartilhamento (regras da tela) ---------- */

export type Owned = { owner_id: string; shared: boolean };

/** Só o dono edita, apaga ou muda o compartilhamento. O item do cônjuge chega aqui só se estiver compartilhado (RLS). */
export const canEdit = (item: Owned, uid: string) => item.owner_id === uid;

/**
 * Rótulo de quem compartilhou: "compartilhado por Karen" para item do outro; null para item próprio.
 * `members` vem do servidor (user_id → nome).
 */
export function sharedByLabel(item: Owned, uid: string, members: { user_id: string | null; name: string }[]) {
  if (item.owner_id === uid) return null;
  const name = members.find((m) => m.user_id === item.owner_id)?.name ?? "alguém da família";
  return `compartilhado por ${name}`;
}

/** Itens visíveis na tela, com a marca de edição. Item de outra pessoa que NÃO está compartilhado é descartado (defesa extra além da RLS). */
export function withOwnership<T extends Owned>(items: T[], uid: string, members: { user_id: string | null; name: string }[]) {
  return items
    .filter((i) => i.owner_id === uid || i.shared)
    .map((i) => ({ ...i, mine: i.owner_id === uid, sharedBy: sharedByLabel(i, uid, members) }));
}
