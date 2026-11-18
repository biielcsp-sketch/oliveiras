"use client";

import { useState, useTransition } from "react";
import { dismissPair, joinPair, linkTransfers, unlinkPair, type TransferActionState } from "../transfer-actions";
import { Button, FormError } from "@/components/ui";

function useRun() {
  const [pending, start] = useTransition();
  const [state, setState] = useState<TransferActionState>(null);
  const run = (fn: () => Promise<TransferActionState>) => start(async () => setState(await fn()));
  return { pending, state, run };
}

export function FindPairsButton() {
  const { pending, state, run } = useRun();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => run(linkTransfers)}>
        {pending ? "Procurando…" : "Procurar pares"}
      </Button>
      {state?.ok && (
        <span className="text-sm text-muted" role="status">
          {state.linked === 1 ? "1 par juntado." : `${state.linked ?? 0} pares juntados.`}
          {state.review ? ` ${state.review} para conferir.` : ""}
        </span>
      )}
      <FormError message={state?.error} />
    </div>
  );
}

export function ReviewButtons({ outId, inId }: { outId: string; inId: string }) {
  const { pending, state, run } = useRun();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={pending} onClick={() => run(() => joinPair(outId, inId))}>
          Juntar
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => run(() => dismissPair(outId, inId))}>
          Não é transferência
        </Button>
      </div>
      <FormError message={state?.error} />
    </div>
  );
}

export function UnlinkButton({ group }: { group: string }) {
  const { pending, state, run } = useRun();
  return (
    <span className="flex shrink-0 flex-col items-end">
      <button
        type="button"
        disabled={pending}
        onClick={() => run(() => unlinkPair(group))}
        className="text-[13px] font-medium text-link disabled:opacity-60"
      >
        Separar
      </button>
      <FormError message={state?.error} />
    </span>
  );
}
