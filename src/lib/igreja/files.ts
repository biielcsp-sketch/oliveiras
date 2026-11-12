/**
 * Arquivos das aulas do Carisma (guardados no Google Drive de cada pessoa). Funções puras:
 * - tipo e tamanho DECLARADOS (antes do upload direto ao Drive) só servem para preparar a sessão;
 * - a confirmação decide pelo tamanho REAL (metadados do Drive) e pelos BYTES (bytes mágicos e estrutura do docx).
 */

export const CARISMA_MAX_BYTES = 20 * 1024 * 1024; // 20971520, igual ao check do banco
/** Pendente (sessão criada e não confirmada) mais velho que isso é limpo ao abrir a aula. */
export const PENDING_TTL_MS = 60 * 60 * 1000;
/** Teto do conteúdo DESCOMPACTADO declarado de um docx (proteção contra zip bomb antes do mammoth). */
export const DOCX_MAX_UNCOMPRESSED = 50 * 1024 * 1024;
/** Bytes baixados do começo do arquivo para conferir PDF/JPG/PNG. */
export const HEAD_BYTES = 16;

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const CARISMA_MIMES = ["application/pdf", "image/jpeg", "image/png", DOCX_MIME] as const;
export type CarismaMime = (typeof CARISMA_MIMES)[number];

export const MIME_INFO: Record<CarismaMime, { ext: string; label: string }> = {
  "application/pdf": { ext: "pdf", label: "PDF" },
  "image/jpeg": { ext: "jpg", label: "Imagem" },
  "image/png": { ext: "png", label: "Imagem" },
  [DOCX_MIME]: { ext: "docx", label: "Word" },
};

/** Extensão → tipo aceito. .doc (Word 97-2003) NÃO entra: é binário OLE, sem leitor confiável no servidor. */
const BY_EXT: Record<string, CarismaMime> = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", docx: DOCX_MIME };

export const OLD_DOC_MESSAGE = "Arquivo .doc (Word antigo) não é aceito. Abra no Word ou no Google Docs e salve como .docx ou PDF.";
export const ACCEPT_ATTR = ".pdf,.jpg,.jpeg,.png,.docx,application/pdf,image/jpeg,image/png," + DOCX_MIME;

/* ---------- Nome exibido ---------- */

const CONTROL = /[\u0000-\u001F\u007F-\u009F\u2028\u2029\u202A-\u202E\u2066-\u2069]/g;

