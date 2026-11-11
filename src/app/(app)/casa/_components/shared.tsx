"use client";

import { useEffect, useRef, useState } from "react";
import { FormError } from "@/components/ui";

export { ConfirmDelete } from "../../saude/_components/shared";

export type Person = { id: string; name: string };
type R = { ok: boolean; erro?: string };

/** Estado comum das telas: aviso de sucesso, erro e "pendente" enquanto uma action roda. */
export function useRunner() {
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function run<T extends R>(fn: () => Promise<T>, done?: string | ((r: T) => string | null)): Promise<T> {
    setPending(true);
    try {
      const r = await fn();
      setError(r.ok ? null : (r.erro ?? "Não foi possível atualizar."));
      setNotice(r.ok ? (typeof done === "function" ? done(r) : (done ?? null)) : null);
      return r;
    } catch {
      // Falha de rede/servidor: avisa e nunca deixa os botões presos em "pendente".
      setError("Não foi possível falar com o servidor. Tente de novo.");
      setNotice(null);
      return { ok: false, erro: "Não foi possível falar com o servidor." } as T;
    } finally {
      setPending(false);
    }
  }
  return { notice, setNotice, error, pending, run };
}

export function Feedback({ notice, error }: { notice: string | null; error: string | null }) {
  return (
    <>
      {notice && (
        <p role="status" className="-mt-2 text-sm text-primary">
          {notice}
        </p>
      )}
      <FormError message={error} />
    </>
  );
}

export const smallBtn = "h-11 px-3 text-sm";

/**
 * Chama `cb` uma vez por resposta de sucesso da action. Os callbacks vêm em closures novas a cada render:
 * sem o ref, o efeito rodaria de novo e um aviso antigo ("adicionado") apagaria o atual.
 */
export function useOnSaved(state: { ok?: boolean; message?: string } | null, cb: (msg?: string) => void) {
  const handled = useRef<typeof state>(null);
  const cbRef = useRef(cb);
  useEffect(() => {
    cbRef.current = cb;
  });
  useEffect(() => {
    if (!state?.ok || handled.current === state) return;
    handled.current = state;
    cbRef.current(state.message);
  }, [state]);
}
