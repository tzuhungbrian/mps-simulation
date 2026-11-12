import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) =>
  page.addInitScript(() =>
    sessionStorage.setItem("structured-light.view-mode", "guided"),
  ),
);

test("預設逐步教學：先知道目的，再從照片、亮度走到相位", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "三張照片，算出條紋的位置。" }),
  ).toBeVisible();
  await expect(
    page.getByText("Phase 是條紋內的位置，不是物體高度。", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Fringe frequency")).not.toBeVisible();
  await expect(page.getByTestId("phase-map")).not.toBeVisible();
  await page
    .getByRole("button", { name: "開始：先看三張照片", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "第 1 步：同一個場景，拍三次。" }),
  ).toBeVisible();
  await expect(page.getByTestId("guide-capture-0")).toBeVisible();
  const image = await page
    .getByTestId("guide-capture-0")
    .evaluate((c: HTMLCanvasElement) => c.toDataURL());
  await page
    .getByRole("button", { name: "把條紋往右移一點", exact: true })
    .click();
  expect(
    await page
      .getByTestId("guide-capture-0")
      .evaluate((c: HTMLCanvasElement) => c.toDataURL()),
  ).not.toBe(image);
  await page
    .getByRole("button", { name: "下一步：讀取一個像素", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "第 2 步：讀同一個點的三次亮度。" }),
  ).toBeVisible();
  const previous = await page.getByTestId("guide-probe-values").textContent();
  await page
    .getByRole("button", { name: "換一個像素看看", exact: true })
    .click();
  await expect(page.getByTestId("guide-probe-values")).not.toHaveText(
    previous!,
  );
  await page
    .getByRole("button", { name: "下一步：算出 Phase", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "第 3 步：三個亮度，換成一個 Phase。" }),
  ).toBeVisible();
  await expect(page.getByTestId("guide-phase-value")).not.toHaveText("N/A");
  await expect(
    page.getByTestId("guide-phase-chart").locator("path"),
  ).toHaveCount(1);
  await page
    .getByRole("button", { name: "把跳變接起來（1D Unwrap）", exact: true })
    .click();
  await expect(
    page.getByTestId("guide-phase-chart").locator("path"),
  ).toHaveCount(2);
  await expect(
    page.getByText("接起來的是相對 Phase，還不能當作深度。", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "自由實驗", exact: true })
    .first()
    .click();
  await expect(page.getByLabel("Fringe frequency")).toBeVisible();
  await expect(page.getByTestId("valid-ratio")).toHaveText("100.0%");
  expect(errors).toEqual([]);
});

for (const width of [390, 620, 1440]) {
  test(`文字與操作在 ${width}px 寬度仍可讀`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 });
    await page.goto("/");
    const intro = page.getByTestId("lesson-intro");
    await expect(intro).toBeVisible();
    expect(
      await intro.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
    ).toBeGreaterThanOrEqual(17);
    const start = page.getByRole("button", {
      name: "開始：先看三張照片",
      exact: true,
    });
    expect((await start.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await start.click();
    await page
      .getByRole("button", { name: "下一步：讀取一個像素", exact: true })
      .click();
    expect(
      await page
        .getByTestId("guide-intensity-chart")
        .locator(".chart-tick")
        .first()
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
    ).toBeGreaterThanOrEqual(14);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page
      .getByRole("button", { name: "自由實驗", exact: true })
      .first()
      .click();
    expect(
      await page
        .getByLabel("Fringe frequency")
        .locator("..")
        .locator("label")
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
    ).toBeGreaterThanOrEqual(16);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

test("教學每一步旁有同步的 3D 示意，連到相位的候選光平面", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page
    .getByRole("button", { name: "開始：先看三張照片", exact: true })
    .click();
  const canvas = page.getByTestId("lesson-scene-canvas");
  await expect(canvas).toBeVisible();
  const caption = page.getByTestId("lesson-scene-caption");
  await expect(caption).toContainText("Camera 拍到的範圍");
  await page.getByRole("button", { name: "I1 · 0°", exact: true }).click();
  const first = await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL());
  await page.getByRole("button", { name: "I2 · 120°", exact: true }).click();
  await expect
    .poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL()))
    .not.toBe(first);
  await page
    .getByRole("button", { name: "下一步：讀取一個像素", exact: true })
    .click();
  await expect(caption).toContainText("射線");
  await page
    .getByRole("button", { name: "下一步：算出 Phase", exact: true })
    .click();
  await expect(caption).toContainText("光平面");
  expect(errors).toEqual([]);
});
