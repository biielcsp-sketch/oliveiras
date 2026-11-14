import { expect, test } from "@playwright/test";
import { signUp, uniqueEmail, watchConsole } from "./helpers";

/** JPEG real gerado no navegador (canvas), com a largura e altura pedidas. */
async function makeJpeg(page: import("@playwright/test").Page, w: number, h: number) {
  const dataUrl = await page.evaluate(
    ([w, h]) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const g = c.getContext("2d")!;
      g.fillStyle = "#dce8fe";
      g.fillRect(0, 0, w, h);
      g.fillStyle = "#0a5cc8";
      g.fillRect(10, 10, w - 20, 40);
      return c.toDataURL("image/jpeg", 0.9);
    },
    [w, h],
  );
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

test("carteirinha: foto em retrato aparece deitada num quadro de cartão; paisagem não gira", async ({ page }) => {
  const problems = watchConsole(page);
  await signUp(page, uniqueEmail("cart-h"));
  await page.getByLabel("Seu nome").fill("Gabriel");
  await page.locator("form").getByRole("button", { name: "Criar família" }).click();
  await expect(page).toHaveURL(/\/inicio$/);
  await page.goto("/saude");

  const add = async (operator: string, w: number, h: number) => {
    await page.getByRole("button", { name: "Nova carteirinha" }).click();
    const d = page.getByRole("dialog", { name: "Nova carteirinha" });
    await d.getByLabel("Operadora").fill(operator);
    await d
      .getByRole("group", { name: /Arquivo \(PDF ou JPG/ })
      .getByLabel("Imagem", { exact: true })
      .setInputFiles({ name: `${operator}.jpg`, mimeType: "image/jpeg", buffer: await makeJpeg(page, w, h) });
    await d.getByRole("button", { name: "Salvar carteirinha" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Carteirinha salva." })).toBeVisible();
    await expect(d).toBeHidden();
  };
  await add("Retrato Saude", 600, 950);
  await add("Paisagem Saude", 950, 600);

  const card = (op: string) => page.getByTestId("carteirinha").filter({ hasText: op });

  // Quadro com proporção de cartão (~1,586:1) e largura total do card
  for (const op of ["Retrato Saude", "Paisagem Saude"]) {
    const frame = (await card(op).getByTestId("carteirinha-quadro").boundingBox())!;
    const inner = (await card(op).boundingBox())!;
    expect(frame.width / frame.height).toBeCloseTo(1.586, 1);
    expect(frame.width).toBeGreaterThan(inner.width - 48);
  }

  // Retrato: girada -90° e deitada (caixa visível mais larga que alta, dentro do quadro)
  const portrait = card("Retrato Saude").getByRole("img", { name: /Carteirinha Retrato Saude/ });
  await expect(portrait).toHaveAttribute("data-orientation", "retrato");
  const pBox = (await portrait.boundingBox())!;
  const pFrame = (await card("Retrato Saude").getByTestId("carteirinha-quadro").boundingBox())!;
  expect(pBox.width).toBeGreaterThan(pBox.height);
  // Ocupa a área interna do quadro (descontada a borda de 1px de cada lado)
  expect(Math.abs(pBox.width - (pFrame.width - 2))).toBeLessThan(2);
  expect(Math.abs(pBox.height - (pFrame.height - 2))).toBeLessThan(2);
  expect(await portrait.evaluate((e) => getComputedStyle(e).rotate)).toBe("-90deg");

  // Paisagem: sem giro, preenche o quadro
  const landscape = card("Paisagem Saude").getByRole("img", { name: /Carteirinha Paisagem Saude/ });
  await expect(landscape).toHaveAttribute("data-orientation", "paisagem");
  expect(await landscape.evaluate((e) => getComputedStyle(e).rotate)).toBe("none");

  expect(problems).toEqual([]);
});
