// Gera as imagens estáticas do Oli a partir do próprio avatar 3D (src/components/oli/oli3d.ts),
// estado Repouso, de frente, em qualidade máxima, no Chromium do Playwright:
// - public/oli/oli-mini.webp (192 px): só o robô, fundo transparente (barra inferior);
// - public/oli/oli-poster.webp (780 px): robô + cenário, fundo transparente (palco em aparelhos sem GPU).
// Dependências (já no projeto, só para este script): rolldown (empacota o oli3d.ts; vem com o vitest),
// sharp (recorte e conversão; vem com o next), @playwright/test + Chromium (`npx playwright install chromium`).
// Uso (só quando o avatar mudar), na raiz do repositório: node scripts/render-oli-mini.mjs
// Saída: public/oli/oli-mini.webp e public/oli/oli-poster.webp.
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
<div id="c" style="width:100vw;height:100vh"></div>
<script type="module">
  import { createOli3D } from "/oli3d.js";
  const scenery = new URLSearchParams(location.search).get("scenery") === "1";
  const oli = await createOli3D(document.getElementById("c"), { scenery, offline: true });
  oli.setState("idle");
  setTimeout(() => (window.ready = true), 2000); // primeiro quadro só depois do idle (até 1 s)
</script></body></html>`;
  const server = http
    .createServer((req, res) => {
      if (req.url.startsWith("/oli3d.js")) {
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
  await page.goto(`http://127.0.0.1:${port}/?scenery=0`);
  await page.waitForFunction(() => window.ready === true, null, { timeout: 30_000 });
  const shot = await page.locator("#c").screenshot({ omitBackground: true });

  // Pôster do palco: mesmo enquadramento do app (quadrado), 390 px em escala 2.
  const posterPage = await browser.newPage({ viewport: { width: 390, height: 390 }, deviceScaleFactor: 2 });
  await posterPage.goto(`http://127.0.0.1:${port}/?scenery=1`);
  await posterPage.waitForFunction(() => window.ready === true, null, { timeout: 30_000 });
  const poster = await posterPage.locator("#c").screenshot({ omitBackground: true });
  await sharp(poster).webp({ quality: 80, alphaQuality: 90 }).toFile("public/oli/oli-poster.webp");
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
  console.log("ok: public/oli/oli-mini.webp e public/oli/oli-poster.webp");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
