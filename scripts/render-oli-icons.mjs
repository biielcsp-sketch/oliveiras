// Gera os ícones do PWA ("Oli") a partir do próprio avatar 3D, sobre o fundo escuro do palco (#0a141c).
// Renderiza src/components/oli/oli3d.ts (estado Repouso, de frente, sem cenário, fundo transparente)
// no Chromium do Playwright, recorta o robô e compõe sobre o fundo.
// Saídas (substituem as anteriores, mesmos nomes):
//   public/icons/icon-192.png, icon-512.png   → cantos arredondados, avatar grande
//   public/icons/icon-maskable-512.png        → quadrado cheio, avatar dentro da zona segura (círculo de 80%)
//   public/icons/apple-touch-icon.png (180)   → quadrado cheio (o iOS arredonda), mesma margem da maskable
// Dependências (já no projeto): rolldown (vem com o vitest), sharp (vem com o next),
// @playwright/test + Chromium (`npx playwright install chromium`).
// Uso (só quando o avatar mudar), na raiz do repositório: node scripts/render-oli-icons.mjs
import { build } from "rolldown";
import { chromium } from "@playwright/test";
import sharp from "sharp";
import http from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BG = "#0a141c";
const RENDER = 1024;
const dir = mkdtempSync(join(tmpdir(), "oli-icons-"));

async function renderAvatar() {
  await build({
    input: "src/components/oli/oli3d.ts",
    output: { dir, format: "esm", entryFileNames: "oli3d.js" },
    logLevel: "silent",
  });
  const html = `<!doctype html><html><body style="margin:0;background:transparent">
<div id="c" style="width:${RENDER}px;height:${RENDER}px"></div>
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
  try {
    const page = await browser.newPage({ viewport: { width: RENDER, height: RENDER }, deviceScaleFactor: 1 });
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForFunction(() => window.ready === true, null, { timeout: 30_000 });
    const shot = await page.locator("#c").screenshot({ omitBackground: true });
    // Só o robô, sem bordas vazias.
    return await sharp(shot).trim({ threshold: 2 }).png().toBuffer();
  } finally {
    await browser.close();
    server.close();
  }
}

/** Avatar centralizado num quadrado `size`, ocupando no máximo `fill` do lado. */
async function compose(avatar, size, fill, radius) {
  const box = Math.round(size * fill);
  const art = await sharp(avatar).resize(box, box, { fit: "inside" }).png().toBuffer();
  const meta = await sharp(art).metadata();
  const r = Math.round(size * radius);
  const bg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" fill="${BG}"/></svg>`,
  );
  return sharp(bg)
    .composite([{ input: art, left: Math.round((size - meta.width) / 2), top: Math.round((size - meta.height) / 2) }])
    .png()
    .toBuffer();
}

try {
  const avatar = await renderAvatar();
  // Zona segura da maskable: círculo de diâmetro 80% do lado. O retângulo do avatar (quase quadrado)
  // cabe nele com lado ≤ 0,8/√2 ≈ 0,566; 0,56 deixa o robô inteiro em qualquer máscara.
  const jobs = [
    ["icon-192.png", 192, 0.78, 0.22],
    ["icon-512.png", 512, 0.78, 0.22],
    ["icon-maskable-512.png", 512, 0.56, 0],
    ["apple-touch-icon.png", 180, 0.62, 0],
  ];
  for (const [name, size, fill, radius] of jobs) {
    const png = await compose(avatar, size, fill, radius);
    await sharp(png).toFile(`public/icons/${name}`);
    console.log("ok", `public/icons/${name}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
