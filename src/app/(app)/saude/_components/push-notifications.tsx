"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { Button, Card, FormError } from "@/components/ui";
import { describeActivationError, pushUiState, urlBase64ToUint8Array, type ActivationStep, type PushUi } from "@/lib/saude/push";
import { hasPushSubscription, removePushSubscription, savePushSubscription } from "../push-actions";

const VAPID_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () =>
  (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia("(display-mode: standalone)").matches;

/** Service worker já registrado (RegisterSW); não espera para sempre se não houver (ex.: modo de desenvolvimento). */
async function getRegistration() {
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), 5000))]);
  return reg;
}

async function localSubscription() {
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

const IOS_TEXT = "No iPhone, instale o app na tela inicial (Compartilhar → Adicionar à Tela de Início) e abra por lá para ativar os avisos";

export function PushNotifications() {
  const [ui, setUi] = useState<PushUi>("carregando");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    let subscribed = false;
    if (supported) {
      try {
        const sub = await localSubscription();
        // Inscrito neste aparelho E conhecido pelo servidor para esta pessoa (outra conta no mesmo aparelho não conta).
        subscribed = !!sub && (await hasPushSubscription(sub.endpoint));
      } catch {
        subscribed = false;
      }
    }
    setUi(
      pushUiState({
        hasKey: VAPID_KEY.length > 0,
        ios: isIos(),
        standalone: isStandalone(),
        supported,
        permission: "Notification" in window ? Notification.permission : "unsupported",
        subscribed,
      }),
    );
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lê o estado do navegador (só existe no cliente)
    void refresh();
  }, [refresh]);

  async function activate() {
    setBusy(true);
    setError(null);
    let step: ActivationStep = "permissao";
    try {
      // Pedido de permissão logo no clique (gesto do usuário).
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        await refresh();
        return;
      }
      step = "service-worker";
      const reg = await getRegistration();
      if (!reg) throw new Error("sem service worker");
      step = "servidor";
      const old = await reg.pushManager.getSubscription();
      if (old && !(await hasPushSubscription(old.endpoint))) await old.unsubscribe(); // era de outra conta: começa limpo
      step = "inscricao";
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_KEY) }));
      const json = sub.toJSON();
      step = "servidor";
      const saved = await savePushSubscription({ endpoint: sub.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth });
      if (!saved.ok) {
        await sub.unsubscribe().catch(() => {});
        setError(saved.erro ?? "Não foi possível ativar os avisos.");
      }
    } catch (err) {
      setError(describeActivationError(step, err));
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  async function deactivate() {
    setBusy(true);
    setError(null);
    try {
      const sub = await localSubscription();
      if (sub) {
        const r = await removePushSubscription(sub.endpoint);
        if (!r.ok) {
          setError(r.erro ?? "Não foi possível desativar os avisos.");
          return;
        }
        await sub.unsubscribe();
      }
    } catch {
      setError("Não foi possível desativar os avisos. Tente de novo.");
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  return (
    <Card data-testid="avisos-aparelho">
      <div className="flex items-start gap-3">
        <Bell size={20} aria-hidden className="mt-0.5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <h2 className="font-medium">Avisos neste aparelho</h2>
          {ui === "carregando" && <p className="mt-1 text-sm text-muted">Verificando…</p>}
          {ui === "indisponivel" && <p className="mt-1 text-sm text-muted">Avisos indisponíveis.</p>}
          {ui === "ios-instalar" && <p className="mt-1 text-sm text-muted">{IOS_TEXT}.</p>}
          {ui === "sem-suporte" && <p className="mt-1 text-sm text-muted">Este navegador não aceita avisos por notificação. Tente outro navegador.</p>}
          {ui === "negada" && (
            <p className="mt-1 text-sm text-muted">
              As notificações estão bloqueadas para este site. Para liberar, abra as configurações do navegador (ou do aparelho), procure as permissões do site, permita
              &quot;Notificações&quot; e volte aqui.
            </p>
          )}
          {ui === "inativo" && <p className="mt-1 text-sm text-muted">Avisos desativados neste aparelho. Ative para receber o lembrete dos medicamentos e das vacinas.</p>}
          {ui === "ativo" && (
            <p role="status" className="mt-1 text-sm text-primary">
              Avisos ativados neste aparelho.
            </p>
          )}
        </div>
      </div>
      {(ui === "inativo" || ui === "ativo") && (
        <div className="mt-3">
          <Button type="button" variant={ui === "ativo" ? "ghost" : undefined} disabled={busy} onClick={ui === "ativo" ? deactivate : activate}>
            {busy ? "Aguarde…" : ui === "ativo" ? "Desativar avisos" : "Ativar avisos"}
          </Button>
        </div>
      )}
      <FormError message={error} />
    </Card>
  );
}
