// Gera a imagem estática do mini Oli (barra inferior) a partir do próprio avatar 3D.
// Renderiza src/components/oli/oli3d.ts (estado Repouso, de frente, sem cenário, fundo transparente)
// no Chromium do Playwright e salva public/oli/oli-mini.webp (192 px).
// Dependências (já no projeto, só para este script): rolldown (empacota o oli3d.ts; vem com o vitest),
// sharp (recorte e conversão; vem com o next), @playwright/test + Chromium (`npx playwright install chromium`).
// Uso (só quando o avatar mudar), na raiz do repositório: node scripts/render-oli-mini.mjs
// Saída: public/oli/oli-mini.webp (o PNG não é gerado: não é usado pelo app).
import { build } from "rolldown";
import { chromium } from "@playwright/test";
import sharp from "sharp";
import http from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SIZE = 192;
const dir = mkdtempSync(join(tmpdir(), "oli-mini-"));

try {
  await build({
    input: "src/components/oli/oli3d.ts",
    output: { dir, format: "esm", entryFileNames: "oli3d.js" },
    logLevel: "silent",
  });

  const html = `<!doctype html><html><body style="margin:0;background:transparent">
<div id="c" style="width:640px;height:640px"></div>
<script type="module">
  import { createOli3D } from "/oli3d.js";
  const oli = await createOli3D(document.getElementById("c"), { scenery: false });
  oli.setState("idle");
  setTimeout(() => (window.ready = true), 900);
</script></body></html>`;
  const server = http
    .createServer((req, res) => {
      if (req.url === "/oli3d.js") {
        res.writeHead(200, { "content-type": "text/javascript" });
        return res.end(readFileSync(join(dir, "oli3d.js")));
      }
      res.writeHead(200, { "content-type": "text/html" });
      res.end(html);
    })
    .listen(0);
  const port = server.address().port;

  const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 640, height: 640 }, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.ready === true, null, { timeout: 30_000 });
  const shot = await page.locator("#c").screenshot({ omitBackground: true });
  await browser.close();
  server.close();

  // Recorta o robô (sem bordas vazias), deixa uma margem e reduz para 192 px.
  const trimmed = await sharp(shot).trim({ threshold: 2 }).toBuffer();
  const meta = await sharp(trimmed).metadata();
  const side = Math.round(Math.max(meta.width, meta.height) * 1.08);
  const square = await sharp(trimmed)
    .extend({
      top: Math.floor((side - meta.height) / 2),
      bottom: Math.ceil((side - meta.height) / 2),
      left: Math.floor((side - meta.width) / 2),
      right: Math.ceil((side - meta.width) / 2),
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  // Em etapa separada: no sharp o resize roda antes do extend dentro da mesma cadeia.
  const resized = await sharp(square).resize(SIZE, SIZE).toBuffer();
  await sharp(resized).webp({ quality: 90, alphaQuality: 100 }).toFile("public/oli/oli-mini.webp");
  console.log("ok: public/oli/oli-mini.webp");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
