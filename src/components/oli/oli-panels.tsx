import clsx from "clsx";
import { Brain, CalendarClock, CalendarDays, Check, FileText, ListOrdered, PieChart, Trash2, Wallet, X } from "lucide-react";
import { brDate, shortDayLabel } from "@/lib/agenda/dates";
import { safeHex } from "@/lib/agenda/view";
import type { ReactNode } from "react";
import { Button, Card } from "@/components/ui";
import { StatusBadge } from "@/app/(app)/financas/_components/status-badge";
import { formatBRL } from "@/lib/financas/money";
import { shortDate } from "@/lib/financas/period";
import type { OliPanel } from "@/lib/oli/panels";

/**
 * Painéis do Oli: renderização determinística a partir dos DADOS das ferramentas.
 * Todo texto entra como texto do React (escapado); nada de HTML vindo do modelo.
 */
export function OliPanels({
  panels,
  onConfirm,
  onCancel,
  onClear,
}: {
  panels: OliPanel[];
  onConfirm: (id: string) => void;
  onCancel: (id: string) => void;
  onClear: () => void;
}) {
  if (panels.length === 0) return null;
  return (
    <section aria-label="Painéis do Oli" className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">Painéis</h2>
        <button
          type="button"
          onClick={onClear}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[15px] font-medium text-link"
        >
          <X size={16} aria-hidden /> Limpar painéis
        </button>
      </div>
      <ul className="flex flex-col gap-4">
        {panels.map((p) => (
          <li key={p.id} className="oli-rise" data-panel={p.kind}>
            <PanelView panel={p} onConfirm={onConfirm} onCancel={onCancel} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Head({ icon, title, aside }: { icon: ReactNode; title: string; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h3 className="flex items-center gap-2 text-[15px] font-semibold">
        <span className="grid size-8 place-items-center rounded-full bg-accent-soft text-primary">{icon}</span>
        {title}
      </h3>
      {aside}
    </div>
  );
}

const money = (v: number) => <span className="tabular-nums">{formatBRL(v)}</span>;

const DOC_KIND: Record<string, string> = { boleto: "Boleto", comprovante: "Comprovante", outro: "Outro" };
const DOC_STATUS: Record<string, string> = { pendente: "Pendente", confirmado: "Confirmado", descartado: "Descartado" };
const docWhen = (x: { tipo: string; vencimento: string | null; pagamento: string | null }) =>
  x.tipo === "comprovante" ? (x.pagamento ? `pago ${shortDate(x.pagamento)}` : null) : x.vencimento ? `vence ${shortDate(x.vencimento)}` : null;

export function PanelView({
  panel: p,
  onConfirm,
  onCancel,
}: {
  panel: OliPanel;
  onConfirm: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  switch (p.kind) {
    case "resumo": {
      const d = p.data;
      const max = d.categorias[0]?.total ?? 0;
      return (
        <Card>
          <Head icon={<PieChart size={16} aria-hidden />} title={`Resumo de ${d.mes_rotulo}`} />
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Entradas" value={money(d.entradas)} className="text-primary" />
            <Stat label="Saídas" value={money(-d.saidas)} />
            <div className="col-span-2 flex items-center justify-between rounded-2xl bg-surface-2 px-3 py-2.5">
              <p className="text-[13px] text-muted">Saldo do mês</p>
              <p className={clsx("whitespace-nowrap text-[17px] font-semibold", d.saldo >= 0 ? "text-primary" : "text-danger")}>
                {money(d.saldo)}
              </p>
            </div>
          </div>
          {d.categorias.length > 0 && (
            <ul className="mt-4 flex flex-col gap-3" aria-label="Gastos por categoria">
              {d.categorias.map((c) => (
                <li key={c.nome}>
                  <div className="flex justify-between gap-3 text-sm">
                    <span className="truncate">{c.nome}</span>
                    <span className="text-muted">{money(c.total)}</span>
                  </div>
                  <div className="mt-1.5 h-2 rounded-full bg-surface-2">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${max > 0 ? Math.max(4, (c.total / max) * 100) : 0}%`,
                        background: safeColor(c.cor),
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      );
    }
    case "saldos": {
      const d = p.data;
      return (
        <Card>
          <Head icon={<Wallet size={16} aria-hidden />} title="Saldos" aside={<span className="text-sm text-muted">Disponível {formatBRL(d.disponivel)}</span>} />
          <ul className="divide-y divide-line">
            {d.contas.map((c, i) => (
              <Row key={`c${i}`} label={c.nome} value={money(c.saldo)} negative={c.saldo < 0} />
            ))}
            {d.contas.length === 0 && <li className="py-2 text-sm text-muted">Nenhuma conta cadastrada.</li>}
          </ul>
          {d.cartoes.length > 0 && (
            <>
              <p className="mt-3 text-[13px] font-medium text-muted">Cartões</p>
              <ul className="divide-y divide-line">
                {d.cartoes.map((c, i) => (
                  <Row key={`k${i}`} label={c.nome} value={money(c.saldo)} negative={c.saldo < 0} />
                ))}
              </ul>
            </>
          )}
        </Card>
      );
    }
    case "contas": {
      const d = p.data;
      return (
        <Card>
          <Head
            icon={<CalendarClock size={16} aria-hidden />}
            title={`Contas fixas de ${d.mes_rotulo}`}
            aside={<span className="text-sm text-muted">Pendente {formatBRL(d.total_pendente)}</span>}
          />
          {d.contas.length === 0 ? (
            <p className="text-sm text-muted">Nenhuma conta neste mês.</p>
          ) : (
            <ul className="divide-y divide-line">
              {d.contas.map((c, i) => (
                <li key={i} className="flex items-center gap-3 py-2.5 text-[15px]">
                  <span className="w-11 shrink-0 text-[13px] tabular-nums text-muted">{shortDate(c.vencimento)}</span>
                  <span className="min-w-0 flex-1 truncate">{c.nome}</span>
                  <StatusBadge status={c.status} />
                  {money(c.valor)}
                </li>
              ))}
            </ul>
          )}
        </Card>
      );
    }
    case "lancamentos": {
      const d = p.data;
      return (
        <Card>
          <Head icon={<ListOrdered size={16} aria-hidden />} title={d.busca ? `Lançamentos: “${d.busca}”` : "Últimos lançamentos"} />
          {d.itens.length === 0 ? (
            <p className="text-sm text-muted">Nenhum lançamento encontrado.</p>
          ) : (
            <ul className="divide-y divide-line">
              {d.itens.map((t, i) => (
                <li key={i} className="flex items-center gap-3 py-2.5 text-[15px]">
                  <span className="w-11 shrink-0 text-[13px] tabular-nums text-muted">{shortDate(t.data)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{t.descricao}</span>
                    <span className="block truncate text-[12px] text-muted">
                      {[t.categoria ?? "Sem categoria", t.conta].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className={clsx("tabular-nums", t.valor > 0 && "text-primary")}>{formatBRL(t.valor)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      );
    }
    case "memoria":
      return (
        <Card>
          <Head icon={<Brain size={16} aria-hidden />} title={p.titulo} aside={<CategoryChip value={p.data.categoria} />} />
          <p className="text-[15px] leading-relaxed">{p.data.conteudo}</p>
        </Card>
      );
    case "memorias":
      return (
        <Card>
          <Head icon={<Brain size={16} aria-hidden />} title={`Memórias: “${p.data.busca}”`} />
          {p.data.itens.length === 0 ? (
            <p className="text-sm text-muted">Nada guardado sobre isso.</p>
          ) : (
            <ul className="divide-y divide-line">
              {p.data.itens.map((m) => (
                <li key={m.id} className="flex items-start gap-3 py-2.5 text-[15px]">
                  <span className="min-w-0 flex-1">{m.conteudo}</span>
                  <CategoryChip value={m.categoria} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      );
    case "confirmar_lancamento": {
      const d = p.data;
      return (
        <Confirm
          id={p.id}
          title="Confirmar lançamento?"
          status={p.status}
          erro={p.erro}
          doneText={{ criado: "Lançamento salvo.", cancelado: "Lançamento cancelado." }}
          onConfirm={onConfirm}
          onCancel={onCancel}
        >
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[15px]">
            <dt className="text-muted">Descrição</dt>
            <dd className="truncate">{d.descricao}</dd>
            <dt className="text-muted">Valor</dt>
            <dd className={clsx("font-semibold tabular-nums", d.valor > 0 && "text-primary")}>{formatBRL(d.valor)}</dd>
            <dt className="text-muted">Categoria</dt>
            <dd className="truncate">{d.categoria.nome}</dd>
            <dt className="text-muted">Conta</dt>
            <dd className="truncate">{d.conta.nome}</dd>
            <dt className="text-muted">Data</dt>
            <dd className="tabular-nums">{d.data.split("-").reverse().join("/")}</dd>
          </dl>
        </Confirm>
      );
    }
    case "confirmar_esquecer":
      return (
        <Confirm
          id={p.id}
          title="Esquecer esta memória?"
          status={p.status}
          erro={p.erro}
          danger
          doneText={{ criado: "Memória apagada.", cancelado: "A memória foi mantida." }}
          onConfirm={onConfirm}
          onCancel={onCancel}
        >
          <p className="text-[15px] leading-relaxed">{p.data.conteudo}</p>
        </Confirm>
      );
    case "confirmar_memoria":
      return (
        <Confirm
          id={p.id}
          title="Guardar esta memória?"
          status={p.status}
          erro={p.erro}
          doneText={{ criado: "Memória guardada.", cancelado: "A memória não foi guardada." }}
          onConfirm={onConfirm}
          onCancel={onCancel}
        >
          <div className="flex items-start gap-3">
            <p className="min-w-0 flex-1 text-[15px] leading-relaxed">{p.data.conteudo}</p>
            <CategoryChip value={p.data.categoria} />
          </div>
        </Confirm>
      );
    case "eventos": {
      const d = p.data;
      const title = `Agenda ${d.de === d.ate ? `de ${brDate(d.de)}` : `${brDate(d.de).slice(0, 5)} a ${brDate(d.ate).slice(0, 5)}`}`;
      return (
        <Card>
          <Head
            icon={<CalendarDays size={16} aria-hidden />}
            title={d.pessoa ? `${title} · ${d.pessoa}` : title}
            aside={<span className="text-sm text-muted">{d.total === 1 ? "1 evento" : `${d.total} eventos`}</span>}
          />
          {d.itens.length === 0 ? (
            <p className="text-sm text-muted">Nenhum evento no período.</p>
          ) : (
            <ul className="divide-y divide-line">
              {d.itens.map((e, i) => (
                <li key={i} className="flex items-start gap-3 py-2.5 text-[15px]">
                  <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: safeHex(e.cor) }} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{e.titulo}</span>
                    <span className="block truncate text-[12px] text-muted">
                      {[shortDayLabel(e.dia), e.hora, e.pessoa, e.local].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {d.total > d.itens.length && <p className="mt-2 text-[13px] text-muted">E mais {d.total - d.itens.length} na Agenda.</p>}
        </Card>
      );
    }
    case "confirmar_evento": {
      const d = p.data;
      const when = d.dia_inteiro
        ? d.inicio === d.fim
          ? `${brDate(d.inicio)} · Dia inteiro`
          : `${brDate(d.inicio)} a ${brDate(d.fim)} · Dia inteiro`
        : d.inicio.slice(0, 10) === d.fim.slice(0, 10)
          ? `${brDate(d.inicio.slice(0, 10))} · ${d.inicio.slice(11)} – ${d.fim.slice(11)}`
          : `${brDate(d.inicio.slice(0, 10))} ${d.inicio.slice(11)} – ${brDate(d.fim.slice(0, 10))} ${d.fim.slice(11)}`;
      return (
        <Confirm
          id={p.id}
          title="Criar este evento?"
          status={p.status}
          erro={p.erro}
          doneText={{ criado: "Evento criado no Google.", cancelado: "Evento não criado." }}
          onConfirm={onConfirm}
          onCancel={onCancel}
        >
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[15px]">
            <dt className="text-muted">Título</dt>
            <dd className="truncate">{d.titulo}</dd>
            <dt className="text-muted">Quando</dt>
            <dd className="tabular-nums">{when}</dd>
            {d.local && (
              <>
                <dt className="text-muted">Local</dt>
                <dd className="truncate">{d.local}</dd>
              </>
            )}
            <dt className="text-muted">Agenda</dt>
            <dd className="truncate">{d.agenda.nome}</dd>
          </dl>
        </Confirm>
      );
    }
    case "confirmar_consulta": {
      const d = p.data;
      return (
        <Confirm
          id={p.id}
          title="Salvar esta consulta?"
          status={p.status}
          erro={p.erro}
          doneText={{ criado: "Consulta salva em Saúde.", cancelado: "Consulta não salva." }}
          onConfirm={onConfirm}
          onCancel={onCancel}
        >
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[15px]">
            <dt className="text-muted">Pessoa</dt>
            <dd className="truncate">{d.pessoa.nome}</dd>
            <dt className="text-muted">Tipo</dt>
            <dd>{d.tipo === "retorno" ? "Retorno" : "Consulta"}</dd>
            {d.especialidade && (
              <>
                <dt className="text-muted">Especialidade</dt>
                <dd className="truncate">{d.especialidade}</dd>
              </>
            )}
            {d.medico && (
              <>
                <dt className="text-muted">Médico</dt>
                <dd className="truncate">{d.medico}</dd>
              </>
            )}
            <dt className="text-muted">Quando</dt>
            <dd className="tabular-nums">
              {brDate(d.inicio.slice(0, 10))} · {d.inicio.slice(11)}
            </dd>
            {d.local && (
              <>
                <dt className="text-muted">Local</dt>
                <dd className="truncate">{d.local}</dd>
              </>
            )}
          </dl>
        </Confirm>
      );
    }
    case "documentos": {
      const d = p.data;
      return (
        <Card>
          <Head icon={<FileText size={16} aria-hidden />} title="Documentos recentes" />
          {d.itens.length === 0 ? (
            <p className="text-sm text-muted">Nenhum documento enviado.</p>
          ) : (
            <ul className="divide-y divide-line">
              {d.itens.map((x) => (
                <li key={x.id} className="flex items-center gap-3 py-2.5 text-[15px]">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{x.beneficiario ?? DOC_KIND[x.tipo] ?? x.tipo}</span>
                    <span className="block truncate text-[12px] text-muted">
                      {[DOC_KIND[x.tipo] ?? x.tipo, docWhen(x), DOC_STATUS[x.status] ?? x.status].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  {x.valor !== null && money(x.valor)}
                </li>
              ))}
            </ul>
          )}
        </Card>
      );
    }
    case "documento": {
      const d = p.data;
      return (
        <Card>
          <Head icon={<FileText size={16} aria-hidden />} title={d.beneficiario ?? DOC_KIND[d.tipo] ?? "Documento"} aside={<span className="text-sm text-muted">{DOC_STATUS[d.status] ?? d.status}</span>} />
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[15px]">
            <dt className="text-muted">Tipo</dt>
            <dd>{DOC_KIND[d.tipo] ?? d.tipo}</dd>
            {d.valor !== null && (<><dt className="text-muted">Valor</dt><dd>{money(d.valor)}</dd></>)}
            {d.vencimento && (<><dt className="text-muted">Vencimento</dt><dd className="tabular-nums">{brDate(d.vencimento)}</dd></>)}
            {d.pagamento && (<><dt className="text-muted">Pago em</dt><dd className="tabular-nums">{brDate(d.pagamento)}</dd></>)}
            {d.descricao && (<><dt className="text-muted">Descrição</dt><dd className="truncate">{d.descricao}</dd></>)}
          </dl>
        </Card>
      );
    }
    case "aviso":
      return (
        <Card className="p-4">
          <p className="text-sm text-muted">{p.texto}</p>
        </Card>
      );
  }
}

function Stat({ label, value, className }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className="rounded-2xl bg-surface-2 px-3 py-2.5">
      <p className="text-[12px] text-muted">{label}</p>
      <p className={clsx("mt-0.5 whitespace-nowrap text-[17px] font-semibold", className)}>{value}</p>
    </div>
  );
}

function Row({ label, value, negative }: { label: string; value: ReactNode; negative?: boolean }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2.5 text-[15px]">
      <span className="min-w-0 truncate">{label}</span>
      <span className={clsx(negative && "text-danger")}>{value}</span>
    </li>
  );
}

const CATEGORY_LABEL: Record<string, string> = {
  geral: "Geral",
  preferencia: "Preferência",
  pessoa: "Pessoa",
  financas: "Finanças",
  casa: "Casa",
  saude: "Saúde",
  ministerio: "Igreja",
  agenda: "Agenda",
};

function CategoryChip({ value }: { value: string }) {
  return (
    <span className="shrink-0 rounded-full bg-accent-soft px-2.5 py-1 text-[12px] font-medium leading-none text-primary">
      {CATEGORY_LABEL[value] ?? "Geral"}
    </span>
  );
}

/** Cor de categoria só se for hexadecimal (vem do banco; nunca CSS arbitrário). */
export function safeColor(c: string | null) {
  return c && /^#[0-9a-f]{3,8}$/i.test(c) ? c : "var(--muted)";
}

function Confirm({
  id,
  title,
  status,
  erro,
  danger,
  doneText,
  onConfirm,
  onCancel,
  children,
}: {
  id: string;
  title: string;
  status: "pendente" | "salvando" | "criado" | "cancelado" | "erro";
  erro?: string;
  danger?: boolean;
  doneText: { criado: string; cancelado: string };
  onConfirm: (id: string) => void;
  onCancel: (id: string) => void;
  children: ReactNode;
}) {
  const open = status === "pendente" || status === "salvando";
  return (
    <Card className={clsx(open && "ring-2 ring-primary/40")} role="group" aria-label={title}>
      <Head icon={danger ? <Trash2 size={16} aria-hidden /> : <Check size={16} aria-hidden />} title={title} />
      {children}
      {open ? (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Button type="button" variant="ghost" className="min-h-11" disabled={status === "salvando"} onClick={() => onCancel(id)}>
            Cancelar
          </Button>
          <Button type="button" className="min-h-11" disabled={status === "salvando"} onClick={() => onConfirm(id)}>
            {status === "salvando" ? "Salvando…" : "Confirmar"}
          </Button>
        </div>
      ) : (
        <p role="status" className={clsx("mt-3 text-sm font-medium", status === "erro" ? "text-danger" : "text-muted")}>
          {status === "erro" ? (erro ?? "Não foi possível concluir.") : status === "criado" ? doneText.criado : doneText.cancelado}
        </p>
      )}
    </Card>
  );
}
