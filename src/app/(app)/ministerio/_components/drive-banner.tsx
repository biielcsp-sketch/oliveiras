import { Card, LinkButton } from "@/components/ui";
import type { DriveAccess } from "@/lib/google/drive";

/** Avisos da volta do Google (?google=…), sem repetir nada da URL na tela. */
export function googleNotice(code: string | undefined): { tone: "ok" | "erro"; text: string } | null {
  switch (code) {
    case "conectado":
      return { tone: "ok", text: "Google Drive conectado." };
    case "sem-drive":
      return { tone: "erro", text: "O Google Drive não foi autorizado. Toque em “Conectar Google Drive” e deixe marcada a permissão do Drive." };
    case "cancelado":
      return { tone: "erro", text: "Conexão cancelada." };
    case "permissoes":
      return { tone: "erro", text: "Faltaram permissões do Google. Tente de novo e deixe todas marcadas." };
    case "em-uso":
      return { tone: "erro", text: "Esta conta Google já está ligada a outra pessoa da família." };
    case "nao-configurado":
      return { tone: "erro", text: "O Google ainda não foi configurado no servidor." };
    case "erro":
      return { tone: "erro", text: "Não foi possível conectar ao Google. Tente de novo." };
    default:
      return null;
  }
}

/**
 * Situação do Google Drive do usuário no Carisma. O Drive é opcional (escopo extra drive.file, pedido só aqui);
 * a Agenda continua funcionando sem ele. O link refaz o consentimento e volta para o Carisma.
 */
export function DriveBanner({ access, notice }: { access: DriveAccess; notice: { tone: "ok" | "erro"; text: string } | null }) {
  const connect = (
    <LinkButton href="/api/google/connect?drive=1" className="mt-3 w-fit">
      {access === "sem-conta" ? "Conectar conta Google" : access === "revogado" ? "Reconectar Google" : "Conectar Google Drive"}
    </LinkButton>
  );
  return (
    <>
      {notice && (
        <p role={notice.tone === "erro" ? "alert" : "status"} className={`text-sm ${notice.tone === "erro" ? "text-danger" : "text-primary"}`}>
          {notice.text}
        </p>
      )}
      {access !== "ok" && (
        <Card data-testid="drive-banner">
          <p className="font-medium">
            {access === "sem-conta"
              ? "Conecte sua conta Google para guardar os arquivos das aulas"
              : access === "revogado"
                ? "O Google recusou o acesso da sua conta"
                : "Falta conectar o Google Drive"}
          </p>
          <p className="mt-1 text-sm text-muted">
            {access === "sem-conta"
              ? "Os PDFs, documentos do Word e fotos das aulas ficam numa pasta “Oliveira's / Carisma” no SEU Google Drive. Ao conectar, o Google pede a Agenda e o Drive; o app só enxerga os arquivos que ele mesmo criou."
              : access === "revogado"
                ? "Reconecte para voltar a enviar e abrir os arquivos das aulas."
                : "Sua conta Google já está ligada para a Agenda. Para guardar arquivos das aulas, autorize também o Google Drive (o app só enxerga os arquivos que ele mesmo criou)."}
          </p>
          {connect}
        </Card>
      )}
    </>
  );
}
