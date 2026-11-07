import { createHash } from "node:crypto";
import type { ParsedTx } from "./ofx";
import { matchCategory, normalizeText, type Rule } from "./rules";

export type ImportRow = {
  date: string;
  description: string;
  amount: number;
  external_id: string;
  category_id: string | null;
};

/**
 * Prepara os lançamentos para gravar:
 * - inverte o sinal se pedido (faturas em CSV costumam trazer compras positivas);
 * - garante um identificador estável para não duplicar ao reimportar o mesmo arquivo.
 *   Sem FITID/ID, usa hash de data+valor+descrição+ocorrência (duas compras iguais no
 *   mesmo dia continuam sendo duas).
 * - sugere categoria pelas regras.
 */
export function buildImportRows(txs: ParsedTx[], opts: { invert: boolean; rules: Rule[] }): ImportRow[] {
  const seen = new Map<string, number>();
  return txs.map((t) => {
    const amount = opts.invert ? -t.amount : t.amount;
    let externalId = t.externalId;
    if (!externalId) {
      const key = `${t.date}|${t.amount.toFixed(2)}|${normalizeText(t.description)}`;
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      externalId = `hash:${createHash("sha256").update(`${key}|${n}`).digest("hex").slice(0, 32)}`;
    }
    return {
      date: t.date,
      description: t.description,
      amount,
      external_id: externalId,
      category_id: matchCategory(t.description, opts.rules),
    };
  });
}

/** Em cartão, se a maioria dos valores vier positiva, o arquivo trata compra como positivo. */
export function suggestInvert(txs: ParsedTx[], accountKind: string) {
  if (accountKind !== "cartao" || txs.length === 0) return false;
  const positives = txs.filter((t) => t.amount > 0).length;
  return positives / txs.length > 0.5;
}
