// Gera os ícones PNG do PWA a partir da marca (ramo de oliveira).
// Uso: node scripts/make-icons.mjs
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const OLIVE = "#556b2f";
const BG = "#f7f7f3";
const SOFT = "#c9d6a3";

function svg({ maskable = false } = {}) {
  // Na versão maskable a arte encolhe para caber na zona segura (80%).
  const s = maskable ? 0.7 : 1;
  const t = (64 - 64 * s) / 2;
  const radius = maskable ? 0 : 14;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="${radius}" fill="${OLIVE}"/>
  <g transform="translate(${t} ${t}) scale(${s})">
    <path d="M19 47 Q30 33 45 17" stroke="${BG}" stroke-width="2.6" stroke-linecap="round" fill="none"/>
    <ellipse cx="23.6" cy="31.4" rx="6.8" ry="2.7" transform="rotate(70 23.6 31.4)" fill="${BG}"/>
    <ellipse cx="38.8" cy="29.6" rx="6.8" ry="2.7" transform="rotate(-12 38.8 29.6)" fill="${BG}"/>
    <ellipse cx="35.6" cy="17" rx="6" ry="2.5" transform="rotate(70 35.6 17)" fill="${BG}"/>
    <circle cx="34" cy="42.5" r="3.6" fill="${SOFT}"/>
  </g>
</svg>`;
}

mkdirSync("public/icons", { recursive: true });
const jobs = [
  ["icon-192.png", 192, false],
  ["icon-512.png", 512, false],
  ["icon-maskable-512.png", 512, true],
  ["apple-touch-icon.png", 180, true],
];
for (const [name, size, maskable] of jobs) {
  await sharp(Buffer.from(svg({ maskable }))).resize(size, size).png().toFile(`public/icons/${name}`);
  console.log("ok", name);
}
await sharp(Buffer.from(svg())).resize(48, 48).png().toFile("src/app/icon.png");
console.log("ok src/app/icon.png");
