import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { docUploadButtons, documentsAriaLabel, pendingBadgeText } from "@/lib/doc-upload-panel";

describe("painel compacto Ler PDF", () => {
  it("mostra Documentos só com showListLink", () => {
    expect(docUploadButtons(true)).toEqual(["ler", "documentos"]);
    expect(docUploadButtons(false)).toEqual(["ler"]);
  });
  it("badge de pendentes", () => {
    expect(pendingBadgeText(undefined)).toBe("");
    expect(pendingBadgeText(0)).toBe("");
    expect(pendingBadgeText(NaN)).toBe("");
    expect(pendingBadgeText(3)).toBe("3");
    expect(pendingBadgeText(250)).toBe("99+");
  });
  it("aria do link Documentos", () => {
    expect(documentsAriaLabel(0)).toBe("Documentos");
    expect(documentsAriaLabel(1)).toBe("Documentos, 1 pendente");
    expect(documentsAriaLabel(4)).toBe("Documentos, 4 pendentes");
  });
  it("fonte mantém região acessível e os 3 inputs sempre no DOM", () => {
    const src = readFileSync("src/app/(app)/financas/_components/doc-upload.tsx", "utf8");
    expect(src).toContain('role="region"');
    expect(src).toContain('aria-label="Ler PDF ou foto"');
    expect(src).toContain('type="file"');
    expect(src).toContain("FILE_KINDS.map");
    expect(src).toContain("aria-label={FILE_KIND_LABEL[kind]}");
    expect(src).not.toMatch(/\{open && \(\s*<input/);
    expect(src).not.toContain("dangerouslySetInnerHTML");
    expect(src).toContain("uploadDocument");
  });
});
