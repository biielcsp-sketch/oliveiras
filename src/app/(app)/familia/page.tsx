import { LogOut, Trash2 } from "lucide-react";
import { getAppContext } from "@/lib/data";
import { Button, Card, PageHeader } from "@/components/ui";
import { AddDependentForm } from "./add-dependent-form";
import { removeDependent, signOut } from "./actions";

export const metadata = { title: "Família" };

const RELATION_LABEL = { titular: "Titular", conjuge: "Cônjuge", filho: "Filho(a)", outro: "Dependente" };

function age(birth: string | null) {
  if (!birth) return null;
  const b = new Date(birth + "T12:00:00");
  const now = new Date();
  let years = now.getFullYear() - b.getFullYear();
  if (now < new Date(now.getFullYear(), b.getMonth(), b.getDate())) years--;
  return years;
}

export default async function FamiliaPage() {
  const { household, members, user } = await getAppContext();
  const hasSpouse = members.filter((m) => m.user_id).length > 1;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Família" subtitle={household.name} />

      <Card>
        <h2 className="font-medium">Membros</h2>
        <ul className="mt-3 divide-y divide-line">
          {members.map((m) => {
            const a = age(m.birth_date);
            return (
              <li key={m.id} className="flex items-center gap-3 py-3">
                <span
                  className="grid size-9 shrink-0 place-items-center rounded-full text-sm font-medium text-white"
                  style={{ background: m.color }}
                >
                  {m.name.charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {m.name}
                    {m.user_id === user.id && <span className="ml-1.5 text-xs text-muted">(você)</span>}
                  </p>
                  <p className="text-[13px] text-muted">
                    {RELATION_LABEL[m.relation]}
                    {a !== null && ` · ${a} ${a === 1 ? "ano" : "anos"}`}
                    {!m.user_id && " · sem login"}
                  </p>
                </div>
                {!m.user_id && (
                  <form action={removeDependent}>
                    <input type="hidden" name="id" value={m.id} />
                    <button
                      aria-label={`Remover ${m.name}`}
                      className="grid size-9 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-danger"
                    >
                      <Trash2 size={16} />
                    </button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card>
        <h2 className="font-medium">Adicionar dependente</h2>
        <p className="mb-4 mt-1 text-sm text-muted">Para quem não tem login, como o seu filho.</p>
        <AddDependentForm />
      </Card>

      {!hasSpouse && (
        <Card>
          <h2 className="font-medium">Convidar sua esposa</h2>
          <p className="mt-1 text-sm text-muted">
            Ela cria a conta no app e, na tela de boas-vindas, escolhe &quot;Entrar com código&quot;.
          </p>
          <p className="mt-4 select-all rounded-xl bg-surface-2 py-3 text-center font-mono text-2xl tracking-[0.3em]">
            {household.invite_code}
          </p>
        </Card>
      )}

      <form action={signOut}>
        <Button variant="ghost" className="w-full">
          <LogOut size={16} /> Sair
        </Button>
      </form>
    </div>
  );
}
