import { test, expect } from "@playwright/test";

test("AOI 多視角：自動分類 16 組斜視 Pair、批次執行、Fusion 與匯出", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.goto("/?workspace=sandbox");
  await page.getByTestId("open-aoi").click();
  await expect(
    page.getByRole("heading", { name: "AOI Multi-view Simulation" }),
  ).toBeVisible();
  await expect(page.getByText("非 Micro Phase Shifting")).toBeVisible();

  const classes = page.getByTestId("aoi-class-table");
  for (const [name, count] of [
    ["直視", "4"],
    ["反対側", "4"],
    ["直交", "8"],
    ["同じ側", "4"],
  ])
    await expect(
      classes.getByRole("row", { name: new RegExp(`^${name} ${count} `) }),
    ).toBeVisible();

  // Removing a projector re-derives classes from geometry instead of assuming 4×4.
  await page.getByRole("button", { name: "移除 P4" }).click();
  await expect(classes.getByRole("row", { name: /^直交 6 / })).toBeVisible();

  await page.getByTestId("aoi-run-selected").click();
  await expect(page.getByTestId("aoi-status")).toContainText(
    "完成 15 組 Pair",
    { timeout: 60_000 },
  );
  await expect(
    page.getByTestId("aoi-pair-table").getByRole("row", { name: /C1-P3/ }),
  ).toContainText("%");

  await page.getByRole("tab", { name: "有效量測圖" }).click();
  await expect(page.getByTestId("aoi-valid-map-C1-P3")).toBeVisible();
  await expect(page.getByTestId("aoi-reason-table")).toContainText("準確");

  await page.getByRole("tab", { name: "Fusion" }).click();
  const fusion = page.getByTestId("aoi-fusion-table");
  for (const name of ["① 直視 + 斜視補洞", "② 單一斜視", "③ 斜視 + 斜視融合"])
    await expect(fusion).toContainText(name);
  await expect(page.getByTestId("aoi-consistency")).toBeVisible();

  // Changing only the AOI reference values must not invalidate the simulation.
  await page.getByRole("tab", { name: "AOI 參考值" }).click();
  const reference = page.getByRole("spinbutton", {
    name: "反対側 參考每 2π 高度",
  });
  await reference.fill("1.1");
  await reference.press("Enter");
  await expect(page.locator(".aoi-stale")).toHaveCount(0);
  await page.getByRole("tab", { name: "Pair 與量測範圍" }).click();
  await expect(classes.getByRole("row", { name: /^反対側/ })).toContainText(
    "1.1",
  );

  const download = page.waitForEvent("download");
  await page.getByTestId("aoi-export-csv").click();
  expect((await download).suggestedFilename()).toBe("aoi-multiview-cells.csv");

  // A physics change marks results stale, and a single pair can be rerun alone.
  await page.getByRole("tab", { name: "條紋" }).click();
  await page.getByTestId("aoi-frequency").fill("24");
  await page.getByTestId("aoi-frequency").press("Enter");
  await expect(page.locator(".aoi-stale")).toBeVisible();
  await page.getByTestId("aoi-run-C1-P3").click();
  await expect(page.getByTestId("aoi-status")).toContainText("完成 1 組 Pair", {
    timeout: 30_000,
  });
  await expect(page.locator(".aoi-stale")).toHaveCount(0);

  await page.getByRole("tab", { name: "3D 點雲" }).click();
  await expect(page.getByTestId("aoi-canvas")).toBeVisible();
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.waitForTimeout(300);
  expect(errors).toEqual([]);
});
