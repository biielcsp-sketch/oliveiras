"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveServerMessage, Session } from "@google/genai";
import {
  base64ToFloat32,
  createDownsampler,
  floatsToInt16,
  IN_RATE,
  int16ToBase64,
  OUT_RATE,
  rms,
} from "@/lib/oli/audio-utils";
import { saveOliMessages } from "@/app/(app)/inicio/oli-history-actions";
import type { OliState } from "./oli3d";

/**
 * Sessão de voz/texto do Oli com o Gemini Live (porta do protótipo aprovado).
 * - Token efêmero vem de POST /api/oli/token (sessão do app; a chave do Gemini fica no servidor).
 * - Microfone: AudioWorklet estático /oli/pcm-capture.js → 16 kHz PCM.
 * - Saída: 24 kHz em fila; AnalyserNode mede o volume para animar o avatar.
 * - Sessões longas: guarda o handle de sessionResumption e reconecta no goAway/queda.
 */

export type LogEntry = { id: number | string; role: "user" | "model" | "sys"; text: string };
export type StatusTone = "" | "ok" | "err";
export type ToolCall = { id?: string; name?: string; args?: Record<string, unknown> };
export type ToolHandler = (call: ToolCall) => Promise<Record<string, unknown>>;

const SAMPLES_PER_CHUNK = 640; // ~40 ms a 16 kHz
const MAX_RECONNECTS = 3;
const IDLE_STATUS = "Toque em Conversar para falar com o Oli";

type TokenInfo = { token: string; model: string; apiVersion: string };

async function fetchToken(): Promise<TokenInfo> {
  const r = await fetch("/api/oli/token", { method: "POST", cache: "no-store" });
  const body = (await r.json().catch(() => ({}))) as Partial<TokenInfo> & { error?: string };
  if (!r.ok || !body.token || !body.model) throw new Error(body.error || `Erro ${r.status}`);
  return { token: body.token, model: body.model, apiVersion: body.apiVersion || "v1beta" };
}

