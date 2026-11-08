import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** true só no navegador que expõe WebAuthn (`window.PublicKeyCredential`); false no servidor. */
export function useWebAuthnSupport() {
  return useSyncExternalStore(
    subscribe,
    () => "PublicKeyCredential" in window,
    () => false,
  );
}
