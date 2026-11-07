import { describe, expect, it } from "vitest";
import { ageFrom, greetingFor } from "@/lib/format";

describe("ageFrom", () => {
  const now = new Date(2026, 10, 7); // 7/11/2026

  it("conta anos completos", () => {
    expect(ageFrom("2022-03-10", now)).toBe(4);
  });
  it("ainda não fez aniversário no ano", () => {
    expect(ageFrom("2020-12-25", now)).toBe(5);
  });
  it("aniversário hoje conta o ano", () => {
    expect(ageFrom("2020-11-07", now)).toBe(6);
  });
  it("sem data ou data inválida retorna null", () => {
    expect(ageFrom(null, now)).toBeNull();
    expect(ageFrom("abc", now)).toBeNull();
  });
  it("data no futuro retorna null", () => {
    expect(ageFrom("2030-01-01", now)).toBeNull();
  });
});

describe("greetingFor", () => {
  it.each([
    [0, "Bom dia"],
    [11, "Bom dia"],
    [12, "Boa tarde"],
    [17, "Boa tarde"],
    [18, "Boa noite"],
    [23, "Boa noite"],
  ])("%i h → %s", (h, expected) => expect(greetingFor(h)).toBe(expected));
});
