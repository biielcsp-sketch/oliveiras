/**
 * Regras dos botões de arquivo (PDF / Imagem / Foto). Cada botão tem o próprio <input type="file">,
 * mas só UM deles pode ter `name` na hora do envio: três inputs com o mesmo nome mandariam três
 * campos `file` (os vazios também vão) e o servidor leria o primeiro, que pode estar vazio.
 */

export type FileKind = "pdf" | "image" | "photo";

export const FILE_KINDS: readonly FileKind[] = ["pdf", "image", "photo"];

export const FILE_KIND_LABEL: Record<FileKind, string> = { pdf: "PDF", image: "Imagem", photo: "Foto" };

/** Tipos padrão: os mesmos que o servidor aceita hoje (PDF e JPG). */
export const DEFAULT_ACCEPT: Record<FileKind, string> = {
  pdf: "application/pdf,.pdf",
  image: "image/jpeg,.jpg,.jpeg",
  photo: "image/jpeg",
};

/** O mínimo de um <input type="file"> que estas regras usam (facilita o teste sem DOM). */
export type FileFieldLike = { value: string; name: string; removeAttribute(attr: "name"): void };

/** Deixa o arquivo só no input escolhido: ele recebe o `name`; os outros perdem o `name` e o arquivo. */
export function assignFileField(inputs: Partial<Record<FileKind, FileFieldLike | null>>, chosen: FileKind, name: string) {
  for (const kind of FILE_KINDS) {
    const el = inputs[kind];
    if (!el) continue;
    if (kind === chosen) {
      el.name = name;
    } else {
      el.removeAttribute("name");
      el.value = "";
    }
  }
}

/** Remove o arquivo escolhido: nenhum input fica com `name` nem com arquivo. */
export function clearFileFields(inputs: Partial<Record<FileKind, FileFieldLike | null>>) {
  for (const kind of FILE_KINDS) {
    const el = inputs[kind];
    if (!el) continue;
    el.removeAttribute("name");
    el.value = "";
  }
}
