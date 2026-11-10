"use client";

import Link from "next/link";
import clsx from "clsx";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { LucideIcon } from "lucide-react";
import { arcPlacement, clampIndex, dragToPosition } from "@/lib/arc-nav";

export type ArcItem = { key: string; label: string; icon: LucideIcon; href?: string };

const ITEM_W = 96;

/**
 * Menu em ferradura: botões redondos num arco que desliza para os lados.
 * O botão no centro (ponto mais baixo do arco) é o selecionado e ganha o contorno.
 * Ao soltar o arraste, o centralizado vira o ativo (`onChange`) sem precisar tocar nele.
 */
export function ArcNav({
  items,
  active,
  onChange,
  label,
  fallback = 0,
}: {
  items: ArcItem[];
  active: number;
  onChange: (index: number) => void;
  label: string;
  /** Botão do centro quando `active` é -1 (página fora das abas). */
  fallback?: number;
}) {
  // -1: página fora das abas; centraliza o `fallback`, sem marcar nenhuma como atual
  const home = active >= 0 ? active : fallback;
  const wrapRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);
  const pos = useRef(home);
  const target = useRef(home);
  const raf = useRef(0);
  const width = useRef(0);
  const drag = useRef<{ x: number; start: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [centered, setCentered] = useState(home);
  const max = items.length - 1;

  const layout = useCallback(() => {
    const w = width.current;
    itemRefs.current.forEach((el, i) => {
      if (!el) return;
      const p = arcPlacement(i - pos.current, w);
      el.style.transform = `translate(${w / 2 + p.x - ITEM_W / 2}px, ${p.y}px)`;
      el.style.opacity = String(p.opacity);
      el.style.pointerEvents = p.opacity < 0.3 ? "none" : "auto";
    });
    setCentered(clampIndex(Math.round(pos.current), max));
  }, [max]);

  const animate = useCallback(() => {
    cancelAnimationFrame(raf.current);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const step = () => {
      if (drag.current) return;
      const diff = target.current - pos.current;
      pos.current = reduce || Math.abs(diff) < 0.002 ? target.current : pos.current + diff * 0.2;
      layout();
      if (pos.current !== target.current) raf.current = requestAnimationFrame(step);
    };
    step();
  }, [layout]);

  // Mede a largura e acompanha mudanças (rotação, desktop)
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      width.current = el.clientWidth;
      layout();
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf.current);
    };
  }, [layout]);

  // Aba ativa mudou (rota ou toque): leva o botão dela ao centro
  useEffect(() => {
    if (drag.current) return;
    target.current = home;
    animate();
  }, [home, animate]);

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    cancelAnimationFrame(raf.current);
    drag.current = { x: e.clientX, start: pos.current, moved: false };
  }

  useEffect(() => {
    function move(e: globalThis.PointerEvent) {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.x;
      if (Math.abs(dx) > 6) d.moved = true;
      if (!d.moved) return;
      pos.current = dragToPosition(d.start, dx, max);
      layout();
    }
    function up() {
      const d = drag.current;
      if (!d) return;
      drag.current = null;
      if (!d.moved) return;
      suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false), 0);
      const next = clampIndex(Math.round(pos.current), max);
      target.current = next;
      animate();
      if (next !== active) onChange(next);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [active, home, animate, layout, max, onChange]);

  // Foco pelo teclado: leva o item focado ao centro para ele ficar visível
  function focusItem(i: number) {
    if (drag.current) return;
    target.current = i;
    animate();
  }
  function blurItem() {
    if (drag.current) return;
    target.current = home;
    animate();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    // Parte do item focado (pode não ser o ativo, se a pessoa navegou com Tab)
    const focused = itemRefs.current.findIndex((el) => el === document.activeElement);
    const base = focused >= 0 ? focused : home;
    const next = clampIndex(base + (e.key === "ArrowRight" ? 1 : -1), max);
    if (next !== active) onChange(next);
    requestAnimationFrame(() => itemRefs.current[next]?.focus());
  }

  return (
    <nav aria-label={label} className="-mx-5 md:mx-0">
      <div
        ref={wrapRef}
        onPointerDown={onPointerDown}
        onClickCapture={(e) => {
          if (suppressClick.current) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        onKeyDown={onKeyDown}
        onDragStart={(e) => e.preventDefault()}
        className="relative h-[156px] touch-pan-y select-none overflow-x-clip"
      >
        <ul>
          {items.map((item, i) => {
            const Icon = item.icon;
            const isCentered = i === centered;
            const content = (
              <>
                <span
                  className={clsx(
                    "glass-orb grid size-[62px] place-items-center rounded-full text-white transition-[outline-color,box-shadow]",
                    "outline-[2.5px] outline-offset-[4px]",
                    isCentered ? "outline-solid outline-white" : "outline-solid outline-transparent",
                  )}
                  data-selected={isCentered}
                >
                  <Icon size={25} strokeWidth={1.8} aria-hidden />
                </span>
                <span className={clsx("text-on-image text-center text-[12.5px] leading-tight text-white", isCentered ? "font-semibold" : "font-medium")}>
                  {item.label}
                </span>
              </>
            );
            const cls =
              // Começa invisível: o JS posiciona no arco e acende (style inline via JS é permitido pela CSP; atributo style no HTML não)
              "absolute left-0 top-0 flex w-[96px] flex-col items-center gap-2.5 rounded-2xl pt-1 opacity-0 focus-visible:outline-white will-change-transform";
            return (
              <li key={item.key}>
                {item.href ? (
                  <Link
                    href={item.href}
                    ref={(el) => {
                      itemRefs.current[i] = el;
                    }}
                    aria-current={i === active ? "page" : undefined}
                    onFocus={() => focusItem(i)}
                    onBlur={blurItem}
                    draggable={false}
                    className={cls}
                  >
                    {content}
                  </Link>
                ) : (
                  <button
                    type="button"
                    ref={(el) => {
                      itemRefs.current[i] = el;
                    }}
                    aria-pressed={i === active}
                    onFocus={() => focusItem(i)}
                    onBlur={blurItem}
                    onClick={() => onChange(i)}
                    className={cls}
                  >
                    {content}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
