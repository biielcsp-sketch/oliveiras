-- Segunda conta Meu Pluggy (Karen): itens criados em outra conta Meu Pluggy dão 404
-- com as credenciais erradas. Cada item passa a dizer de qual conta vem; o servidor
-- escolhe o par de credenciais (variáveis de ambiente) por esse valor.
-- Aditiva: linhas existentes viram 'principal'. Nenhum segredo é guardado no banco.
-- RLS e políticas de fin_pluggy_items não mudam (política "for all" por household_id
-- e grants são por tabela, então cobrem a coluna nova).
alter table public.fin_pluggy_items
  add column credential text not null default 'principal'
  check (credential in ('principal', 'karen'));