export function useOliSession(opts: {
  onTool: ToolHandler;
  onFrame?: (state: OliState, level: number) => void;
  onEnd?: () => void;
  /** Histórico salvo da pessoa (cronológico), para a aba "Ver conversa" já abrir preenchida. */
  initialLog?: LogEntry[];
}) {
  const [state, setState] = useState<OliState>("idle");
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatusState] = useState<{ text: string; tone: StatusTone }>({ text: IDLE_STATUS, tone: "" });
  const [log, setLog] = useState<LogEntry[]>(() => opts.initialLog ?? []);

  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  // Estado mutável da sessão (fora do React para o laço de áudio).
  const r = useRef({
    session: null as Session | null,
    ctx: null as AudioContext | null,
    stream: null as MediaStream | null,
    worklet: null as AudioWorkletNode | null,
    src: null as MediaStreamAudioSourceNode | null,
    analyser: null as AnalyserNode | null,
    playing: new Set<AudioBufferSourceNode>(),
    playTime: 0,
    connecting: false,
    awaiting: false,
    awaitingAt: 0,
    lastVoice: 0,
    micRaw: 0,
    level: 0,
    state: "idle" as OliState,
    token: null as TokenInfo | null,
    handle: null as string | null,
    reconnects: 0,
    generation: 0, // muda a cada conexão: callbacks de sessões antigas são ignorados
    userStopped: true,
    openBubble: { user: null as number | string | null, model: null as number | string | null },
    // Texto do turno em andamento, acumulado e enviado ao servidor uma vez só (turnComplete/encerramento).
    turnText: { user: "", model: "" },
    nextId: 1,
    raf: 0,
  });

  const setStatus = useCallback((text: string, tone: StatusTone = "") => setStatusState({ text, tone }), []);

  const pushLog = useCallback((role: LogEntry["role"], text: string) => {
    const id = r.current.nextId++;
    setLog((l) => [...l.slice(-80), { id, role, text }]);
    return id;
  }, []);

  /** Grava no servidor o turno concluído. Fire-and-forget: erro é silencioso e nunca trava o áudio. */
  // Limite conhecido: no teardown/desmonte a server action pode ser abortada pelo navegador (melhor esforço).
  // Por isso a fala do usuário já é gravada quando a transcrição dele termina (começo da resposta).
  const flushTurn = useCallback((only?: "user") => {
    const s = r.current;
    const batch: { role: "user" | "model"; text: string }[] = [];
    if (s.turnText.user.trim()) batch.push({ role: "user", text: s.turnText.user });
    s.turnText.user = "";
    if (!only) {
      if (s.turnText.model.trim()) batch.push({ role: "model", text: s.turnText.model });
      s.turnText.model = "";
    }
    if (batch.length === 0) return;
    try {
      void saveOliMessages(batch).catch(() => {});
    } catch {}
  }, []);

  const appendLog = useCallback(
    (role: "user" | "model", text: string) => {
      const s = r.current;
      s.turnText[role] += text;
      const open = s.openBubble[role];
      if (open === null) {
        s.openBubble[role] = pushLog(role, text);
      } else {
        setLog((l) => l.map((e) => (e.id === open ? { ...e, text: e.text + text } : e)));
      }
    },
    [pushLog],
  );

  /* ---------- reprodução ---------- */
  const stopPlayback = useCallback(() => {
    const s = r.current;
    for (const n of s.playing) {
      try {
        n.stop();
      } catch {}
    }
    s.playing.clear();
    s.playTime = 0;
  }, []);

  const enqueue = useCallback((b64: string) => {
    const s = r.current;
    if (!s.ctx || !s.analyser) return;
    const f32 = base64ToFloat32(b64);
    if (!f32.length) return;
    s.awaiting = false;
    const buf = s.ctx.createBuffer(1, f32.length, OUT_RATE);
    buf.copyToChannel(f32, 0);
    const node = s.ctx.createBufferSource();
    node.buffer = buf;
    node.connect(s.analyser);
    s.playTime = Math.max(s.ctx.currentTime + 0.02, s.playTime);
    node.start(s.playTime);
    s.playTime += buf.duration;
    s.playing.add(node);
    node.onended = () => s.playing.delete(node);
  }, []);

  /* ---------- encerramento ---------- */
  const teardown = useCallback(
    (message?: { text: string; tone: StatusTone }) => {
      const s = r.current;
      s.generation++;
      s.userStopped = true;
      const sess = s.session;
      s.session = null;
      s.connecting = false;
      try {
        sess?.close();
      } catch {}
      try {
        s.worklet?.disconnect();
        s.src?.disconnect();
      } catch {}
      s.stream?.getTracks().forEach((t) => t.stop());
      stopPlayback();
      s.ctx?.close().catch(() => {});
      s.ctx = s.stream = s.worklet = s.src = s.analyser = null;
      s.micRaw = 0;
      s.awaiting = false;
      s.token = null;
      s.handle = null;
      s.reconnects = 0;
      s.openBubble = { user: null, model: null };
      flushTurn();
      setActive(false);
      setBusy(false);
      setStatusState(message ?? { text: IDLE_STATUS, tone: "" });
      optsRef.current.onEnd?.();
    },
    [flushTurn, stopPlayback],
  );

  /* ---------- conexão (com retomada) ---------- */
  // Referências estáveis: conectar ↔ mensagens ↔ reconectar se chamam em ciclo.
  const onMessageRef = useRef<(m: LiveServerMessage) => Promise<void>>(async () => {});
  const reconnectRef = useRef<() => Promise<void>>(async () => {});
  const connectRef = useRef(async (handle: string | null, fresh: boolean) => {
    const s = r.current;
    if (fresh || !s.token) s.token = await fetchToken();
    const { GoogleGenAI, Modality } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey: s.token.token, httpOptions: { apiVersion: s.token.apiVersion } });
    const gen = ++s.generation;
    const old = s.session;
    s.session = null;
    try {
      old?.close();
    } catch {}
    const session = await ai.live.connect({
      model: s.token.model,
      config: {
        responseModalities: [Modality.AUDIO],
        sessionResumption: handle ? { handle } : {},
      },
      callbacks: {
        onmessage: (msg: LiveServerMessage) => {
          if (gen !== r.current.generation) return;
          onMessageRef.current(msg).catch(() =>
            setStatusState({ text: "Erro ao processar a resposta.", tone: "err" }),
          );
        },
        onerror: () => {
          if (gen !== r.current.generation) return;
          setStatusState({ text: "Erro de conexão.", tone: "err" });
        },
        onclose: () => {
          if (gen !== r.current.generation || r.current.userStopped) return;
          // Caiu sem pedido do usuário (limite de tempo, rede): tenta retomar.
          void reconnectRef.current();
        },
      },
    });
    if (gen !== s.generation) {
      session.close();
      return;
    }
    s.session = session;
  });

  const reconnect = useCallback(async () => {
    const s = r.current;
    if (s.userStopped) return;
    if (!s.handle || s.reconnects >= MAX_RECONNECTS) {
      teardown({ text: "Conversa encerrada. Toque em Conversar para continuar.", tone: "err" });
      return;
    }
    s.reconnects++;
    s.connecting = true;
    setStatus("Reconectando…");
    try {
      // O mesmo token vale para retomar dentro do prazo; se recusar, pede outro.
      try {
        await connectRef.current(s.handle, false);
      } catch {
        await connectRef.current(s.handle, true);
      }
      s.connecting = false;
      setStatus("Pode falar", "ok");
    } catch {
      teardown({ text: "Conversa encerrada. Toque em Conversar para continuar.", tone: "err" });
    }
  }, [setStatus, teardown]);

  const onMessage = useCallback(
    async (m: LiveServerMessage) => {
      const s = r.current;
      if (m.sessionResumptionUpdate?.resumable && m.sessionResumptionUpdate.newHandle) {
        s.handle = m.sessionResumptionUpdate.newHandle;
        s.reconnects = 0;
      }
      if (m.goAway) {
        // O servidor vai fechar (limite de duração): reconecta já com o handle.
        void reconnect();
        return;
      }
      const sc = m.serverContent;
      if (sc) {
        if (sc.interrupted) {
          stopPlayback();
          s.awaiting = false;
        }
        // A resposta começou: a transcrição do usuário está completa.
        if (sc.outputTranscription?.text || sc.modelTurn?.parts?.length) flushTurn("user");
        for (const p of sc.modelTurn?.parts ?? []) if (p.inlineData?.data) enqueue(p.inlineData.data);
        if (sc.inputTranscription?.text) {
          appendLog("user", sc.inputTranscription.text);
          s.awaiting = true;
          s.awaitingAt = performance.now();
        }
        if (sc.outputTranscription?.text) appendLog("model", sc.outputTranscription.text);
        if (sc.turnComplete) {
          s.openBubble = { user: null, model: null };
          flushTurn();
          s.awaiting = false;
        }
      }
      if (m.toolCall?.functionCalls?.length) {
        flushTurn("user");
        s.awaiting = true;
        s.awaitingAt = performance.now();
        const functionResponses = await Promise.all(
          m.toolCall.functionCalls.map(async (fc) => {
            let output: Record<string, unknown>;
            try {
              output = await optsRef.current.onTool({ id: fc.id, name: fc.name, args: fc.args });
            } catch {
              output = { erro: "Falha ao executar a ferramenta." };
            }
            return { id: fc.id, name: fc.name, response: { output } };
          }),
        );
        // A sessão pode ter sido retomada enquanto o usuário confirmava: responde na atual.
        try {
          s.session?.sendToolResponse({ functionResponses });
        } catch {}
      }
    },
    [appendLog, enqueue, flushTurn, reconnect, stopPlayback],
  );

  useEffect(() => {
    onMessageRef.current = onMessage;
    reconnectRef.current = reconnect;
  });

  /* ---------- microfone ---------- */
  const startMic = useCallback(async () => {
    const s = r.current;
    if (!s.ctx || !s.stream) return;
    await s.ctx.audioWorklet.addModule("/oli/pcm-capture.js");
    s.src = s.ctx.createMediaStreamSource(s.stream);
    s.worklet = new AudioWorkletNode(s.ctx, "pcm-capture");
    const down = createDownsampler(s.ctx.sampleRate, IN_RATE);
    let pending: number[] = [];
    s.worklet.port.onmessage = (e: MessageEvent<Float32Array>) => {
      if (!s.session) return;
      const d = e.data;
      s.micRaw = rms(d);
      if (s.micRaw > 0.02) s.lastVoice = performance.now();
      pending = pending.concat(down(d));
      if (pending.length >= SAMPLES_PER_CHUNK) {
        const data = int16ToBase64(floatsToInt16(pending));
        pending = [];
        try {
          s.session.sendRealtimeInput({ audio: { data, mimeType: `audio/pcm;rate=${IN_RATE}` } });
        } catch {}
      }
    };
    s.src.connect(s.worklet); // não vai para a saída: sem eco do próprio microfone
  }, []);

  /* ---------- ciclo de vida ---------- */
  const start = useCallback(async () => {
    const s = r.current;
    if (s.session || s.connecting) return;
    s.connecting = true;
    s.userStopped = false;
    setBusy(true);
    setStatus("Conectando…");
    // Áudio e microfone primeiro, ainda dentro do toque do usuário (exigência do iOS).
    try {
      s.ctx = new AudioContext();
      await s.ctx.resume();
      s.analyser = s.ctx.createAnalyser();
      s.analyser.fftSize = 512;
      s.analyser.connect(s.ctx.destination);
      let micOk = true;
      try {
        s.stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
        });
      } catch {
        micOk = false; // sem permissão: segue só com texto
      }
      await connectRef.current(null, true);
      if (micOk) await startMic();
      s.connecting = false;
      setActive(true);
      setBusy(false);
      setStatus(micOk ? "Pode falar" : "Sem microfone: digite sua mensagem", micOk ? "ok" : "err");
      return true;
    } catch (e) {
      teardown({ text: e instanceof Error ? e.message : "Não foi possível conectar.", tone: "err" });
      return false;
    }
  }, [setStatus, startMic, teardown]);

  const stop = useCallback(() => teardown(), [teardown]);

  const sendText = useCallback(
    async (text: string) => {
      const s = r.current;
      if (!s.session) {
        const ok = await start();
        if (!ok || !r.current.session) return;
      }
      s.openBubble = { user: null, model: null };
      flushTurn(); // fala anterior ainda aberta vai antes da digitada
      s.turnText.user = text;
      pushLog("user", text);
      s.awaiting = true;
      s.awaitingAt = performance.now();
      s.lastVoice = 0;
      try {
        r.current.session?.sendRealtimeInput({ text });
      } catch {
        setStatus("Não consegui enviar.", "err");
      }
    },
    [flushTurn, pushLog, setStatus, start],
  );

  /* ---------- laço: estado e nível para o avatar ---------- */
  useEffect(() => {
    const s = r.current;
    const buf = new Float32Array(512);
    const frame = (now: number) => {
      let outRms = 0;
      if (s.analyser) {
        s.analyser.getFloatTimeDomainData(buf);
        outRms = rms(buf);
      }
      let next: OliState;
      if (s.connecting) next = "think";
      else if (!s.session) next = "idle";
      else if (s.playing.size > 0 || outRms > 0.01) next = "speak";
      else {
        if (s.awaiting && now - s.awaitingAt > 15000) s.awaiting = false;
        next = s.awaiting && now - s.lastVoice > 700 ? "think" : "listen";
      }
      if (next !== s.state) {
        s.state = next;
        setState(next);
      }
      const target = next === "listen" ? Math.min(1, s.micRaw * 9) : next === "speak" ? Math.min(1, outRms * 6) : 0;
      s.level += (target - s.level) * 0.25;
      optsRef.current.onFrame?.(next, s.level);
      s.raf = requestAnimationFrame(frame);
    };
    s.raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(s.raf);
  }, []);

  // Sai da tela: encerra a sessão (libera microfone e conexão).
  useEffect(() => () => teardown(), [teardown]);

  /** "Limpar conversa": zera o log local e o turno ainda não enviado. */
  const clearLog = useCallback(() => {
    const s = r.current;
    s.turnText = { user: "", model: "" };
    s.openBubble = { user: null, model: null };
    setLog([]);
  }, []);

  return { state, active, busy, status, log, start, stop, sendText, pushLog, clearLog };
}
