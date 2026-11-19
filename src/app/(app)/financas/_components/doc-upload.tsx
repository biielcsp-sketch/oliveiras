"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Camera, FileScan, FileText, Files, ImageIcon } from "lucide-react";
import { uploadDocument, type DocState } from "../documentos-actions";
import { FormError } from "@/components/ui";
import { DEFAULT_ACCEPT, FILE_KIND_LABEL, FILE_KINDS, assignFileField, fileFieldName, type FileKind } from "@/lib/file-buttons";
import { docUploadButtons, documentsAriaLabel, pendingBadgeText } from "@/lib/doc-upload-panel";

const ICON = { pdf: FileText, image: ImageIcon, photo: Camera } as const;

const circle = "glass-card grid size-[46px] place-items-center rounded-full text-primary transition group-active:scale-95";
const caption = "w-full text-[11.5px] font-medium leading-tight text-muted";

/**
 * "Ler PDF ou foto": envia boleto/comprovante para leitura. Nada é gravado como conta ou
 * lançamento aqui: a próxima tela mostra o que foi lido para o usuário conferir.
 * Os 3 inputs de arquivo ficam sempre no DOM (escondidos); o menu só os aciona.
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
  const [open, setOpen] = useState(false);
  // O `name` precisa vir do render (React 19 remove `name` de <input> sem a prop a cada re-render).
  const [chosen, setChosen] = useState<FileKind | null>(null);
  const menuId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputs = useRef<Partial<Record<FileKind, HTMLInputElement | null>>>({});
  const buttons = docUploadButtons(showListLink);
  const badge = pendingBadgeText(pendingCount);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function onChange(kind: FileKind, e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files?.[0]) return;
    assignFileField(inputs.current, kind, "file"); // no DOM já: o envio abaixo é síncrono
    setChosen(kind);
    e.target.form?.requestSubmit();
  }

  return (
    <div ref={wrapRef} role="region" aria-label="Ler PDF ou foto" className="relative flex flex-col gap-2">
      <form action={action}>
        {origem === "casa" && <input type="hidden" name="origem" value="casa" />}
        {origem === "casa" && mes && <input type="hidden" name="mes" value={mes} />}
        {FILE_KINDS.map((kind) => (
          <input
            key={kind}
            ref={(el) => {
              inputs.current[kind] = el;
            }}
            type="file"
            aria-label={FILE_KIND_LABEL[kind]}
            name={fileFieldName(chosen, kind, "file")}
            accept={DEFAULT_ACCEPT[kind]}
            capture={kind === "photo" ? "environment" : undefined}
            disabled={busy}
            tabIndex={-1}
            onChange={(e) => onChange(kind, e)}
            className="sr-only"
          />
        ))}
      </form>
      <div className="flex items-start gap-4">
        {buttons.includes("ler") && (
          <button
            ref={triggerRef}
            type="button"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-controls={open ? menuId : undefined}
            disabled={busy}
            onClick={() => setOpen((v) => !v)}
            className="group flex w-16 min-w-0 flex-col items-center gap-1.5 py-1 text-center disabled:opacity-50"
          >
            <span className={circle}>
              <FileScan size={20} strokeWidth={2.2} aria-hidden />
            </span>
            <span className={caption}>Ler PDF</span>
          </button>
        )}
        {buttons.includes("documentos") && (
          <Link
            href="/financas/documentos"
            aria-label={documentsAriaLabel(pendingCount)}
            className="group flex w-16 min-w-0 flex-col items-center gap-1.5 py-1 text-center"
          >
            <span className={clsx(circle, "relative")}>
              <Files size={20} strokeWidth={2.2} aria-hidden />
              {badge && (
                <span
                  aria-hidden
                  className="absolute -right-1 -top-1 grid min-w-[18px] place-items-center rounded-full bg-danger px-1 text-[10.5px] font-semibold leading-[18px] text-white"
                >
                  {badge}
                </span>
              )}
            </span>
            <span className={caption} aria-hidden>
              Documentos
            </span>
          </Link>
        )}
      </div>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Escolher origem do arquivo"
          className="glass-card absolute left-0 top-full z-20 mt-1 flex w-48 max-w-[calc(100vw-2rem)] flex-col rounded-2xl p-1.5"
        >
          {FILE_KINDS.map((kind) => {
            const Icon = ICON[kind];
            return (
              <button
                key={kind}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  inputs.current[kind]?.click();
                }}
                className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-left text-[15px] font-medium text-deep active:bg-black/5"
              >
                <Icon size={18} aria-hidden className="text-primary" />
                {kind === "photo" ? "Foto (câmera)" : FILE_KIND_LABEL[kind]}
              </button>
            );
          })}
        </div>
      )}
      {busy && (
        <p role="status" className="text-sm text-muted">
          Lendo o documento…
        </p>
      )}
      <FormError message={state?.error} />
    </div>
  );
}
