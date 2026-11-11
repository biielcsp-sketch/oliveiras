/** Decide o resultado da exclusão da conta fixa a partir da resposta do Supabase (`delete().select("id")`). */
export type BillDeleteResult = { ok: true } | { ok: false; error: string };

export function billDeleteResult(res: { error: unknown; data: { id: string }[] | null | undefined }): BillDeleteResult {
  if (res.error) return { ok: false, error: "Não foi possível excluir a conta. Nada foi apagado; tente de novo." };
  if (!res.data?.length) return { ok: false, error: "A conta não foi encontrada (talvez já tenha sido excluída). Nada foi apagado." };
  return { ok: true };
}
