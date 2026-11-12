"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { FileButtons } from "@/components/file-buttons";
import { petInitial, petPhotoFormFields, petPhotoHref } from "@/lib/casa/pet-photo";
import { PHOTO_DECODE_ERROR, resizePetPhoto } from "@/lib/casa/pet-photo-client";

const SIZES = { sm: "size-12 text-xl", lg: "size-20 text-3xl" } as const;
const PX = { sm: 48, lg: 80 } as const;

/** Avatar redondo do pet: foto (rota autenticada) ou inicial do nome. Tamanho reservado (sem CLS). */
export function PetAvatar({ petId, name, version, src, size = "sm" }: { petId?: string; name: string; version: string | null; src?: string | null; size?: keyof typeof SIZES }) {
  const url = src ?? (petId && version ? petPhotoHref(petId, version) : null);
  const box = `${SIZES[size]} shrink-0 overflow-hidden rounded-full border border-line bg-accent-soft text-primary`;
  if (!url) {
    return (
      <span data-testid="pet-avatar-vazio" aria-hidden className={`${box} grid place-items-center font-semibold`}>
        {petInitial(name)}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- rota autenticada; o otimizador de imagens do Next não tem a sessão
    <img data-testid="pet-avatar" src={url} alt={name} width={PX[size]} height={PX[size]} className={`${box} object-cover`} />
  );
}

/**
 * Campo de foto do pet. A foto é reduzida para JPEG no navegador; o arquivo original nunca é enviado
 * (os inputs não têm `name`): o JPEG vai em `photo` via `prepare`. "Remover foto" vai em `remove_photo`.
 */
export function usePetPhotoField(pet?: { id: string; name: string; photo_v: string | null }) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [remove, setRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  // Refs: o submit (Enter/duplo toque) lê o valor mais recente e espera a leitura em andamento terminar.
  const blobRef = useRef<Blob | null>(null);
  const removeRef = useRef(false);
  const pendingRef = useRef<Promise<void> | null>(null);

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setProcessing(true);
    setError(null);
    const job = (async () => {
      try {
        const out = await resizePetPhoto(file);
        blobRef.current = out;
        removeRef.current = false;
        setBlob(out);
        setPreview(URL.createObjectURL(out));
        setRemove(false);
      } catch (err) {
        // Falha: segue sem foto nova; a foto atual (se houver) fica como estava.
        setError(err instanceof Error && err.message ? err.message : PHOTO_DECODE_ERROR);
      }
    })();
    const tracked: Promise<void> = job.finally(() => {
      if (pendingRef.current === tracked) {
        pendingRef.current = null;
        setProcessing(false);
      }
    });
    pendingRef.current = tracked;
  }

  const current = !remove && !blob && pet?.photo_v ? petPhotoHref(pet.id, pet.photo_v) : null;
  const shown = preview ?? current;
  const name = pet?.name || "Pet";

  const prepare = async (data: FormData) => {
    await pendingRef.current;
    const f = petPhotoFormFields(!!blobRef.current, removeRef.current);
    if (f.photo && blobRef.current) data.set("photo", new File([blobRef.current], "foto.jpg", { type: "image/jpeg" }));
    if (f.remove_photo) data.set("remove_photo", "on");
  };

  const node = (
    <fieldset className="flex flex-col gap-3" aria-label="Foto do pet">
      <div className="flex items-center gap-4">
        <PetAvatar name={name} version={null} src={shown} size="lg" />
        <p className="text-sm text-muted">{preview ? "Pré-visualização: a foto só é salva ao salvar o pet." : shown ? "Foto atual." : "Sem foto."}</p>
      </div>
      <FileButtons label="Foto" kinds={["image", "photo"]} accept={{ image: "image/*", photo: "image/*" }} onPick={onPick} />
      {processing && (
        <p role="status" className="text-sm text-muted">
          Preparando a foto…
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {(preview || current) && (
        <button
          type="button"
          className="min-h-11 self-start text-[15px] font-medium text-danger"
          onClick={() => {
            blobRef.current = null;
            removeRef.current = true;
            setBlob(null);
            setPreview(null);
            setRemove(true);
            setError(null);
          }}
        >
          Remover foto
        </button>
      )}
    </fieldset>
  );

  return { node, prepare, processing };
}
