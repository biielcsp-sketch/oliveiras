import clsx from "clsx";
import type { CSSProperties } from "react";

export type OliSphereState = "idle" | "listen" | "think" | "speak";

/**
 * Oli: esfera animada só com CSS (classes .oli/.w1/.w2/.w3 em globals.css), sem imagem nem WebGL.
 * `size`: diâmetro em px. `state` muda o ritmo (ouvindo, pensando, falando).
 * Sem `label` a esfera é decorativa (aria-hidden); com `label` vira imagem acessível.
 */
export function OliSphere({
  size = 54,
  state = "idle",
  label,
  className,
}: {
  size?: number;
  state?: OliSphereState;
  label?: string;
  className?: string;
}) {
  const style = { "--s": `${size}px` } as CSSProperties;
  return (
    <span
      className={clsx("oli", className)}
      data-state={state}
      data-testid="oli-sphere"
      style={style}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      <span className="w1" />
      <span className="w2" />
      <span className="w3" />
    </span>
  );
}
