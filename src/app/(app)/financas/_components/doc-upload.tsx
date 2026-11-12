"use client";

import { useActionState } from "react";
import Link from "next/link";
import { FileScan } from "lucide-react";
import { uploadDocument, type DocState } from "../documentos-actions";
import { Card, FormError } from "@/components/ui";
import { FileButtons } from "@/components/file-buttons";

/**
 * "Ler PDF ou foto": envia boleto/comprovante para leitura. Nada é gravado como conta ou
 * lançamento aqui: a próxima tela mostra o que foi lido para o usuário conferir.
 */
export function DocUpload({
  pending: pendingCount,
  showListLink = true,
  origem,
  mes,
}: {
  pending?: number;
  showListLink?: boolean;
  /** "casa": enviado por Casa > Contas; a conferência cria conta da casa e volta para lá. */
  origem?: "casa";
  /** Mês (AAAA-MM) da tela de origem, para voltar nele. */
  mes?: string;
}) {
  const [state, action, busy] = useActionState<DocState, FormData>(uploadDocument, null);

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
      {/* Escolher o arquivo (PDF, imagem ou foto da câmera) já envia para leitura. */}
      <form action={action} className="flex flex-col gap-3">
        {origem === "casa" && <input type="hidden" name="origem" value="casa" />}
        {origem === "casa" && mes && <input type="hidden" name="mes" value={mes} />}
        <FileButtons label="Arquivo (PDF ou JPG, até 4 MB)" mode="submit" disabled={busy} />
        {busy && (
          <p role="status" className="text-sm text-muted">
            Lendo o documento…
          </p>
        )}
      </form>
      <FormError message={state?.error} />
    </Card>
  );
}
