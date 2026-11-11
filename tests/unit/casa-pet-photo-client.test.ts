import { afterEach, describe, expect, it, vi } from "vitest";
import { PHOTO_DECODE_ERROR, resizePetPhoto } from "@/lib/casa/pet-photo-client";

const heic = () => new File([new TextEncoder().encode("nao e imagem")], "ruim.heic", { type: "image/heic" });

afterEach(() => vi.unstubAllGlobals());

describe("redutor de foto: erro de decodificação não cai no <img> com blob", () => {
  it("imagem ilegível (InvalidStateError): erro em português e NENHUM blob: é criado (regressão da violação de CSP)", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new DOMException("não decodifica", "InvalidStateError")));
    const createObjectURL = vi.fn(() => "blob:x");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    await expect(resizePetPhoto(heic())).rejects.toThrow(PHOTO_DECODE_ERROR);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("navegador que rejeita a opção (TypeError): ainda tenta o <img> como plano B", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new TypeError("opção não suportada")));
    const createObjectURL = vi.fn(() => "blob:x");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    // Sem DOM no ambiente de teste, o plano B falha ao criar a <img>; o que importa é que ele foi tentado.
    await expect(resizePetPhoto(heic())).rejects.toThrow();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });
});
