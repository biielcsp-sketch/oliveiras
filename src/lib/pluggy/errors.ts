import { credentialOwner, type PluggyCredential } from "./credentials";

/** Erros da API da Pluggy, com o motivo para mostrar ao usuário sem expor credenciais. */
export type PluggyErrorKind = "auth" | "forbidden" | "not_found" | "http" | "invalid";

export class PluggyError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly kind: PluggyErrorKind = "http",
    readonly credential?: PluggyCredential,
  ) {
    super(message);
  }
}

/** Mensagem para a tela. Distingue credencial recusada, item de outra aplicação, Pluggy fora do ar e rede. */
export function pluggyErrorMessage(e: unknown): string {
  if (e instanceof PluggyError) {
    const owner = e.credential ? credentialOwner(e.credential) : null;
    switch (e.kind) {
      case "auth":
        if (e.status === undefined) return `${e.message} Cadastre as variáveis na Vercel e faça um novo deploy.`;
        if (!owner) return "A Pluggy recusou as credenciais do servidor. Confira se PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET são da mesma aplicação e faça um novo deploy.";
        return `A Pluggy recusou as credenciais ${owner}. Confira se o Client ID e o Secret dessa conta (variáveis ${e.credential === "karen" ? "PLUGGY_CLIENT_ID_KAREN e PLUGGY_CLIENT_SECRET_KAREN" : "PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET"}) são da mesma aplicação e faça um novo deploy.`;
      case "forbidden":
        return "A Pluggy negou acesso a este item. Ele provavelmente pertence a outra aplicação: escolha a conta do Meu Pluggy certa e copie o id em Connected Items dela.";
      case "not_found":
        return owner
          ? `Item não encontrado nas credenciais ${owner}. Confira se escolheu a conta do Meu Pluggy certa (Gabriel ou Karen) e se copiou o id do item dessa conta.`
          : "Item não encontrado na Pluggy. Confira se escolheu a conta do Meu Pluggy certa e se copiou o id do item.";
      case "invalid":
        return "A Pluggy respondeu de forma inesperada. Tente de novo.";
      default:
        return e.status && e.status >= 500
          ? `A Pluggy está com instabilidade (erro ${e.status}). Tente de novo em alguns minutos.`
          : `A Pluggy recusou o pedido (erro ${e.status ?? "desconhecido"}).`;
    }
  }
  if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
    return "A Pluggy demorou demais para responder. Tente de novo.";
  }
  return "Não foi possível falar com a Pluggy agora. Tente de novo.";
}

/** Linha de log sem dados sensíveis (só tipo, status e mensagem fixa do erro). */
export function pluggyErrorLog(e: unknown): string {
  if (e instanceof PluggyError) return `[pluggy] kind=${e.kind} status=${e.status ?? "-"}${e.credential ? ` credential=${e.credential}` : ""} msg=${e.message}`;
  if (e instanceof Error) return `[pluggy] ${e.name}: ${e.message}`;
  return "[pluggy] erro desconhecido";
}
