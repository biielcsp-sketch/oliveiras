"use client";

import { useActionState, useRef } from "react";
import Link from "next/link";
import { Camera, FileScan } from "lucide-react";
import { uploadDocument, type DocState } from "../documentos-actions";
import { Button, Card, FormError } from "@/components/ui";

const fileInputClass =
  "w-full rounded-2xl border border-transparent bg-surface-2 px-4 py-3 text-[15px] text-ink file:mr-3 file:rounded-full file:border-0 file:bg-accent-soft file:px-3 file:py-1.5 file:text-sm";

/**
 * "Ler PDF ou foto": envia boleto/comprovante para leitura. Nada é gravado como conta ou
 * lançamento aqui: a próxima tela mostra o que foi lido para o usuário conferir.
 */
export function DocUpload({ pending: pendingCount, showListLink = true }: { pending?: number; showListLink?: boolean }) {
  const [state, action, busy] = useActionState<DocState, FormData>(uploadDocument, null);
  const cameraForm = useRef<HTMLFormElement>(null);

  return (
    <Card className="flex flex-col gap-3" role="region" aria-label="Ler PDF ou foto">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-medium">
          <FileScan size={18} aria-hidden /> Ler PDF ou foto
        </h2>
        {showListLink && (
          <Link href="/financas/documentos" className="text-[13px] font-medium text-link">
            Documentos{pendingCount ? ` (${pendingCount} pendente${pendingCount > 1 ? "s" : ""})` : ""}
          </Link>
        )}
      </div>
      <p className="text-[13px] text-muted">Boleto ou comprovante. Você confere tudo antes de salvar.</p>
      <form action={action} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-muted">Arquivo (PDF ou JPG, até 5 MB)</span>
          <input name="file" type="file" accept="application/pdf,image/jpeg,.pdf,.jpg,.jpeg" required className={fileInputClass} />
        </label>
        <Button disabled={busy}>{busy ? "Lendo o documento…" : "Ler documento"}</Button>
      </form>
      {/* Celular: abre a câmera direto e envia assim que a foto é tirada. */}
      <form action={action} ref={cameraForm} className="sm:hidden">
        <label className="inline-flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-full border border-line text-[15px] font-medium">
          <Camera size={16} aria-hidden /> Tirar foto
          <input
            name="file"
            type="file"
            accept="image/jpeg"
            capture="environment"
            className="sr-only"
            disabled={busy}
            onChange={() => cameraForm.current?.requestSubmit()}
          />
        </label>
      </form>
      <FormError message={state?.error} />
    </Card>
  );
}
