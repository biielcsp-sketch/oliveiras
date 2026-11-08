// Gera o ícone da aba (src/app/icon.png) a partir da marca (ramo de oliveira).
// Os ícones do PWA (public/icons/) agora são do Oli: veja scripts/render-oli-icons.mjs.
// Uso: node scripts/make-icons.mjs
import sharp from "sharp";

const OLIVE = "#556b2f";
const BG = "#f7f7f3";
const SOFT = "#c9d6a3";

function svg() {
  const s = 1;
  const t = 0;
  const radius = 14;
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

await sharp(Buffer.from(svg())).resize(48, 48).png().toFile("src/app/icon.png");
console.log("ok src/app/icon.png");
