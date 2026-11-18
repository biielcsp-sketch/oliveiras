/** Rótulo da conta nos selects e filtros: "Nome · Dono" (sem dono, só o nome). Diferencia contas de mesmo nome do casal. */
export function accountLabel(account: { name: string; owner_member_id: string | null }, memberNameById: Map<string, string>) {
  const owner = account.owner_member_id ? memberNameById.get(account.owner_member_id) : undefined;
  return owner ? `${account.name} · ${owner}` : account.name;
}
