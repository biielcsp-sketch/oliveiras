import type { ModuleDef } from "@/lib/modules";
import { Card, PageHeader, Tag } from "@/components/ui";

/** Tela de módulo ainda não construído: mostra em qual fase ele entra. */
export function ModulePlaceholder({ module, items }: { module: ModuleDef; items: string[] }) {
  const Icon = module.icon;
  return (
    <>
      <PageHeader title={module.label} subtitle={module.description} />
      <Card className="flex flex-col items-start gap-5">
        <div className="flex w-full items-start justify-between gap-3">
          <span className="grid size-12 place-items-center rounded-full border border-line bg-accent-soft text-primary">
            <Icon size={22} aria-hidden />
          </span>
          <Tag>Fase {module.phase}</Tag>
        </div>
        <div>
          <p className="text-lg font-semibold tracking-tight">Chega na fase {module.phase}</p>
          <p className="mt-1 text-sm text-muted">O que vai ter aqui:</p>
        </div>
        <ul className="grid w-full gap-3 text-[15px] sm:grid-cols-2">
          {items.map((item) => (
            <li key={item} className="rounded-2xl bg-surface-2 px-4 py-3">
              {item}
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
