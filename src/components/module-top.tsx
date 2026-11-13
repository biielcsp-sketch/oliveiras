"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import clsx from "clsx";
import { EllipsisVertical, LayoutDashboard } from "lucide-react";
import { PageTop, topBtn } from "@/components/page-top";
import { MODULE_INFO, activeSectionIndex, moduleTopTitle, type ModuleKey } from "@/lib/module-sections";

/**
 * Topo dos módulos. Na raiz: voltar → Início e o nome do módulo; nas páginas internas: voltar → raiz do módulo
 * e o nome da seção. O ⋮ abre a lista de todas as seções (Esc ou toque fora fecha).
 */
export function ModuleTop({ module: key }: { module: ModuleKey }) {
  const info = MODULE_INFO[key];
  const path = usePathname();
  const isRoot = path === info.root;
  const [open, setOpen] = useState(false);
  const [openedAt, setOpenedAt] = useState(path);
  const boxRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const active = activeSectionIndex(info, path);

  // Trocou de página: o menu fecha.
  if (open && openedAt !== path) setOpen(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  const menu = (
    <div ref={boxRef} className="relative">
      <button
        ref={btnRef}
        type="button"
        className={topBtn}
        aria-label={`Todas as seções de ${info.title}`}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => {
          setOpenedAt(path);
          setOpen((o) => !o);
        }}
      >
        <EllipsisVertical size={22} aria-hidden />
      </button>
      <nav
        id={menuId}
        aria-label={`Todas as seções de ${info.title}`}
        hidden={!open}
        className="glass-card absolute right-0 top-12 z-40 w-60 rounded-[20px] p-2"
      >
        <ul className="flex flex-col">
          <li>
            <Link
              href={info.root}
              aria-current={isRoot ? "page" : undefined}
              className={clsx(
                "flex min-h-11 items-center gap-3 rounded-2xl px-3 text-[14.5px] font-medium transition",
                isRoot ? "bg-accent-soft text-deep" : "hover:bg-accent-soft",
              )}
            >
              <LayoutDashboard size={18} className="text-deep" aria-hidden />
              {info.sections.find((s) => s.href === info.root)?.label ?? "Resumo"}
            </Link>
          </li>
          {info.sections
            .filter((s) => s.href !== info.root)
            .map((s) => {
              const on = info.sections[active]?.key === s.key;
              const Icon = s.icon;
              return (
                <li key={s.key}>
                  <Link
                    href={s.href}
                    aria-current={on ? "page" : undefined}
                    className={clsx(
                      "flex min-h-11 items-center gap-3 rounded-2xl px-3 text-[14.5px] font-medium transition",
                      on ? "bg-accent-soft text-deep" : "hover:bg-accent-soft",
                    )}
                  >
                    <Icon size={18} className="text-deep" aria-hidden />
                    {s.label}
                  </Link>
                </li>
              );
            })}
        </ul>
      </nav>
    </div>
  );

  return (
    <PageTop
      title={moduleTopTitle(info, path)}
      backHref={isRoot ? "/inicio" : info.root}
      backLabel={isRoot ? "Voltar para o Início" : `Voltar para ${info.title}`}
      action={menu}
    />
  );
}
