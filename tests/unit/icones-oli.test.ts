import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import manifest from "../../src/app/manifest";

const icon = (name: string) => readFileSync(fileURLToPath(new URL(`../../public/icons/${name}`, import.meta.url)));
const dims = (b: Buffer) => [b.readUInt32BE(16), b.readUInt32BE(20)];

describe("ícones do app (esfera do Oli)", () => {
  it("tem os tamanhos certos de PNG", () => {
    expect(dims(icon("icon-192.png"))).toEqual([192, 192]);
    expect(dims(icon("icon-512.png"))).toEqual([512, 512]);
    expect(dims(icon("icon-maskable-512.png"))).toEqual([512, 512]);
    expect(dims(icon("apple-touch-icon.png"))).toEqual([180, 180]);
  });
  it("o manifest aponta para URLs com versão, para o celular baixar o ícone novo", () => {
    const icons = manifest().icons ?? [];
    expect(icons).toHaveLength(3);
    for (const i of icons) expect(i.src).toMatch(/\?v=2$/);
  });
  it("o service worker troca o cache para não manter o ícone antigo", () => {
    const sw = readFileSync(fileURLToPath(new URL("../../public/sw.js", import.meta.url)), "utf8");
    expect(sw).toContain('"/icons/icon-192.png?v=2"');
    expect(sw).not.toContain('"oliveiras-v4"');
  });
});
