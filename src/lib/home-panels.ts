import { brDate, toSpDate, toSpTime } from "@/lib/agenda/dates";
import type { AgendaEvent } from "@/lib/agenda/view";
import { HOME_MODULES } from "@/lib/modules";
import { splitAppointments } from "@/lib/saude/view";
import type { HealthAppointment } from "@/lib/saude/types";
import { wrapIndex } from "@/lib/arc-nav";

/** Painel do Início que corresponde a cada item do arco (mesma ordem de HOME_MODULES). */
export type HomePanelKey = "financas" | "saude" | "agenda" | "casa" | "ministerio";

export const HOME_PANEL_INFO: Record<HomePanelKey, { title: string; href: string; link: string }> = {
  financas: { title: "Finanças do mês", href: "/financas", link: "Abrir Finanças" },
  saude: { title: "Próximas consultas e exames", href: "/saude/consultas", link: "Abrir Saúde" },
  agenda: { title: "Próximos eventos", href: "/agenda", link: "Abrir Agenda" },
  casa: { title: "Resumo da Casa", href: "/casa", link: "Abrir Casa" },
  ministerio: { title: "Resumo da Igreja", href: "/ministerio", link: "Abrir Igreja" },
};

const KEY_BY_HREF: Record<string, HomePanelKey> = {
  "/financas": "financas",
  "/saude": "saude",
  "/agenda": "agenda",
  "/casa": "casa",
  "/ministerio": "ministerio",
};

/** Painéis na ordem do arco do Início. */
export const HOME_PANELS: HomePanelKey[] = HOME_MODULES.map((m) => KEY_BY_HREF[m.href]);

/** Painel do item que está no centro do arco (o índice pode "dar a volta": o arco é circular). */
export function homePanelAt(index: number): HomePanelKey {
  return HOME_PANELS[wrapIndex(index, HOME_PANELS.length)];
}

/** Item inicial do arco: Agenda; com `?mes=` na URL (seletor de mês das Finanças), começa nas Finanças. */
export function initialHomeIndex(hasMonth: boolean) {
  return HOME_PANELS.indexOf(hasMonth ? "financas" : "agenda");
}

export type HealthItem = { id: string; when: string; title: string; person: string };

/**
 * Próximas consultas/retornos (agendadas, daqui para frente) e exames com data de hoje em diante, mais cedo primeiro.
 * Exame sem hora fica depois das consultas do mesmo dia.
 */
export function nextHealthItems(
  appointments: HealthAppointment[],
  exams: { id: string; member_id: string; name: string; exam_date: string | null }[],
  nameOf: (memberId: string) => string,
  today: string,
  nowMs: number = Date.now(),
  n = 3,
): HealthItem[] {
  const appts = splitAppointments(appointments, nowMs).upcoming.map((a) => ({
    sort: `${toSpDate(a.starts_at)}T${toSpTime(a.starts_at)}`,
    item: {
      id: a.id,
      when: `${brDate(toSpDate(a.starts_at))} às ${toSpTime(a.starts_at)}`,
      title: `${a.kind === "retorno" ? "Retorno" : "Consulta"}${a.specialty ? `: ${a.specialty}` : ""}`,
      person: nameOf(a.member_id),
    },
  }));
  const ex = exams
    .filter((e) => e.exam_date && e.exam_date >= today)
    .map((e) => ({ sort: `${e.exam_date}T99`, item: { id: e.id, when: brDate(e.exam_date!), title: `Exame: ${e.name}`, person: nameOf(e.member_id) } }));
  return [...appts, ...ex]
    .sort((a, b) => a.sort.localeCompare(b.sort))
    .slice(0, n)
    .map((x) => x.item);
}

export type AgendaItem = { id: string; when: string; title: string; owner: string };

/** Próximos eventos (que ainda não terminaram), mais cedo primeiro; "Hoje" no lugar da data de hoje. */
export function nextAgendaEvents(events: AgendaEvent[], today: string, nowMs: number = Date.now(), n = 3): AgendaItem[] {
  return events
    .filter((e) => Date.parse(e.endsAt) > nowMs)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
    .slice(0, n)
    .map((e) => {
      const day = toSpDate(e.startsAt);
      const date = day === today ? "Hoje" : brDate(day);
      return { id: e.id, when: e.allDay ? `${date} · dia todo` : `${date} às ${toSpTime(e.startsAt)}`, title: e.title, owner: e.owner };
    });
}
