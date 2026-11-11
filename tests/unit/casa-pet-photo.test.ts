import { describe, expect, it } from "vitest";
import {
  checkPetPhoto,
  isJpegBytes,
  isPetPhotoPath,
  PET_PHOTO_MAX_BYTES,
  petInitial,
  petPhotoColumns,
  petPhotoFormFields,
  petPhotoHref,
  petPhotoPath,
  petPhotoPlan,
  petPhotoVersion,
  scaleToFit,
} from "@/lib/casa/pet-photo";

const HH = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";
const jpeg = (n = 10) => Uint8Array.from([0xff, 0xd8, 0xff, ...new Array(n).fill(1)]);

describe("foto do pet: bytes e tamanho", () => {
  it("aceita só a assinatura JPEG FF D8 FF", () => {
    expect(isJpegBytes(jpeg())).toBe(true);
    expect(isJpegBytes(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBe(false); // PNG
    expect(isJpegBytes(new TextEncoder().encode("%PDF-1.4"))).toBe(false);
    expect(isJpegBytes(Uint8Array.from([0xff, 0xd8]))).toBe(false);
  });
  it("recusa vazio, grande e não JPEG", () => {
    expect(checkPetPhoto(jpeg())).toEqual({ ok: true });
    expect(checkPetPhoto(new Uint8Array())).toMatchObject({ ok: false });
    expect(checkPetPhoto(new TextEncoder().encode("<html>oi</html>"))).toMatchObject({ ok: false, erro: "Envie uma foto JPG ou PNG." });
    const big = new Uint8Array(PET_PHOTO_MAX_BYTES + 1);
    big.set([0xff, 0xd8, 0xff]);
    expect(checkPetPhoto(big)).toMatchObject({ ok: false, erro: "A foto passa de 5 MB." });
    const max = new Uint8Array(PET_PHOTO_MAX_BYTES);
    max.set([0xff, 0xd8, 0xff]);
    expect(checkPetPhoto(max)).toEqual({ ok: true });
  });
});

describe("foto do pet: caminho e URL", () => {
  it("monta {household}/pets/{uuid}.jpg e reconhece só esse formato", () => {
    const p = petPhotoPath(HH, ID);
    expect(p).toBe(`${HH}/pets/${ID}.jpg`);
    expect(isPetPhotoPath(p)).toBe(true);
    expect(isPetPhotoPath(`${HH}/pets/${ID}.pdf`)).toBe(false);
    expect(isPetPhotoPath(`${HH}/docs/${ID}.jpg`)).toBe(false);
    expect(isPetPhotoPath(`${HH}/pets/../${ID}.jpg`)).toBe(false);
    expect(isPetPhotoPath(null)).toBe(false);
  });
  it("versão = uuid do arquivo (troca de foto muda a URL)", () => {
    expect(petPhotoVersion(petPhotoPath(HH, ID))).toBe(ID);
    expect(petPhotoVersion("lixo")).toBeNull();
    expect(petPhotoHref(HH, ID)).toBe(`/casa/pet/arquivo/foto/${HH}?v=${ID}`);
    expect(petPhotoHref(HH, null)).toBe(`/casa/pet/arquivo/foto/${HH}`);
  });
});

describe("foto do pet: substituição e remoção", () => {
  it("foto nova: grava as 3 colunas e apaga a antiga se havia", () => {
    expect(petPhotoPlan({ hasOld: true, hasNew: true, remove: false })).toEqual({ columns: "new", deleteOld: true });
    expect(petPhotoPlan({ hasOld: false, hasNew: true, remove: false })).toEqual({ columns: "new", deleteOld: false });
    expect(petPhotoPlan({ hasOld: true, hasNew: true, remove: true }).columns).toBe("new"); // nova vence remover
  });
  it("remover: zera as 3 colunas e apaga a antiga; sem pedido, nada muda", () => {
    expect(petPhotoPlan({ hasOld: true, hasNew: false, remove: true })).toEqual({ columns: "clear", deleteOld: true });
    expect(petPhotoPlan({ hasOld: false, hasNew: false, remove: true })).toEqual({ columns: "clear", deleteOld: false });
    expect(petPhotoPlan({ hasOld: true, hasNew: false, remove: false })).toEqual({ columns: "keep", deleteOld: false });
  });
  it("colunas: três preenchidas, três nulas ou nenhuma", () => {
    expect(petPhotoColumns("new", { path: "p", size: 5 })).toEqual({ photo_path: "p", photo_mime: "image/jpeg", photo_size: 5 });
    expect(petPhotoColumns("clear", null)).toEqual({ photo_path: null, photo_mime: null, photo_size: null });
    expect(petPhotoColumns("keep", null)).toEqual({});
  });
});

describe("foto do pet: redução e avatar", () => {
  it("lado maior ≤ 1024, mantém proporção e nunca amplia", () => {
    expect(scaleToFit(4000, 3000)).toEqual({ width: 1024, height: 768 });
    expect(scaleToFit(3000, 4000)).toEqual({ width: 768, height: 1024 });
    expect(scaleToFit(800, 600)).toEqual({ width: 800, height: 600 });
    expect(scaleToFit(10000, 2)).toEqual({ width: 1024, height: 1 });
  });
  it("inicial do nome", () => {
    expect(petInitial("moisés")).toBe("M");
    expect(petInitial("  ébano")).toBe("É");
    expect(petInitial("")).toBe("?");
  });
});

describe("foto do pet: o que o formulário envia", () => {
  it("foto nova vence remover; remover só sem foto nova; erro de leitura não remove", () => {
    expect(petPhotoFormFields(true, true)).toEqual({ photo: true, remove_photo: false });
    expect(petPhotoFormFields(true, false)).toEqual({ photo: true, remove_photo: false });
    expect(petPhotoFormFields(false, true)).toEqual({ photo: false, remove_photo: true });
    expect(petPhotoFormFields(false, false)).toEqual({ photo: false, remove_photo: false });
  });
});
