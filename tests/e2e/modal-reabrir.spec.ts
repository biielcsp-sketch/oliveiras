import { expect, test } from "@playwright/test";
import { signUp, uniqueEmail, watchConsole } from "./helpers";

/**
 * Regressão (src/components/modal.tsx): o evento "close" do <dialog> chega numa tarefa assíncrona.
 * Se o modal for fechado e reaberto antes dele chegar, o "close" atrasado não pode fechar o modal novo.
 */
test("modal fechado e reaberto antes do evento close continua aberto", async ({ page }) => {
  const problems = watchConsole(page);
  await signUp(page, uniqueEmail("modal"));
  await page.getByLabel("Seu nome").fill("Gabriel");
  await page.locator("form").getByRole("button", { name: "Criar família" }).click();
  await expect(page).toHaveURL(/\/inicio$/);

  await page.goto("/saude");
  const open = page.getByRole("button", { name: "Nova carteirinha" });
  await open.click();
  const dialog = page.getByRole("dialog", { name: "Nova carteirinha" });
  await expect(dialog).toBeVisible();

  // Fecha pelo X e, assim que o <dialog> perde o "open" (microtarefa do MutationObserver, antes da tarefa que
  // dispara o "close"), toca de novo em "Nova carteirinha": o "close" do fechamento chega com o modal já reaberto.
  const result = await page.evaluate(
    () =>
      new Promise<{ closeFiredBeforeReopen: boolean; openAfter: boolean }>((resolve) => {
        const d = document.querySelector("dialog[open]") as HTMLDialogElement;
        let closeFired = false;
        d.addEventListener("close", () => (closeFired = true), { once: true });
        const reopen = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Nova carteirinha") && !d.contains(b))!;
        const mo = new MutationObserver(() => {
          if (d.open) return;
          mo.disconnect();
          const before = closeFired;
          reopen.click();
          setTimeout(() => resolve({ closeFiredBeforeReopen: before, openAfter: d.open }), 500);
        });
        mo.observe(d, { attributes: true, attributeFilter: ["open"] });
        (d.querySelector('button[aria-label="Fechar"]') as HTMLButtonElement).click();
      }),
  );
  // Cenário da corrida garantido: reabriu antes do "close"; depois dele, o modal reaberto continua aberto.
  expect(result).toEqual({ closeFiredBeforeReopen: false, openAfter: true });
  await expect(dialog).toBeVisible();
  expect(problems).toEqual([]);
});
