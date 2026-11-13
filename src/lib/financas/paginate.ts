/**
 * Busca paginada de lançamentos. O PostgREST corta cada resposta em `max_rows` (1000 no Supabase) sem
 * avisar, e `.limit(n)` acima disso também volta só 1000; somar só a primeira página deixava totais,
 * categorias e orçamento errados em meses com mais lançamentos. Aqui as páginas vêm por `.range()`,
 * com ordem estável (quem chama ordena por data e id), até o fim do período ou até o teto.
 */

/** Tamanho da página: igual ao `max_rows` do PostgREST (supabase/config.toml), para nunca vir cortada. */
export const TX_PAGE_SIZE = 1000;
/** Teto de segurança por consulta (20 páginas). Acima dele a lista vem marcada como incompleta. */
export const TX_MAX_ROWS = 20_000;

export type Page<T> = { data: T[] | null; error: unknown };

/** Lista com a marca `incomplete` (não enumerável: some ao serializar, fatiar ou espalhar a lista). */
export type TxList<T> = T[] & { readonly incomplete: boolean };

export function markList<T>(rows: T[], incomplete: boolean): TxList<T> {
  return Object.defineProperty(rows, "incomplete", { value: incomplete, enumerable: false }) as TxList<T>;
}

/**
 * Lê todas as páginas de `fetchPage(from, to)` (intervalo inclusivo, como `.range()`).
 * Avança pelo número de linhas realmente recebidas e só para com página vazia: se o servidor tiver um
 * `max_rows` menor que a página pedida, uma página "curta" não é tomada como fim da lista.
 * `incomplete` = passou do teto ou alguma página falhou: os dados lidos voltam, mas não são o total.
 */
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<Page<T>>,
  opts: { pageSize?: number; maxRows?: number } = {},
): Promise<{ rows: T[]; incomplete: boolean }> {
  const pageSize = opts.pageSize ?? TX_PAGE_SIZE;
  const maxRows = opts.maxRows ?? TX_MAX_ROWS;
  const rows: T[] = [];
  while (rows.length < maxRows) {
    const from = rows.length;
    const to = Math.min(from + pageSize, maxRows) - 1;
    const { data, error } = await fetchPage(from, to);
    if (error) return { rows, incomplete: true };
    const page = (data ?? []).slice(0, to - from + 1);
    if (page.length === 0) return { rows, incomplete: false };
    rows.push(...page);
  }
  // Chegou no teto: confere se ainda havia mais lançamentos depois dele.
  const { data, error } = await fetchPage(maxRows, maxRows);
  return { rows, incomplete: Boolean(error) || (data ?? []).length > 0 };
}
