"use client";

import { useCallback, useRef, useState } from "react";
import clsx from "clsx";
import { ChevronDown, Mic, SendHorizontal, Square } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { clearPanels, pushPanel, type OliPanel } from "@/lib/oli/panels";
import { confirmOliEsquecer, confirmOliEvento, confirmOliLancamento, confirmOliMemoria, runOliTool } from "@/app/(app)/inicio/oli-actions";
import type { Oli3D, OliState } from "./oli3d";
import { OliStage } from "./oli-stage";
import { OliPanels } from "./oli-panels";
import { useOliSession, type ToolCall } from "./use-oli-session";

const LABELS: Record<OliState, string> = { idle: "Repouso", listen: "Ouvindo", think: "Pensando", speak: "Falando" };

type Pending = { resolve: (out: Record<string, unknown>) => void };

export function OliHome() {
  const avatar = useRef<Oli3D | null>(null);
  const [panels, setPanels] = useState<OliPanel[]>([]);
  const [text, setText] = useState("");
  const [showLog, setShowLog] = useState(false);
  const pending = useRef(new Map<string, Pending>());
  const seq = useRef(0);
  const panelsRef = useRef<OliPanel[]>([]);

  const update = useCallback((fn: (l: OliPanel[]) => OliPanel[]) => {
    setPanels((l) => {
      const next = fn(l);
      panelsRef.current = next;
      return next;
    });
  }, []);
  const add = useCallback((p: OliPanel) => update((l) => pushPanel(l, p)), [update]);
  const patch = useCallback(
    (id: string, changes: Partial<Extract<OliPanel, { status: unknown }>>) =>
      update((l) => l.map((p) => (p.id === id && "status" in p ? ({ ...p, ...changes } as OliPanel) : p))),
    [update],
  );

  /** Executa a ferramenta no servidor (sessão do usuário) e mostra o painel. */
  const onTool = useCallback(
    async ({ name, args }: ToolCall): Promise<Record<string, unknown>> => {
      const id = `p${++seq.current}`;
      const res = await runOliTool(String(name ?? ""), args ?? {});
      if (!res.ok) {
        add({ id, kind: "aviso", texto: res.erro });
        return { erro: res.erro };
      }
      switch (res.tool) {
        case "resumo_do_mes":
          add({ id, kind: "resumo", data: res.data });
          return res.data;
        case "saldo_das_contas":
          add({ id, kind: "saldos", data: res.data });
          return res.data;
        case "contas_a_pagar":
          add({ id, kind: "contas", data: res.data });
          return res.data;
        case "ultimos_lancamentos":
          add({ id, kind: "lancamentos", data: res.data });
          return res.data;
        case "consultar_memoria":
          add({ id, kind: "memorias", data: res.data });
          return res.data;
        case "agenda_periodo":
          add({ id, kind: "eventos", data: res.data });
          return res.data;
        case "criar_evento":
          return new Promise((resolve) => {
            pending.current.set(id, { resolve });
            add({ id, kind: "confirmar_evento", data: res.data, status: "pendente" });
          });
        case "criar_lancamento":
        case "esquecer_memoria":
        case "salvar_memoria":
          // Escrita: só com o toque do usuário. A resposta ao modelo espera a decisão.
          return new Promise((resolve) => {
            pending.current.set(id, { resolve });
            add(
              res.tool === "criar_lancamento"
                ? { id, kind: "confirmar_lancamento", data: res.data, status: "pendente" }
                : res.tool === "salvar_memoria"
                  ? { id, kind: "confirmar_memoria", data: res.data, status: "pendente" }
                  : { id, kind: "confirmar_esquecer", data: res.data, status: "pendente" },
            );
          });
      }
    },
    [add],
  );

  const settle = useCallback((id: string, out: Record<string, unknown>) => {
    pending.current.get(id)?.resolve(out);
    pending.current.delete(id);
  }, []);

  const onConfirm = useCallback(
    async (id: string) => {
      const p = panelsRef.current.find((x) => x.id === id);
      if (!p || !("status" in p) || p.status !== "pendente") return;
      patch(id, { status: "salvando" });
      const r =
        p.kind === "confirmar_lancamento"
          ? await confirmOliLancamento(p.data)
          : p.kind === "confirmar_memoria"
            ? await confirmOliMemoria(p.data)
            : p.kind === "confirmar_evento"
              ? await confirmOliEvento(p.data)
              : await confirmOliEsquecer(p.data.id);
      if (r.ok) {
        patch(id, { status: "criado" });
        settle(id, { status: p.kind === "confirmar_esquecer" ? "apagada" : p.kind === "confirmar_memoria" ? "salva" : "criado" });
      } else {
        patch(id, { status: "erro", erro: r.erro });
        settle(id, { status: "erro", erro: r.erro });
      }
    },
    [patch, settle],
  );

  const onCancel = useCallback(
    (id: string) => {
      patch(id, { status: "cancelado" });
      settle(id, { status: "cancelado", motivo: "o usuário tocou em Cancelar" });
    },
    [patch, settle],
  );

  /** Sessão encerrada: confirmações abertas viram canceladas. */
  const onEnd = useCallback(() => {
    for (const id of [...pending.current.keys()]) {
      const p = panelsRef.current.find((x) => x.id === id);
      if (p && "status" in p && p.status !== "pendente") continue; // já salvando: termina sozinho
      patch(id, { status: "cancelado" });
      settle(id, { status: "cancelado" });
    }
  }, [patch, settle]);

  const onFrame = useCallback((s: OliState, level: number) => {
    avatar.current?.setState(s);
    avatar.current?.setLevel(level);
  }, []);

  const oli = useOliSession({ onTool, onFrame, onEnd });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setText("");
    void oli.sendText(t.slice(0, 1000));
  };

  return (
    <section aria-label="Oli, assistente da família" className="flex flex-col gap-5">
      <div className="-mx-5 md:mx-0">
        <OliStage apiRef={avatar} />
      </div>

      <div className="-mt-2 text-center">
        <p className="text-xl font-semibold tracking-tight" data-testid="oli-estado">
          {LABELS[oli.state]}
        </p>
        <p
          role="status"
          className={clsx(
            "mt-0.5 min-h-5 text-sm",
            oli.status.tone === "err" ? "text-danger" : oli.status.tone === "ok" ? "text-primary" : "text-muted",
          )}
        >
          {oli.status.text}
        </p>
      </div>

      <Button
        type="button"
        onClick={() => (oli.active ? oli.stop() : void oli.start())}
        disabled={oli.busy}
        variant={oli.active ? "ghost" : "primary"}
        className="h-14 w-full text-base"
        aria-pressed={oli.active}
      >
        {oli.active ? <Square size={20} aria-hidden /> : <Mic size={22} aria-hidden />}
        {oli.active ? "Encerrar conversa" : oli.busy ? "Conectando…" : "Conversar"}
      </Button>

      <form onSubmit={submit} className="flex gap-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ou digite aqui"
          aria-label="Mensagem para o Oli"
          maxLength={1000}
          autoComplete="off"
          enterKeyHint="send"
        />
        <Button type="submit" aria-label="Enviar" className="w-12 shrink-0 px-0" disabled={!text.trim() || oli.busy}>
          <SendHorizontal size={20} aria-hidden />
        </Button>
      </form>

      <OliPanels panels={panels} onConfirm={onConfirm} onCancel={onCancel} onClear={() => update(clearPanels)} />

      <div>
        <button
          type="button"
          onClick={() => setShowLog((v) => !v)}
          aria-expanded={showLog}
          aria-controls="oli-conversa"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-1 text-[15px] font-medium text-link"
        >
          {showLog ? "Ocultar conversa" : "Ver conversa"}
          <ChevronDown size={18} aria-hidden className={clsx("transition", showLog && "rotate-180")} />
        </button>
        {showLog && (
          <div id="oli-conversa" className="glass mt-2 flex max-h-72 flex-col gap-2 overflow-y-auto rounded-[24px] border border-line/70 p-4">
            {oli.log.length === 0 ? (
              <p className="text-sm text-muted">As falas aparecem aqui.</p>
            ) : (
              oli.log.map((e) => (
                <p
                  key={e.id}
                  className={clsx(
                    "max-w-[90%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-[15px] leading-snug",
                    e.role === "user" && "self-end bg-accent-soft",
                    e.role === "model" && "self-start bg-surface-2",
                    e.role === "sys" && "self-center px-0 text-[12px] text-muted",
                  )}
                >
                  {e.text}
                </p>
              ))
            )}
          </div>
        )}
      </div>
    </section>
  );
}
