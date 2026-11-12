import { describe, expect, it } from "vitest";
import { assignFileField, clearFileFields, DEFAULT_ACCEPT, type FileFieldLike, type FileKind } from "@/lib/file-buttons";

/** Simula um <input type="file">: `name` vazio quando o atributo é removido. */
function fakeInput(value = "", name = ""): FileFieldLike {
  return {
    value,
    name,
    removeAttribute(attr) {
      if (attr === "name") this.name = "";
    },
  };
}

/** O que o navegador montaria no FormData: um campo por input com `name`. */
function formEntries(inputs: Record<FileKind, FileFieldLike>) {
  return Object.values(inputs).filter((el) => el.name).map((el) => [el.name, el.value]);
}

describe("botões de arquivo: só um campo `file` vai no formulário", () => {
  it("escolher pelo botão Foto deixa um único campo `file`, com a foto", () => {
    const inputs = { pdf: fakeInput(), image: fakeInput(), photo: fakeInput("C:\\fakepath\\foto.jpg") };
    assignFileField(inputs, "photo", "file");
    expect(formEntries(inputs)).toEqual([["file", "C:\\fakepath\\foto.jpg"]]);
  });

  it("trocar de PDF para Imagem limpa o PDF e tira o nome dele", () => {
    const inputs = { pdf: fakeInput("a.pdf"), image: fakeInput(), photo: fakeInput() };
    assignFileField(inputs, "pdf", "file");
    inputs.image.value = "b.jpg";
    assignFileField(inputs, "image", "file");
    expect(inputs.pdf.value).toBe("");
    expect(formEntries(inputs)).toEqual([["file", "b.jpg"]]);
  });

  it("Remover: nenhum campo `file` vai (o servidor trata como sem arquivo)", () => {
    const inputs = { pdf: fakeInput("a.pdf"), image: fakeInput(), photo: fakeInput() };
    assignFileField(inputs, "pdf", "file");
    clearFileFields(inputs);
    expect(formEntries(inputs)).toEqual([]);
    expect(inputs.pdf.value).toBe("");
  });

  it("botões ausentes (pet: sem PDF) são ignorados", () => {
    const inputs = { image: fakeInput("x.jpg"), photo: null };
    expect(() => assignFileField(inputs, "image", "file")).not.toThrow();
    expect(inputs.image.name).toBe("file");
  });

  it("tipos padrão não ampliam o que o servidor aceita (PDF e JPG)", () => {
    expect(DEFAULT_ACCEPT).toEqual({ pdf: "application/pdf,.pdf", image: "image/jpeg,.jpg,.jpeg", photo: "image/jpeg" });
  });
});
