import { Landmark, Trash2, Unlink } from "lucide-react";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { getAppContext } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { getFinanceBase } from "@/lib/financas/data";
import { formatBRL } from "@/lib/financas/money";
import { listAccounts, pluggyAllowedFor, pluggyConfigured } from "@/lib/pluggy/client";
import { accountKindFrom, addDaysISO, bankBalanceToApp, maskNumber, type PluggyAccount } from "@/lib/pluggy/normalize";
import { todaySP } from "@/lib/financas/today";
import { ACCOUNT_KIND_LABEL } from "@/lib/financas/types";
import { AddItemForm, LinkAccountForm, SyncButton } from "../_components/open-finance-forms";
import { removeItem, unlinkAccount } from "../open-finance-actions";

export const metadata = { title: "Open Finance" };

const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
const dateOnly = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" });

export default async function OpenFinancePage() {
  const { household } = await getAppContext();

  if (!pluggyConfigured() || !pluggyAllowedFor(household.id)) {
    return (
      <Card className="flex flex-col gap-3">
        <PageHeader title="Open Finance" subtitle="Conexão com os bancos pelo Meu Pluggy" />
        <p className="text-sm">
          {pluggyConfigured()
            ? "As credenciais da Pluggy estão configuradas, mas esta família ainda não foi autorizada."
            : "Falta configurar as credenciais da Pluggy no servidor."}
        </p>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
          <li>Na Vercel: Settings → Environment Variables.</li>
          <li>Crie <code>PLUGGY_CLIENT_ID</code> e <code>PLUGGY_CLIENT_SECRET</code> (marque Sensitive).</li>
          <li>
            Crie <code>PLUGGY_HOUSEHOLD_ID</code> com o valor{" "}
            <code className="select-all rounded bg-surface-2 px-1">{household.id}</code>.
          </li>
          <li>Faça um novo deploy para as variáveis valerem.</li>
        </ol>
      </Card>
    );
  }

  const supabase = await createClient();
  const [{ data: items }, { accounts }] = await Promise.all([
    supabase
      .from("fin_pluggy_items")
      .select("id, item_id, label, status, consent_expires_at, last_sync_at, last_error")
      .eq("household_id", household.id)
      .order("created_at"),
    getFinanceBase(),
  ]);

  const remoteByItem = new Map<string, PluggyAccount[] | null>();
  await Promise.all(
    (items ?? []).map(async (i) => {
      try {
        remoteByItem.set(i.id, await listAccounts(i.item_id));
      } catch {
        remoteByItem.set(i.id, null);
      }
    }),
  );
  const soon = addDaysISO(todaySP(), 30);

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted">
          O Meu Pluggy atualiza os bancos 1 vez por dia. O app sincroniza ao abrir Finanças (se passou de 6 horas) ou pelo
          botão.
        </p>
        <SyncButton />
      </Card>

      {(items ?? []).length === 0 && <EmptyState title="Nenhum banco conectado">Cole abaixo o id do item copiado no dashboard da Pluggy.</EmptyState>}

      {(items ?? []).map((item) => {
        const remote = remoteByItem.get(item.id);
        const expiring = item.consent_expires_at && item.consent_expires_at.slice(0, 10) < soon;
        return (
          <Card key={item.id} className="flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <Landmark size={20} className="mt-0.5 shrink-0 text-olive" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{item.label}</p>
                <p className="text-[12px] text-muted">
                  {item.status ?? "—"}
                  {item.last_sync_at && ` · sincronizado ${dateTime.format(new Date(item.last_sync_at))}`}
                </p>
                {item.consent_expires_at && (
                  <p className={`text-[12px] ${expiring ? "text-danger" : "text-muted"}`}>
                    Autorização válida até {dateOnly.format(new Date(item.consent_expires_at))}
                    {expiring && " — renove no dashboard da Pluggy (Demo → Connect Account → MeuPluggy)"}
                  </p>
                )}
                {item.last_error && <p className="text-[12px] text-danger">{item.last_error}</p>}
              </div>
              <form action={removeItem}>
                <input type="hidden" name="id" value={item.id} />
                <button aria-label={`Remover conexão ${item.label}`} className="grid size-11 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-danger">
                  <Trash2 size={16} />
                </button>
              </form>
            </div>

            {remote === null ? (
              <p className="text-sm text-danger">Não foi possível ler as contas desta conexão agora.</p>
            ) : (
              <ul className="divide-y divide-line border-t border-line">
                {remote!.map((r) => {
                  const linked = accounts.find((a) => a.external_id === r.id);
                  const kind = accountKindFrom(r);
                  const options = accounts.filter((a) => !a.external_id && !a.archived && a.kind === kind);
                  return (
                    <li key={r.id} className="py-3">
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="min-w-0 truncate">
                          {r.marketingName || r.name} <span className="text-muted">{maskNumber(r.number)}</span>
                        </span>
                        <span className="shrink-0 tabular-nums">{formatBRL(bankBalanceToApp(r))}</span>
                      </div>
                      <p className="text-[12px] text-muted">{ACCOUNT_KIND_LABEL[kind]}</p>
                      {linked ? (
                        <div className="mt-1 flex items-center justify-between gap-2 text-[13px]">
                          <span>
                            Vinculada a <strong>{linked.name}</strong>
                            {linked.sync_from && ` · desde ${linked.sync_from.split("-").reverse().join("/")}`}
                          </span>
                          <form action={unlinkAccount}>
                            <input type="hidden" name="id" value={linked.id} />
                            <button className="flex items-center gap-1 text-muted hover:text-danger">
                              <Unlink size={13} /> desvincular
                            </button>
                          </form>
                        </div>
                      ) : (
                        <LinkAccountForm itemRef={item.id} remoteId={r.id} options={options.map((o) => ({ id: o.id, name: o.name }))} />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        );
      })}

      <Card>
        <h2 className="mb-3 font-medium">Conectar banco</h2>
        <AddItemForm />
        <p className="mt-3 text-[12px] text-muted">
          Uso pessoal do Meu Pluggy: até 5 conexões. Só o id do item fica salvo aqui; as credenciais ficam no servidor.
        </p>
      </Card>
    </div>
  );
}
