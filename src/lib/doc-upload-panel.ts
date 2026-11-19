/** Regras puras do painel compacto "Ler PDF ou foto" (botões redondos do Resumo). */

/** Botões visíveis na linha: "Documentos" só quando a tela mostra o link da lista. */
export function docUploadButtons(showListLink: boolean): readonly ("ler" | "documentos")[] {
  return showListLink ? ["ler", "documentos"] : ["ler"];
}

/** Texto do contador vermelho; vazio quando não há pendentes (ou valor inválido). */
export function pendingBadgeText(count: number | undefined): string {
  if (!count || !Number.isFinite(count) || count < 1) return "";
  return count > 99 ? "99+" : String(Math.floor(count));
}

/** Nome acessível do link "Documentos", com o número de pendentes por extenso. */
export function documentsAriaLabel(count: number | undefined): string {
  const n = count && Number.isFinite(count) && count >= 1 ? Math.floor(count) : 0;
  return n ? `Documentos, ${n} pendente${n > 1 ? "s" : ""}` : "Documentos";
}
