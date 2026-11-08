import { describe, expect, it } from "vitest";
import { INSTALL_DISMISS_MS, installPromptKind, isIosSafari, parseDismissedUntil, type InstallInput } from "@/lib/install-prompt";

const NOW = 1_800_000_000_000;
const base: InstallInput = {
  hasPromptEvent: false,
  iosSafari: false,
  standalone: false,
  installed: false,
  dismissedUntil: null,
  now: NOW,
};

const UA = {
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0.0.0 Mobile/15E148 Safari/604.1",
  iphoneInstagram:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 380.0.0",
  ipadOs:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15",
  android:
    "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36",
};

describe("pop-up Instalar o Oli: quando aparece", () => {
  it("Android/Chromium com beforeinstallprompt: android", () => {
    expect(installPromptKind({ ...base, hasPromptEvent: true })).toBe("android");
  });
  it("iPhone Safari sem o evento: ios", () => {
    expect(installPromptKind({ ...base, iosSafari: true })).toBe("ios");
  });
  it("nenhum dos dois: nada", () => {
    expect(installPromptKind(base)).toBeNull();
  });
  it("já instalado (standalone ou appinstalled): nada", () => {
    expect(installPromptKind({ ...base, hasPromptEvent: true, standalone: true })).toBeNull();
    expect(installPromptKind({ ...base, iosSafari: true, standalone: true })).toBeNull();
    expect(installPromptKind({ ...base, hasPromptEvent: true, installed: true })).toBeNull();
  });
  it("dispensado: some por 7 dias e volta depois", () => {
    const until = NOW + INSTALL_DISMISS_MS;
    expect(installPromptKind({ ...base, hasPromptEvent: true, dismissedUntil: until })).toBeNull();
    expect(installPromptKind({ ...base, iosSafari: true, dismissedUntil: until, now: until - 1 })).toBeNull();
    expect(installPromptKind({ ...base, iosSafari: true, dismissedUntil: until, now: until })).toBe("ios");
    expect(INSTALL_DISMISS_MS).toBe(604_800_000);
  });
});

describe("detecção do iPhone/iPad no Safari", () => {
  it("reconhece Safari no iPhone e no iPad (que se apresenta como Mac com toque)", () => {
    expect(isIosSafari(UA.iphoneSafari)).toBe(true);
    expect(isIosSafari(UA.ipadOs, 5)).toBe(true);
  });
  it("ignora Mac de verdade, Android, Chrome do iOS e navegador embutido", () => {
    expect(isIosSafari(UA.ipadOs, 0)).toBe(false);
    expect(isIosSafari(UA.android, 5)).toBe(false);
    expect(isIosSafari(UA.iphoneChrome)).toBe(false);
    expect(isIosSafari(UA.iphoneInstagram)).toBe(false);
  });
});

describe("valor guardado do 'dispensado até'", () => {
  it("aceita só número positivo", () => {
    expect(parseDismissedUntil(String(NOW))).toBe(NOW);
    expect(parseDismissedUntil(null)).toBeNull();
    expect(parseDismissedUntil("")).toBeNull();
    expect(parseDismissedUntil("abc")).toBeNull();
    expect(parseDismissedUntil("-5")).toBeNull();
    expect(parseDismissedUntil("Infinity")).toBeNull();
  });
});
