import { test, expect } from "@playwright/test";

for (const width of [390, 620])
  test(`初始 ${width}px 視窗可完整辨識兩台裝置`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 });
    await page.goto("/?workspace=sandbox");
    const canvas = page.getByTestId("sandbox-canvas");
    await expect(canvas).toBeVisible();
    await expect(page.getByTestId("sandbox-status")).toContainText("掃描完成");
    const bounds = (await canvas.boundingBox())!;
    for (const selector of [
      ".sandbox-world-label.camera",
      ".sandbox-world-label.projector",
    ]) {
      const box = (await page.locator(selector).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(bounds.x);
      expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width);
    }
  });

test("可切換專注 3D 空間，不讓圖表佔據沙盒畫面", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/?workspace=sandbox");
  await page.getByRole("button", { name: "專注 3D 空間", exact: true }).click();
  await expect(page.locator(".sandbox-tools")).not.toBeVisible();
  const bounds = (await page.getByTestId("sandbox-canvas").boundingBox())!;
  expect(bounds.height).toBeGreaterThanOrEqual(540);
  await page
    .getByRole("button", { name: "返回完整工作區", exact: true })
    .click();
  await expect(page.locator(".sandbox-tools")).toBeVisible();
});

test("首次開啟就進入 3D 空間，仍可返回教學", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "走進 3D 掃描沙盒。" }),
  ).toBeVisible();
  await expect(page.getByTestId("sandbox-canvas")).toBeVisible();
  await page.getByRole("button", { name: "一步一步學", exact: true }).click();
  await expect(page.getByTestId("lesson-intro")).toBeVisible();
});

test("3D 沙盒真的可旋轉、移動物體並由三張 captures 重建深度", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("/?workspace=sandbox");
  await expect(
    page.getByRole("heading", { name: "走進 3D 掃描沙盒。" }),
  ).toBeVisible();
  const canvas = page.getByTestId("sandbox-canvas");
  await expect(canvas).toBeVisible();
  await expect
    .poll(() =>
      canvas.evaluate((c: HTMLCanvasElement) => {
        const gl = c.getContext("webgl2");
        return !!gl && !gl.isContextLost() && c.width > 0;
      }),
    )
    .toBe(true);
  await expect(page.getByTestId("sandbox-status")).toContainText("掃描完成", {
    timeout: 15000,
  });
  expect(
    Number(await page.getByTestId("sandbox-valid-count").textContent()),
  ).toBeGreaterThan(100);
  await expect(page.getByTestId("sandbox-probe-depth")).not.toHaveText("N/A");
  const first = await page
    .getByTestId("sandbox-capture-0")
    .evaluate((c: HTMLCanvasElement) => c.toDataURL());
  const observation = await canvas.evaluate((c: HTMLCanvasElement) =>
    c.toDataURL(),
  );
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.35);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.5, {
    steps: 8,
  });
  await page.mouse.up();
  expect(
    await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL()),
  ).not.toBe(observation);
  expect(
    await page
      .getByTestId("sandbox-capture-0")
      .evaluate((c: HTMLCanvasElement) => c.toDataURL()),
  ).toBe(first);
  await page
    .getByRole("slider", { name: "物體 X 位置", exact: true })
    .fill("0.4");
  await expect(page.getByTestId("sandbox-status")).toContainText("場景已改");
  await expect(page.getByTestId("sandbox-probe-depth")).toHaveText("N/A");
  await page.getByRole("button", { name: "拍三張並重建", exact: true }).click();
  await expect(page.getByTestId("sandbox-status")).toContainText("掃描完成");
  expect(
    await page
      .getByTestId("sandbox-capture-0")
      .evaluate((c: HTMLCanvasElement) => c.toDataURL()),
  ).not.toBe(first);
  await canvas.focus();
  await page.keyboard.press("KeyD");
  await expect(page.getByTestId("sandbox-object-x")).not.toHaveText("0.40 m");
  await page.getByRole("button", { name: "方塊", exact: true }).click();
  await page.getByRole("button", { name: "拍三張並重建", exact: true }).click();
  await expect(page.getByTestId("sandbox-status")).toContainText("掃描完成");
  await expect(
    page.getByText("單一完整週期", { exact: false }).first(),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("3D 沙盒在預覽窄窗仍可讀、不水平溢出，並可匯出真實 CSV", async ({
  page,
}) => {
  await page.setViewportSize({ width: 620, height: 950 });
  await page.goto("/?workspace=sandbox");
  await expect(page.getByTestId("sandbox-status")).toContainText("掃描完成", {
    timeout: 15000,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const csv = page.waitForEvent("download");
  await page.getByRole("button", { name: "匯出 3D CSV", exact: true }).click();
  expect((await csv).suggestedFilename()).toMatch(/sandbox.*\.csv$/);
  await page.getByRole("button", { name: "一步一步學", exact: true }).click();
  await expect(page.getByTestId("lesson-intro")).toBeVisible();
});
