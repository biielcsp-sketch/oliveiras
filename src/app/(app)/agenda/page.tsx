import { getAppContext } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/ui";
import { PageTop } from "@/components/page-top";
import { todaySP } from "@/lib/financas/today";
import { addDays, isDate, shortDayLabel } from "@/lib/agenda/dates";
import { groupByDay } from "@/lib/agenda/view";
import { agendaEnabled, getEventsBetween, loadAccounts, writableCalendarsOf } from "@/lib/google/agenda";
import { AgendaView } from "./_components/agenda-view";
import { AccountsSection, type PersonAccounts } from "./_components/accounts-section";

export const metadata = { title: "Agenda" };

const DAYS = 14;

const NOTICES: Record<string, { tone: "ok" | "err"; text: string }> = {
  conectado: { tone: "ok", text: "Conta Google conectada. Os eventos estão chegando." },
  erro: { tone: "err", text: "Não foi possível conectar ao Google. Tente de novo." },
  cancelado: { tone: "err", text: "Conexão cancelada no Google." },
  permissoes: { tone: "err", text: "Para usar a Agenda, marque as permissões de agenda na tela do Google." },
  "em-uso": { tone: "err", text: "Esta conta Google já está conectada por outra pessoa da família." },
  "nao-configurado": { tone: "err", text: "O Google ainda não está configurado no servidor." },
};

export default async function AgendaPage({ searchParams }: { searchParams: Promise<{ de?: string; google?: string }> }) {
  const ctx = await getAppContext();
  const sp = await searchParams;
  const notice = sp.google ? NOTICES[sp.google] : undefined;

  if (!agendaEnabled(ctx.household.id)) {
    return (
      <div>
        <PageTop title="Calendário" backHref="/inicio" backLabel="Voltar para o Início" />
        <EmptyState title="A Agenda ainda não está liberada para esta família." />
      </div>
    );
  }

  const today = todaySP();
  const from = sp.de && isDate(sp.de) ? sp.de : today;
  const to = addDays(from, DAYS - 1);
  const db = await createClient();
  const [events, { accounts, calendars }] = await Promise.all([getEventsBetween(ctx, from, to), loadAccounts(db, ctx.household.id)]);

  const users = ctx.members.filter((m) => m.user_id);
  const people: PersonAccounts[] = users
    .map((m) => ({
      memberId: m.id,
      name: m.name,
      mine: m.id === ctx.me?.id,
      accounts: accounts
        .filter((a) => a.member_id === m.id)
        .map((a) => ({
          id: a.id,
          email: a.email,
          status: a.status,
          lastError: a.last_error,
          lastSyncAt: a.last_sync_at,
          calendars: calendars
            .filter((c) => c.account_ref === a.id)
            .map((c) => ({ id: c.id, summary: c.summary, color: c.color, accessRole: c.access_role, selected: c.selected })),
        })),
    }))
    .sort((a, b) => Number(b.mine) - Number(a.mine));
  const writable = writableCalendarsOf(ctx, accounts, calendars).map((c) => ({ id: c.id, summary: c.summary }));
  const owners = users.filter((m) => accounts.some((a) => a.member_id === m.id));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <PageTop title="Calendário" backHref="/inicio" backLabel="Voltar para o Início" />
        <p className="-mt-2 text-center text-[13px] text-muted">Agendas do casal integradas ao Google</p>
      </div>
      {notice && (
        <p role="status" className={notice.tone === "ok" ? "-mt-2 text-sm text-primary" : "-mt-2 text-sm text-danger"}>
          {notice.text}
        </p>
      )}
      <AgendaView
        groups={groupByDay(events, from, to)}
        today={today}
        people={owners.map((m) => ({ id: m.id, label: m.id === ctx.me?.id ? "Você" : m.name }))}
        calendars={writable}
        prevHref={`/agenda?de=${addDays(from, -7)}`}
        nextHref={`/agenda?de=${addDays(from, 7)}`}
        todayHref={from === today ? null : "/agenda"}
        rangeLabel={`${shortDayLabel(from)} a ${shortDayLabel(to)}`}
        canSync={accounts.length > 0}
      />
      <AccountsSection people={people} />
    </div>
  );
}
