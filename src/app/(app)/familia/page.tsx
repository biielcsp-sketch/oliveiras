import Link from "next/link";
import { ArrowLeft, ChevronRight, Fingerprint, Trash2, UserPlus, Users, type LucideIcon } from "lucide-react";
import { getAppContext } from "@/lib/data";
import { ageFrom, initials } from "@/lib/format";
import { Card } from "@/components/ui";
import { SignOutButton } from "@/components/sign-out-button";
import { AddDependentForm } from "./add-dependent-form";
import { PasskeysSection } from "./passkeys";
import { removeDependent } from "./actions";

export const metadata = { title: "Família" };

const RELATION_LABEL = { titular: "Titular", conjuge: "Cônjuge", filho: "Filho(a)", outro: "Dependente" };

function Row({ href, icon: Icon, label }: { href: string; icon: LucideIcon; label: string }) {
  return (
    <li className="border-t border-line first:border-t-0">
      <a href={href} className="flex min-h-12 items-center gap-3.5 px-1 py-3 text-[14px] font-medium text-ink">
        <Icon size={20} className="text-deep" aria-hidden />
        <span className="flex-1">{label}</span>
        <ChevronRight size={18} className="text-muted" aria-hidden />
      </a>
    </li>
  );
}

/** Perfil da família: cabeçalho azul com as iniciais, lista de atalhos e as seções que já existiam. */
export default async function FamiliaPage() {
  const { household, members, user, me } = await getAppContext();
  const hasSpouse = members.filter((m) => m.user_id).length > 1;
  const name = me?.name ?? household.name;

  return (
    <div className="flex flex-col gap-5">
      <header className="relative -mx-4 -mt-[calc(env(safe-area-inset-top)+12px)] h-[calc(244px+env(safe-area-inset-top))] overflow-hidden text-white md:mx-0 md:mt-0 md:h-[244px] md:rounded-[32px]">
        <span aria-hidden="true" className="absolute inset-x-0 top-0 h-[env(safe-area-inset-top)] bg-[#05379A]" />
        <svg aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[244px] w-full" viewBox="0 0 390 244" preserveAspectRatio="none">
          <defs>
            <linearGradient id="familia-pb" x1="0" y1="0" x2=".4" y2="1">
              <stop offset="0" stopColor="#05379A" />
              <stop offset=".6" stopColor="#0A4FBD" />
              <stop offset="1" stopColor="#2C6FD6" />
            </linearGradient>
            <linearGradient id="familia-pw" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#ffffff" stopOpacity=".35" />
              <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d="M0 0H390V226C320 212 270 236 195 236C120 236 70 212 0 226Z" fill="url(#familia-pb)" />
          <path d="M0 210C80 186 140 214 195 214C250 214 310 186 390 210V226C320 212 270 236 195 236C120 236 70 212 0 226Z" fill="url(#familia-pw)" />
        </svg>
        <div className="absolute inset-x-0 bottom-0 h-[244px]">
          <Link
            href="/inicio"
            aria-label="Voltar para o Início"
            className="absolute left-3 top-3.5 grid size-11 place-items-center rounded-full text-white transition hover:bg-white/15"
          >
            <ArrowLeft size={22} aria-hidden />
          </Link>
          <div className="absolute inset-x-4 top-[46px] flex flex-col items-center text-center">
            <span
              aria-hidden="true"
              className="grid size-[84px] place-items-center rounded-full border-[3px] border-white/90 bg-[linear-gradient(160deg,#ffffff,#dce8fe)] text-[28px] font-bold text-[#023a90] shadow-[0_8px_18px_rgb(0_20_70/0.3)]"
            >
              {initials(name)}
            </span>
            <h1 className="mt-3 max-w-full truncate text-[19px] font-semibold">{name}</h1>
            <p className="mt-0.5 max-w-full truncate text-[13px] opacity-90">{user.email || household.name}</p>
          </div>
        </div>
      </header>

      <nav aria-label="Opções da família" className="glass-card rounded-[20px] px-3.5 py-0.5">
        <ul>
          <Row href="#membros" icon={Users} label="Membros" />
          <Row href="#dependente" icon={UserPlus} label="Adicionar dependente" />
          {!hasSpouse && <Row href="#convidar" icon={UserPlus} label="Convidar sua esposa" />}
          <Row href="#digital" icon={Fingerprint} label="Entrar com digital" />
          <li className="border-t border-line">
            <SignOutButton variant="row" />
          </li>
        </ul>
      </nav>

      <Card id="membros" className="scroll-mt-4">
        <h2 className="font-semibold">Membros</h2>
        <p className="mt-0.5 text-[13px] text-muted">{household.name}</p>
        <ul className="mt-3 divide-y divide-line">
          {members.map((m) => {
            const a = ageFrom(m.birth_date);
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
                      className="grid size-11 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-danger"
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

      <Card id="dependente" className="scroll-mt-4">
        <h2 className="font-semibold">Adicionar dependente</h2>
        <p className="mb-4 mt-1 text-sm text-muted">Para quem não tem login, como o seu filho.</p>
        <AddDependentForm />
      </Card>

      {!hasSpouse && (
        <Card id="convidar" className="scroll-mt-4">
          <h2 className="font-semibold">Convidar sua esposa</h2>
          <p className="mt-1 text-sm text-muted">
            Ela cria a conta no app e, na tela de boas-vindas, escolhe &quot;Entrar com código&quot;.
          </p>
          <p className="mt-4 select-all rounded-2xl bg-surface-2 py-3 text-center font-mono text-2xl tracking-[0.3em]">
            {household.invite_code}
          </p>
        </Card>
      )}

      <div id="digital" className="scroll-mt-4">
        <PasskeysSection />
      </div>
    </div>
  );
}
