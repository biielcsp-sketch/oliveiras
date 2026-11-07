import { parseBRL } from "./money";
import { normalizeText } from "./rules";
import type { ParsedTx } from "./ofx";

function splitLine(line: string, delimiter: string) {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function detectDelimiter(header: string) {
  const counts = [";", ",", "\t"].map((d) => [d, splitLine(header, d).length] as const);
  return counts.sort((a, b) => b[1] - a[1])[0][0];
}

const COLUMNS = {
  date: ["data", "date", "dt", "data lancamento", "data da compra"],
  description: ["descricao", "description", "title", "titulo", "historico", "lancamento", "estabelecimento", "memo"],
  amount: ["valor", "amount", "value", "quantia", "valor (r$)"],
  id: ["identificador", "id"],
} as const;

function findColumn(headers: string[], names: readonly string[]) {
  return headers.findIndex((h) => names.includes(h as never));
}

function csvDate(raw: string) {
  let y: string, m: string, d: string;
  let match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) [, y, m, d] = match;
  else if ((match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/))) [, d, m, y] = match;
  else if ((match = raw.match(/^(\d{2})\/(\d{2})\/(\d{2})$/))) {
    [, d, m, y] = match;
    y = `20${y}`;
  } else return null;
  const date = new Date(`${y}-${m}-${d}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.getUTCDate() !== Number(d)) return null;
  return `${y}-${m}-${d}`;
}

/** Lê CSV de extrato/fatura detectando separador e colunas pelo cabeçalho. */
export function parseCsv(text: string): { transactions: ParsedTx[]; errors: string[] } {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { transactions: [], errors: ["CSV vazio ou sem lançamentos."] };

  const delimiter = detectDelimiter(lines[0]);
  const headers = splitLine(lines[0], delimiter).map(normalizeText);
  const col = {
    date: findColumn(headers, COLUMNS.date),
    description: findColumn(headers, COLUMNS.description),
    amount: findColumn(headers, COLUMNS.amount),
    id: findColumn(headers, COLUMNS.id),
  };
  if (col.date < 0 || col.description < 0 || col.amount < 0) {
    return {
      transactions: [],
      errors: ["Não encontrei as colunas de data, descrição e valor no cabeçalho do CSV."],
    };
  }

  const transactions: ParsedTx[] = [];
  const errors: string[] = [];
  lines.slice(1).forEach((line, i) => {
    const cells = splitLine(line, delimiter);
    const date = csvDate(cells[col.date] ?? "");
    const amount = parseBRL(cells[col.amount] ?? "");
    const description = (cells[col.description] ?? "").slice(0, 200);
    if (!date || amount === null || amount === 0) {
      errors.push(`Linha ${i + 2}: data ou valor inválido.`);
      return;
    }
    const id = col.id >= 0 ? cells[col.id] : "";
    transactions.push({
      date,
      description: description || "Sem descrição",
      amount,
      externalId: id ? `csv:${id}`.slice(0, 120) : null,
    });
  });
  return { transactions, errors };
}
