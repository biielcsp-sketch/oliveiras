-- Rollback de 0016. Apaga fin_baixa_dismissals (as recusas/desfeitas somem e o
-- cruzamento volta a sugerir esses pares) e a coluna fin_bill_payments.auto
-- (as baixas continuam; só se perde a marca de quais foram automáticas).
-- Faça backup antes se essa informação importar.
drop table if exists public.fin_baixa_dismissals;
alter table public.fin_bill_payments drop column if exists auto;
