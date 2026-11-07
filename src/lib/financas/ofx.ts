export type ParsedTx = { date: string; description: string; amount: number; externalId: string | null };

/** Decodifica o arquivo respeitando o charset do cabeçalho (bancos brasileiros costumam usar 1252). */
export function decodeStatement(bytes: Uint8Array): string {
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 600)).toUpperCase();
  const latin = /CHARSET:\s*(1252|8859|ISO-8859-1)|ENCODING="(WINDOWS-1252|ISO-8859-1)"/.test(head);
  if (latin) return new TextDecoder("windows-1252").decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

// Expressões fixas (sem RegExp montado em tempo de execução).
const TAGS = {
  DTPOSTED: /<DTPOSTED>([^<\r\n]*)/i,
  TRNAMT: /<TRNAMT>([^<\r\n]*)/i,
  MEMO: /<MEMO>([^<\r\n]*)/i,
  NAME: /<NAME>([^<\r\n]*)/i,
  FITID: /<FITID>([^<\r\n]*)/i,
} as const;

function tag(block: string, name: keyof typeof TAGS) {
  const m = block.match(TAGS[name]);
  return m ? m[1].trim() : null;
}

function ofxDate(raw: string | null) {
  if (!raw || !/^\d{8}/.test(raw)) return null;
  const y = raw.slice(0, 4), m = raw.slice(4, 6), d = raw.slice(6, 8);
  const date = new Date(`${y}-${m}-${d}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.getUTCDate() !== Number(d)) return null;
  return `${y}-${m}-${d}`;
}

function decodeEntities(s: string) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

/** Lê lançamentos (STMTTRN) de OFX em SGML (v1) ou XML (v2). */
export function parseOfx(text: string): { transactions: ParsedTx[]; errors: string[] } {
  const transactions: ParsedTx[] = [];
  const errors: string[] = [];
  if (!/<OFX>/i.test(text)) return { transactions, errors: ["Arquivo não parece ser OFX."] };

  const blocks = text.split(/<STMTTRN>/i).slice(1).map((b) => b.split(/<\/STMTTRN>/i)[0]);
  blocks.forEach((block, i) => {
    const date = ofxDate(tag(block, "DTPOSTED"));
    const rawAmount = tag(block, "TRNAMT");
    const amount = rawAmount ? Number(rawAmount.replace(",", ".")) : NaN;
    const description = decodeEntities(tag(block, "MEMO") || tag(block, "NAME") || "").slice(0, 200);
    const fitid = tag(block, "FITID");
    if (!date || !Number.isFinite(amount) || amount === 0) {
      errors.push(`Lançamento ${i + 1}: data ou valor inválido.`);
      return;
    }
    transactions.push({
      date,
      description: description || "Sem descrição",
      amount: Math.round(amount * 100) / 100,
      externalId: fitid ? `ofx:${fitid}`.slice(0, 120) : null,
    });
  });
  return { transactions, errors };
}