/** Limpeza do nome (pode sobrar vazio): sem controle, aspas, barras, < > nem pontos no começo; espaços colapsados. */
function cleanName(raw: unknown) {
  let s = typeof raw === "string" ? raw : "";
  s = s.normalize("NFC").replace(CONTROL, "").replace(/["'`\\/<>|*?:]/g, " ").replace(/\s+/g, " ").trim();
  return s.replace(/^\.+/, "").trim();
}

/**
 * Nome exibido (e nome do arquivo no Drive): sem caracteres de controle, aspas, barras, < > nem marcas de direção;
 * espaços colapsados; até 120 caracteres preservando a extensão. Vazio → "arquivo.<ext>".
 */
export function sanitizeDisplayName(raw: unknown, ext?: string): string {
  const s = cleanName(raw);
  const max = 120;
  if (!s) return ext ? `arquivo.${ext}` : "arquivo";
  if (s.length <= max) return s;
  const dot = s.lastIndexOf(".");
  const tail = dot > 0 && s.length - dot <= 6 ? s.slice(dot) : "";
  return s.slice(0, max - tail.length).trimEnd() + tail;
}

/** Nome sem a extensão (para o campo de renomear). */
export function baseName(name: string) {
  const ext = extOf(name);
  return ext ? name.slice(0, -(ext.length + 1)) : name;
}

/**
 * Novo nome ao renomear: a pessoa digita só o nome; a extensão do arquivo atual é mantida
 * (a do nome atual, se combina com o tipo; senão a padrão do tipo). Se digitou a mesma extensão, não duplica.
 * Nome vazio (depois de limpo) → null.
 */
export function renamedDisplayName(raw: unknown, currentName: string, mime: CarismaMime): string | null {
  const cur = extOf(currentName);
  const ext = BY_EXT[cur] === mime ? cur : MIME_INFO[mime].ext;
  let base = typeof raw === "string" ? raw : "";
  const typed = extOf(base);
  if (typed && BY_EXT[typed] === mime) base = baseName(base);
  const clean = cleanName(base);
  if (!clean) return null;
  return `${clean.slice(0, 120 - ext.length - 1).trimEnd()}.${ext}`;
}

/* ---------- Pedido de upload (declarado pelo navegador) ---------- */

export type DeclaredUpload = { mime: CarismaMime; size: number; displayName: string };

export function extOf(name: string) {
  const m = /\.([A-Za-z0-9]{1,6})$/.exec(name.trim());
  return m ? m[1].toLowerCase() : "";
}

/** Valida nome/tipo/tamanho declarados. O tipo vem da EXTENSÃO e precisa bater com o mime declarado (quando houver). */
export function validateDeclaredUpload(raw: { name?: unknown; mime?: unknown; size?: unknown }): { ok: true; value: DeclaredUpload } | { ok: false; erro: string } {
  const name = typeof raw.name === "string" ? raw.name : "";
  const ext = extOf(name);
  const declared = typeof raw.mime === "string" ? raw.mime.trim().toLowerCase() : "";
  if (ext === "doc" || declared === "application/msword") return { ok: false, erro: OLD_DOC_MESSAGE };
  const mime = BY_EXT[ext];
  if (!mime) return { ok: false, erro: "Envie PDF, Word (.docx) ou imagem JPG/PNG." };
  // Navegadores às vezes mandam vazio ou octet-stream; qualquer outro tipo diferente do da extensão é recusado.
  if (declared && declared !== "application/octet-stream" && declared !== mime && !(mime === "image/jpeg" && declared === "image/jpg")) {
    return { ok: false, erro: "O tipo do arquivo não confere com a extensão." };
  }
  const size = typeof raw.size === "number" ? raw.size : Number(raw.size);
  if (!Number.isInteger(size) || size <= 0) return { ok: false, erro: "O arquivo está vazio." };
  if (size > CARISMA_MAX_BYTES) return { ok: false, erro: "O arquivo passa de 20 MB." };
  return { ok: true, value: { mime, size, displayName: sanitizeDisplayName(name, MIME_INFO[mime].ext) } };
}

/* ---------- Bytes mágicos ---------- */

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const JPG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ZIP = [0x50, 0x4b, 0x03, 0x04]; // PK\x03\x04

const startsWith = (b: Uint8Array, sig: number[]) => b.length >= sig.length && sig.every((v, i) => b[i] === v);

export type DetectedKind = "pdf" | "jpeg" | "png" | "zip";

export function detectKind(head: Uint8Array): DetectedKind | null {
  if (startsWith(head, PDF)) return "pdf";
  if (startsWith(head, JPG)) return "jpeg";
  if (startsWith(head, PNG)) return "png";
  if (startsWith(head, ZIP)) return "zip";
  return null;
}

const EXPECTED: Record<CarismaMime, DetectedKind> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpeg",
  "image/png": "png",
  [DOCX_MIME]: "zip",
};

/** Os primeiros bytes batem com o tipo registrado? (docx ainda precisa de `isDocxZip` com o arquivo inteiro.) */
export const headMatches = (mime: CarismaMime, head: Uint8Array) => detectKind(head) === EXPECTED[mime];

/**
 * docx de verdade: zip que começa com PK\x03\x04 e cujo DIRETÓRIO CENTRAL (lido a partir do registro
 * End of Central Directory, no fim do arquivo) lista "word/document.xml". Não basta o texto aparecer
 * em qualquer lugar: as entradas são percorridas pela estrutura do zip.
 * Também recusa se a soma dos tamanhos descompactados declarados passar de DOCX_MAX_UNCOMPRESSED (zip bomb)
 * ou se alguma entrada usar zip64 (tamanho 0xFFFFFFFF).
 */
export function isDocxZip(bytes: Uint8Array, maxUncompressed = DOCX_MAX_UNCOMPRESSED): boolean {
  if (!startsWith(bytes, ZIP) || bytes.length < 22) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // EOCD: assinatura 0x06054b50, nos últimos 22 + até 65535 bytes (comentário).
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return false;
  const entries = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (cdOffset + cdSize > eocd || entries === 0) return false;
  if (entries > 10000) return false;
  const dec = new TextDecoder("utf-8", { fatal: false });
  let p = cdOffset;
  let total = 0;
  let found = false;
  for (let n = 0; n < entries; n++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50) return false;
    const uncompressed = view.getUint32(p + 24, true);
    if (uncompressed === 0xffffffff) return false;
    total += uncompressed;
    if (total > maxUncompressed) return false;
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    if (p + 46 + nameLen > bytes.length) return false;
    if (dec.decode(bytes.subarray(p + 46, p + 46 + nameLen)) === "word/document.xml") found = true;
    p += 46 + nameLen + extraLen + commentLen;
  }
  return found;
}

/* ---------- Pendentes ---------- */

export const isStalePending = (f: { status: string; created_at: string }, now = Date.now()) =>
  f.status === "pendente" && now - Date.parse(f.created_at) > PENDING_TTL_MS;

/** Link do Drive aceito pelo banco (só drive.google.com ou docs.google.com, https, até 500). */
export function safeWebViewLink(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 500) return null;
  return /^https:\/\/(drive|docs)\.google\.com\//.test(v) ? v : null;
}

/** IDs do Drive: só [A-Za-z0-9_-] (mesmo check do banco). */
export const isDriveId = (v: unknown): v is string => typeof v === "string" && v.length >= 1 && v.length <= 200 && /^[A-Za-z0-9_-]+$/.test(v);

/** Nome da pasta da aula no Drive: "2026-11-12 · Título" (sanitizado, até 100). */
export function lessonFolderName(title: string, date: string | null) {
  const base = sanitizeDisplayName(title) || "Aula";
  return (date ? `${date} · ${base}` : base).slice(0, 100);
}
