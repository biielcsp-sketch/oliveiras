"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { ChevronDown, Mic, SendHorizontal, Square } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { clearPanels, pushPanel, type OliPanel } from "@/lib/oli/panels";
import { clearOliHistory } from "@/app/(app)/inicio/oli-history-actions";
import { confirmOliAlteracao, confirmOliConsulta, confirmOliEsquecer, confirmOliEvento, confirmOliLancamento, confirmOliMemoria, runOliTool } from "@/app/(app)/inicio/oli-actions";
import { confirmOliArquivoFinancas, readOliFile } from "@/app/(app)/inicio/oli-arquivo-actions";
import { saveCard, saveExam, saveMedication, saveProcedure, saveVaccine } from "@/app/(app)/saude/actions";
import { saveCasaDocument } from "@/app/(app)/casa/documentos-actions";
import { savePetHealth } from "@/app/(app)/casa/pet-actions";
import { documentoLidoText, formFieldsFor, OLI_FILE_KEEPS_FILE, type OliFileDest } from "@/lib/oli/arquivo";
import { OliSphere, type OliSphereState as OliState } from "./oli-sphere";
import { OliPanels } from "./oli-panels";
import { OliAddFile } from "./oli-arquivo";
import { useOliSession, type LogEntry, type ToolCall } from "./use-oli-session";
import { ALTERAR_STATUS } from "@/lib/oli/alterar";

const LABELS: Record<OliState, string> = { idle: "Repouso", listen: "Ouvindo", think: "Pensando", speak: "Falando" };

type Pending = { resolve: (out: Record<string, unknown>) => void };

type SaveState = { ok?: boolean; error?: string; message?: string } | null;
/** Destinos do "+" que gravam pelas server actions dos próprios módulos (mesma validação dos formulários). */
const MODULE_SAVE: Record<Exclude<OliFileDest, "financas" | "nenhum">, (prev: null, form: FormData) => Promise<SaveState>> = {
  saude_exame: saveExam,
  saude_vacina: saveVaccine,
  saude_procedimento: saveProcedure,
  saude_carteirinha: saveCard,
  saude_medicamento: saveMedication,
  casa_documento: saveCasaDocument,
  pet_saude: savePetHealth,
};

