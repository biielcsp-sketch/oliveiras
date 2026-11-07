import type { ModuleDef } from "@/lib/modules";
import { Card, PageHeader } from "@/components/ui";

/** Tela de módulo ainda não construído: mostra em qual fase ele entra. */
export function ModulePlaceholder({ module, items }: { module: ModuleDef; items: string[] }) {
  const Icon = module.icon;
  return (
    <>
      <PageHeader title={module.label} subtitle={module.description} />
      <Card className="flex flex-col items-start gap-4">
        <span className="grid size-11 place-items-center rounded-xl bg-olive-soft text-olive">
          <Icon size={22} />
        </span>
        <div>
          <p className="font-medium">Chega na fase {module.phase}</p>
          <p className="mt-1 text-sm text-muted">O que vai ter aqui:</p>
        </div>
        <ul className="grid w-full gap-2 text-sm sm:grid-cols-2">
          {items.map((item) => (
            <li key={item} className="rounded-xl bg-surface-2 px-3 py-2.5">
              {item}
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
