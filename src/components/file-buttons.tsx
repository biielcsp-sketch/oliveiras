"use client";

import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import clsx from "clsx";
import { Camera, FileText, ImageIcon, X } from "lucide-react";
import { btnBase, btnVariant } from "@/components/ui";
import {
  assignFileField,
  clearFileFields,
  DEFAULT_ACCEPT,
  FILE_KIND_LABEL,
  FILE_KINDS,
  type FileKind,
} from "@/lib/file-buttons";

const ICON = { pdf: FileText, image: ImageIcon, photo: Camera } as const;

/**
 * Botões azuis "PDF" / "Imagem" / "Foto" no lugar do campo de arquivo. Cada botão abre o seletor
 * (Foto abre a câmera traseira). Só o input escolhido leva o `name`, então vai um único `file` no form.
 *
 * - `mode="select"` (padrão): o arquivo fica escolhido, aparece o nome com "Remover", e só vai ao
 *   servidor no botão do formulário.
 * - `mode="submit"`: escolher já envia o formulário (`requestSubmit`).
 * - `onPick`: tratamento próprio (ex.: foto do pet reduzida no navegador); nenhum input recebe `name`.
 */
export function FileButtons({
  label,
  kinds = FILE_KINDS,
  accept,
  name = "file",
  disabled,
  required,
  mode = "select",
  onPick,
}: {
  /** Legenda visível do grupo (ex.: "Arquivo opcional (PDF ou JPG, até 5 MB)"). */
  label: string;
  kinds?: readonly FileKind[];
  accept?: Partial<Record<FileKind, string>>;
  name?: string;
  disabled?: boolean;
  /** Exige um arquivo antes de enviar (validação nativa do navegador). */
  required?: boolean;
  mode?: "select" | "submit";
  onPick?: (e: ChangeEvent<HTMLInputElement>) => void;
}) {
  const id = useId();
  const groupRef = useRef<HTMLDivElement>(null);
  const inputs = useRef<Partial<Record<FileKind, HTMLInputElement | null>>>({});
  const [chosen, setChosen] = useState<string | null>(null);

  // Form resetado (ex.: depois de uma server action): some o nome escolhido e o `name` dos inputs.
  useEffect(() => {
    const form = groupRef.current?.closest("form");
    if (!form) return;
    const onReset = () => {
      clearFileFields(inputs.current);
      setChosen(null);
    };
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, []);

  function handleChange(kind: FileKind, e: ChangeEvent<HTMLInputElement>) {
    if (onPick) return onPick(e);
    const file = e.target.files?.[0];
    if (!file) return;
    assignFileField(inputs.current, kind, name);
    if (mode === "submit") {
      e.target.form?.requestSubmit();
      return;
    }
    setChosen(file.name);
  }

  function remove() {
    clearFileFields(inputs.current);
    setChosen(null);
  }

  return (
    <div ref={groupRef} role="group" aria-labelledby={`${id}-label`} className="flex flex-col gap-1.5">
      <span id={`${id}-label`} className="text-[13px] font-medium text-muted">
        {label}
      </span>
      <div className="flex flex-wrap gap-2">
        {kinds.map((kind, i) => {
          const Icon = ICON[kind];
          return (
            <label
              key={kind}
              className={clsx(
                btnBase,
                btnVariant.primary,
                "h-11 min-w-11 cursor-pointer px-5",
                "has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50",
                "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary",
              )}
            >
              <Icon size={18} aria-hidden />
              {FILE_KIND_LABEL[kind]}
              <input
                ref={(el) => {
                  inputs.current[kind] = el;
                }}
                type="file"
                accept={accept?.[kind] ?? DEFAULT_ACCEPT[kind]}
                capture={kind === "photo" ? "environment" : undefined}
                disabled={disabled}
                // Validação nativa: só o primeiro botão exige, e só enquanto nada foi escolhido.
                required={required && !chosen && i === 0}
                onChange={(e) => handleChange(kind, e)}
                className="sr-only"
              />
            </label>
          );
        })}
      </div>
      {chosen && (
        <p className="flex min-h-11 items-center gap-2 text-[15px]" aria-live="polite">
          <FileText size={16} aria-hidden className="shrink-0 text-muted" />
          <span className="min-w-0 truncate" data-testid="arquivo-escolhido">
            {chosen}
          </span>
          <button
            type="button"
            onClick={remove}
            disabled={disabled}
            aria-label={`Remover ${chosen}`}
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 text-[15px] font-medium text-danger disabled:opacity-50"
          >
            <X size={16} aria-hidden /> Remover
          </button>
        </p>
      )}
    </div>
  );
}