export function OliHome({ initialLog = [] }: { initialLog?: LogEntry[] }) {
  // Volume da fala vai direto para uma variável CSS (sem re-renderizar a cada quadro).
  const levelRef = useRef<HTMLSpanElement>(null);
  const [panels, setPanels] = useState<OliPanel[]>([]);
  const [text, setText] = useState("");
  const [showLog, setShowLog] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const router = useRouter();
  const [reading, setReading] = useState(false);
  const pending = useRef(new Map<string, Pending>());
  // Arquivos escolhidos no "+", só na memória da tela, até Confirmar ou Cancelar.
  const files = useRef(new Map<string, File>());
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
        case "documentos_recentes":
          add({ id, kind: "documentos", data: res.data });
          return res.data;
        case "ler_documento":
          add({ id, kind: "documento", data: res.data });
          return res.data;
        case "consultar_financas":
        case "consultar_saude":
        case "consultar_casa":
        case "consultar_pet":
        case "consultar_igreja":
        case "buscar_no_app":
          add({ id, kind: "consulta", data: res.data });
          return res.data;
        case "ler_arquivo":
          add({ id, kind: "arquivo_lido", data: res.data });
          // Ao modelo, o conteúdo vai só dentro de <documento_lido> (dado, nunca instrução).
          return { arquivo: res.data.arquivo, documento_lido: res.data.documento_lido };
        case "criar_evento":
          return new Promise((resolve) => {
            pending.current.set(id, { resolve });
            add({ id, kind: "confirmar_evento", data: res.data, status: "pendente" });
          });
        case "alterar_casa":
        case "alterar_pet":
        case "alterar_igreja":
        case "alterar_saude":
        case "alterar_agenda":
        case "alterar_financas":
          return new Promise((resolve) => {
            pending.current.set(id, { resolve });
            add({ id, kind: "confirmar_alteracao", data: res.data, status: "pendente" });
          });
        case "criar_consulta":
          return new Promise((resolve) => {
            pending.current.set(id, { resolve });
            add({ id, kind: "confirmar_consulta", data: res.data, status: "pendente" });
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
      if (!p || !("status" in p) || p.status !== "pendente" || p.kind === "confirmar_arquivo") return;
      patch(id, { status: "salvando" });
      if (p.kind === "confirmar_alteracao") {
        const c = await confirmOliAlteracao(p.data).catch(() => ({ ok: false as const, erro: "Não foi possível salvar agora." }));
        if (c.ok) {
          patch(id, { status: "criado", aviso: c.aviso });
          settle(id, { status: ALTERAR_STATUS[p.data.acao], aviso: c.aviso });
        } else {
          patch(id, { status: "erro", erro: c.erro });
          settle(id, { status: "erro", erro: c.erro });
        }
        return;
      }
      if (p.kind === "confirmar_consulta") {
        const c = await confirmOliConsulta(p.data);
        if (c.ok) {
          patch(id, { status: "criado" });
          settle(id, {
            status: "criado",
            gravado_em: "Saúde",
            agenda: c.agenda,
            aviso: c.agenda === "falhou" ? "Consulta gravada em Saúde, mas não foi possível colocar na Agenda agora." : undefined,
          });
        } else {
          patch(id, { status: "erro", erro: c.erro });
          settle(id, { status: "erro", erro: c.erro });
        }
        return;
      }
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
      files.current.delete(id);
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
    const lvl = s === "speak" || s === "listen" ? Math.max(0, Math.min(1, level)) : 0;
    levelRef.current?.style.setProperty("--lvl", lvl.toFixed(3));
  }, []);

  const oli = useOliSession({ onTool, onFrame, onEnd, initialLog });
  const { sendContext } = oli;

  /** "+": lê o arquivo no servidor (nada é gravado) e mostra o painel; com conversa ativa, o Oli comenta. */
  const onFile = useCallback(
    async (file: File) => {
      const id = `p${++seq.current}`;
      setReading(true);
      const fd = new FormData();
      fd.append("file", file);
      const res = await readOliFile(fd).catch(() => ({ ok: false as const, erro: "Não consegui ler o arquivo agora. Tente de novo." }));
      setReading(false);
      if (!res.ok) {
        add({ id, kind: "aviso", texto: res.erro });
        return;
      }
      files.current.set(id, file);
      add({
        id,
        kind: "confirmar_arquivo",
        data: { leitura: res.leitura, destino: res.destino, opcoes: res.opcoes, nome_arquivo: file.name.slice(0, 80) },
        status: "pendente",
      });
      sendContext(documentoLidoText(res.leitura, res.destino));
    },
    [add, sendContext],
  );

  /** Confirmar do arquivo: grava no destino escolhido, com o arquivo, pela action do módulo. */
  const onConfirmArquivo = useCallback(
    async (id: string, dest: OliFileDest, values: Record<string, string>) => {
      const p = panelsRef.current.find((x) => x.id === id);
      if (!p || p.kind !== "confirmar_arquivo" || p.status !== "pendente" || dest === "nenhum") return;
      const file = files.current.get(id);
      if (!file) {
        patch(id, { status: "erro", erro: "O arquivo não está mais na tela. Envie de novo pelo +." });
        return;
      }
      patch(id, { status: "salvando" });
      const fd = new FormData();
      for (const [k, v] of Object.entries(formFieldsFor(dest, values))) fd.append(k, v);
      if (OLI_FILE_KEEPS_FILE[dest]) fd.append("file", file);
      try {
        if (dest === "financas") {
          fd.append("leitura", JSON.stringify(p.data.leitura));
          const r = await confirmOliArquivoFinancas(fd);
          if (!r.ok) {
            patch(id, { status: "pendente", erro: r.erro });
            return;
          }
          files.current.delete(id);
          patch(id, { status: "criado", erro: undefined });
          router.push(r.url);
          return;
        }
        const r = await MODULE_SAVE[dest](null, fd);
        if (r?.ok) {
          files.current.delete(id);
          patch(id, { status: "criado", erro: undefined });
        } else {
          // Volta a pendente com o erro à vista: a pessoa corrige o campo e confirma de novo.
          patch(id, { status: "pendente", erro: r?.error ?? "Não foi possível salvar." });
        }
      } catch {
        patch(id, { status: "pendente", erro: "Não foi possível salvar. Tente de novo." });
      }
    },
    [patch, router],
  );

  const clearHistory = async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    setConfirmClear(false);
    const r = await clearOliHistory().catch(() => ({ ok: false }));
    if (r.ok) oli.clearLog();
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setText("");
    void oli.sendText(t.slice(0, 1000));
  };

  return (
    <section aria-label="Oli, assistente da família" className="flex flex-col gap-4">
      {/* Esfera solta, centralizada sobre o fundo da página; o estado fica logo abaixo, discreto e sem caixa. */}
      <div className="oli-stage" data-testid="oli-stage">
        <span ref={levelRef} className="oli-level">
          <OliSphere size={200} state={oli.state} label="Oli, o assistente da família" />
        </span>
        <span className="text-[12.5px] font-medium tracking-wide text-muted" data-testid="oli-estado">
          {LABELS[oli.state]}
        </span>
      </div>

      <p
        role="status"
        className={clsx(
          "-mt-1 min-h-5 text-center text-sm",
          oli.status.tone === "err" ? "text-danger" : oli.status.tone === "ok" ? "text-primary" : "text-muted",
        )}
      >
        {oli.status.text}
      </p>

      <Button
        type="button"
        onClick={() => (oli.active ? oli.stop() : void oli.start())}
        disabled={oli.busy}
        variant={oli.active ? "ghost" : "primary"}
        className="self-center"
        aria-pressed={oli.active}
      >
        {oli.active ? <Square size={16} aria-hidden /> : <Mic size={18} aria-hidden />}
        {oli.active ? "Encerrar conversa" : oli.busy ? "Conectando…" : "Conversar"}
      </Button>

      <div className="flex gap-2">
        <OliAddFile busy={reading} onFile={(f) => void onFile(f)} />
        <form onSubmit={submit} className="flex min-w-0 flex-1 gap-2">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Ou digite aqui"
            aria-label="Mensagem para o Oli"
            maxLength={1000}
            autoComplete="off"
            enterKeyHint="send"
            className="rounded-full px-4"
          />
          <Button type="submit" aria-label="Enviar" size="icon" disabled={!text.trim() || oli.busy}>
            <SendHorizontal size={20} aria-hidden />
          </Button>
        </form>
      </div>
      {reading && (
        <p role="status" className="-mt-3 text-center text-sm text-muted">
          Lendo o arquivo…
        </p>
      )}

      <OliPanels
        panels={panels}
        onConfirm={onConfirm}
        onConfirmArquivo={(id, dest, values) => void onConfirmArquivo(id, dest, values)}
        onCancel={onCancel}
        onClear={() => update(clearPanels)}
      />

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
          <div id="oli-conversa" className="mt-2 flex max-h-72 flex-col gap-2 overflow-y-auto rounded-[20px] border border-line bg-surface-solid/90 p-4">
            {oli.log.length === 0 ? (
              <p className="text-sm text-muted">As falas aparecem aqui.</p>
            ) : (
              oli.log.map((e) => (
                <p
                  key={e.id}
                  className={clsx(
                    "max-w-[90%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-[15px] leading-snug",
                    e.role === "user" && "self-end bg-accent-soft text-ink",
                    e.role === "model" && "self-start bg-surface-2",
                    e.role === "sys" && "self-center px-0 text-[12px] text-muted",
                  )}
                >
                  {e.text}
                </p>
              ))
            )}
            {oli.log.length > 0 && (
              <button
                type="button"
                onClick={() => void clearHistory()}
                onBlur={() => setConfirmClear(false)}
                className="mt-1 min-h-11 self-center rounded-full px-3 text-[14px] font-medium text-danger"
              >
                {confirmClear ? "Toque de novo para apagar" : "Limpar conversa"}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
