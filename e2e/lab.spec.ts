import { test, expect } from "@playwright/test";
import { useExperimentMode } from "./experiment-mode";
test.beforeEach(async ({ page }) => useExperimentMode(page));

test("完整教學流程：曲線互動、保存與真正的資料匯出", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "從三張條紋，讀懂相位。" }),
  ).toBeVisible();
  await expect(page.getByTestId("valid-ratio")).toHaveText("100.0%");
  await expect(page.getByTestId("rmse")).toHaveText(/< 10⁻¹²/);
  await expect(page.getByTestId("capture-0")).toBeVisible();
  await expect(page.getByTestId("phase-map")).toBeVisible();
  const initialProbe = await page.getByTestId("probe-value").innerText();
  await page
    .getByTestId("intensity-chart")
    .click({ position: { x: 350, y: 70 } });
  await expect(page.getByTestId("probe-value")).not.toHaveText(initialProbe);
  await page.getByLabel("Fringe frequency").fill("9");
  await expect(page.getByTestId("frequency-value")).toHaveText("9.0");
  await page.getByRole("button", { name: "保存參數", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "已保存" }),
  ).toContainText("已保存");
  await page.reload();
  await expect(page.getByTestId("frequency-value")).toHaveText("9.0");
  const csvDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "CSV", exact: true }).click();
  const csv = await csvDownload;
  expect(csv.suggestedFilename()).toMatch(/\.csv$/);
  const pngDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "PNG", exact: true }).click();
  expect((await pngDownload).suggestedFilename()).toMatch(/\.png$/);
  await page.getByRole("button", { name: "實作邊界" }).click();
  await expect(
    page.getByRole("heading", { name: "知道模型沒有做什麼，同樣重要。" }),
  ).toBeVisible();
  await expect(
    page.getByText("尚未實作", { exact: false }).first(),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("失效量測不可偽裝成正確相位", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Modulation amplitude").fill("0");
  await expect(page.getByTestId("valid-ratio")).toHaveText("0.0%");
  await expect(page.getByTestId("rmse")).toHaveText("N/A");
  await expect(page.getByText("目前沒有有效像素")).toBeVisible();
});

test("窄螢幕沒有頁面水平溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "從三張條紋，讀懂相位。" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
});
