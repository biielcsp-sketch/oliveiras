export type Theme = "light" | "dark";

export const THEME_COOKIE = "tema";

/** Aceita só os dois valores válidos; qualquer outra coisa vira "seguir o aparelho". */
export function parseTheme(value: string | undefined | null): Theme | null {
  return value === "light" || value === "dark" ? value : null;
}

export function nextTheme(current: Theme): Theme {
  return current === "dark" ? "light" : "dark";
}

/** Cor da barra do navegador/PWA (igual ao --bg de cada tema). */
export const THEME_COLOR: Record<Theme, string> = { light: "#eef3fd", dark: "#0a1226" };
