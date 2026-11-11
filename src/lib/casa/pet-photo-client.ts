import { PET_PHOTO_MAX_SIDE, PET_PHOTO_MIME, PET_PHOTO_QUALITY, scaleToFit } from "./pet-photo";

export const PHOTO_DECODE_ERROR = "Não foi possível ler essa foto. Escolha uma foto JPG ou PNG.";

type Source = { width: number; height: number; draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void; close: () => void };

async function decode(file: File): Promise<Source> {
  if (typeof createImageBitmap === "function") {
    try {
      // "from-image": aplica a orientação EXIF (celular na vertical) antes de desenhar.
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { width: bmp.width, height: bmp.height, draw: (c, w, h) => c.drawImage(bmp, 0, 0, w, h), close: () => bmp.close() };
    } catch {
      /* tenta pelo <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return { width: img.naturalWidth, height: img.naturalHeight, draw: (c, w, h) => c.drawImage(img, 0, 0, w, h), close: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error(PHOTO_DECODE_ERROR);
  }
}

/** Reduz qualquer imagem que o navegador decodifique para JPEG (lado maior ≤ 1024 px). HEIC sem suporte → erro em português. */
export async function resizePetPhoto(file: File): Promise<Blob> {
  const src = await decode(file);
  try {
    if (!src.width || !src.height) throw new Error(PHOTO_DECODE_ERROR);
    const { width, height } = scaleToFit(src.width, src.height, PET_PHOTO_MAX_SIDE);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error(PHOTO_DECODE_ERROR);
    ctx.fillStyle = "#fff"; // PNG/WebP transparente vira fundo branco no JPEG
    ctx.fillRect(0, 0, width, height);
    src.draw(ctx, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, PET_PHOTO_MIME, PET_PHOTO_QUALITY));
    if (!blob || blob.type !== PET_PHOTO_MIME) throw new Error(PHOTO_DECODE_ERROR);
    return blob;
  } finally {
    src.close();
  }
}
