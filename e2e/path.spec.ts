import { test, expect } from "@playwright/test";

test("學習路徑：從首頁進站、讀理論、勾檢核，回首頁看到進度", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "開始第 1 站" }).click();
  await expect(
    page.getByRole("heading", { name: "系統與相機模型", level: 1 }),
  ).toBeVisible();
  await page.getByRole("button", { name: "讀完了，前往實驗" }).click();
  await expect(page.getByRole("tab", { name: /實驗/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("tab", { name: /檢核/ }).click();
  await page.getByRole("checkbox").first().check();
  await expect(page.getByRole("status")).toContainText("已通過 1 / 2 項");
  await page.reload();
  await expect(page.getByRole("checkbox").first()).toBeChecked();
  await page.getByRole("button", { name: "學習路徑", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "繼續：系統與相機模型" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /系統與相機模型 進行中/ }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("Ctrl+K 可跳到任一站，舊的 Calibration 課程網址導到第 2 站", async ({
  page,
}) => {
  await page.goto("/?workspace=calibration");
  await expect(
    page.getByRole("heading", { name: "Camera Calibration", level: 1 }),
  ).toBeVisible();
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox").fill("Projector");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Projector Calibration", level: 1 }),
  ).toBeVisible();
  await expect(page).toHaveURL(/station=5/);
});

test("學習路徑首頁在 390px 不水平溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "九站路線" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
