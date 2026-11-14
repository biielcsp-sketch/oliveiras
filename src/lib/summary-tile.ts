/**
 * Linhas exibidas no card de resumo (SummaryTile): no máximo 2 blocos.
 * Alertas vêm primeiro, juntos no bloco 1 (que pode quebrar em até 2 linhas), em ordem de `rank` (menor primeiro:
 * alertas curtos e fixos antes dos de texto livre, para nenhum ficar escondido no corte); o resto vai no bloco 2.
 * Sem alertas: bloco 1 = primeira informação, bloco 2 = as demais (cada um em 1 linha).
 */
export function tileRows(
  lines: string[],
  isAlert: (line: string) => boolean = () => false,
  rank: (line: string) => number = () => 0,
): string[] {
  const alerts = lines.filter(isAlert).sort((a, b) => rank(a) - rank(b));
  const rest = lines.filter((l) => !isAlert(l));
  const rows = alerts.length ? [alerts.join(" · "), rest.join(" · ")] : [rest[0] ?? "", rest.slice(1).join(" · ")];
  return rows.filter(Boolean);
}

/** Alertas do card do Pet: dose atrasada, cuidados vencidos (1 ou mais) e ração acabando. */
export const isPetAlert = (line: string) =>
  line.startsWith("Dose atrasada") || /^[1-9]\d* cuidados? vencidos?$/.test(line) || line.startsWith("Ração acabando");

/** Ordem dos alertas do Pet: curtos/fixos primeiro (cuidados vencidos, ração acabando); a dose atrasada (nome livre) por último. */
export const petAlertRank = (line: string) => (line.startsWith("Dose atrasada") ? 2 : line.startsWith("Ração acabando") ? 1 : 0);

/**
 * Linhas do card do Pet para o resumo: a próxima dose atrasada ("Próxima dose: X (atrasada há N dias)", de petSummary)
 * vira "Dose atrasada há N dias: X", com o status antes do nome para o corte em 1 linha não esconder o atraso.
 */
export function petTileLines(lines: string[]): string[] {
  return lines.map((l) => {
    const m = l.match(/^Próxima dose: (.+) \((atrasada há \d+ dias?)\)$/);
    return m ? `Dose ${m[2]}: ${m[1]}` : l;
  });
}
