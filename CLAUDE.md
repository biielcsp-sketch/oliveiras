@AGENTS.md

# Oliveira's

App da família Oliveira Rodrigues: Next.js 16 (App Router) + Supabase (projeto `bzwffrkeylsvqevixyur`) + Vercel. Dados sensíveis (finanças, saúde): segurança vem antes de funcionalidade.

## Fluxo de trabalho

- Tarefa pequena (1 arquivo, mudança simples): faça direto, sem subagentes.
- Tarefa grande ou que cruza front e banco: use o fluxo. O orquestrador não implementa; delega.
- Agentes: `frontend` (src/, public/, testes unitários e E2E), `banco` (supabase/migrations, rollbacks e testes pgTAP), `revisor` (valida no final).
- Delegue com instruções completas, enviando só caminhos de arquivo e trechos relevantes, nunca o histórico da conversa.
- Ao delegar, peça também a lista de outras telas afetadas, sem alterá-las.
- Tarefas independentes rodam em paralelo. Sempre chame o `revisor` no final.
- Se REPROVADO, devolva os problemas só ao agente responsável e revise de novo. Máximo 2 ciclos; depois pare e mostre o pendente.

## Publicação (DevSecOps)

- Nunca faça push direto no `main`. Toda mudança vai num branch `tipo/descricao` e abre PR.
- O PR só entra no `main` (produção na Vercel) com o CI verde: qualidade, segurança do código e app (RLS, E2E, ZAP, Lighthouse).
- Migração em produção (`apply_migration`) só depois do revisor aprovar e do CI passar, e sempre com rollback pronto em `supabase/rollbacks/`.
- `execute_sql` em produção: só `select`.

## Regras de qualidade

- Bug corrigido: teste de regressão automatizado que falha antes da correção e passa depois. Sem ele, a tarefa não está concluída.
- Onde testar:
  - unitário: `tests/unit/*.test.ts` (`npm test`)
  - banco: `supabase/tests/database/*.test.sql` com pgTAP (`npm run db:start` e `npm run test:db`)
  - E2E: `tests/e2e/*.spec.ts` (Playwright contra Supabase local)
- Tabela nova: RLS ligado, políticas por `is_household_member(household_id)` e teste pgTAP provando que outra família não lê nem escreve. O teste `00_helpers` reprova tabela sem RLS.
- Função `security definer`: `set search_path = ''`, valida `auth.uid()`, `revoke` de `public` e `anon`.
- Front: dados do usuário nunca em `dangerouslySetInnerHTML`; servidor usa `auth.getClaims()` (nunca `getSession()`); chave secreta do Supabase nunca no app. O Semgrep (`.semgrep/`) barra esses casos.
- CSP com nonce (`src/lib/security-headers.ts` + proxy): não adicione `unsafe-inline`/`unsafe-eval` em scripts nem domínios externos sem justificar.
- Dry run antes de mudança destrutiva ou estrutural: simule, valide o estado final e só aplique se confirmar.
- Não faça: apagar ou sobrescrever sem olhar o alvo, inventar funcionalidade fora do pedido, publicar sem pedido, mudar produção sem rollback. Pedido arriscado ou ambíguo: pergunte.
- Questione a arquitetura e avise sobre risco (segurança, integridade, dados que somem ou duplicam), mesmo fora do escopo, sem alterar sem aprovação.
- Siga o padrão das decisões anteriores (`git log`, migrações existentes) antes de propor algo novo.
- Este Next.js tem mudanças incompatíveis com versões antigas: consulte `node_modules/next/dist/docs/` antes de usar uma API.
