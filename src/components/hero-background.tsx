/** Onda do fim do cabeçalho azul (viewBox 390x360), a mesma no Início e nos módulos. */
export const WAVE_PATH = "M0 0H390V318C346 312 300 322 252 336Q214 348 195 350Q176 348 138 336C90 322 44 312 0 318Z";

/**
 * Fundo do cabeçalho azul, o mesmo em todas as telas (Início e módulos): gradiente suave, um clarão discreto e
 * a mesma onda no fim. Altura fixa (350px, ancorado embaixo) para a onda ter sempre o mesmo desenho e proporção.
 * A faixa da área segura do topo (notch) recebe a cor do topo do gradiente. Só decoração.
 */
export function HeroBackground() {
  return (
    <>
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-[env(safe-area-inset-top)] bg-[#0A44A8]" />
      <svg aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[350px] w-full" viewBox="0 0 390 360" preserveAspectRatio="none" data-testid="hero-wave">
        <defs>
          <linearGradient id="hero-bg" x1="0" y1="0" x2=".2" y2="1">
            <stop offset="0" stopColor="#0A44A8" />
            <stop offset="1" stopColor="#2A6BD0" />
          </linearGradient>
          <radialGradient id="hero-glow" cx=".9" cy=".25" r=".55">
            <stop offset="0" stopColor="#9CC4FF" stopOpacity=".22" />
            <stop offset="1" stopColor="#9CC4FF" stopOpacity="0" />
          </radialGradient>
        </defs>
        {/* Onda: laterais um pouco mais altas, desce em curva suave até o meio */}
        <path d={WAVE_PATH} fill="url(#hero-bg)" />
        <path d={WAVE_PATH} fill="url(#hero-glow)" />
      </svg>
    </>
  );
}
