import { test, expect } from "@playwright/test";

test("多視角分析整合在 3D 沙盒：同一場景、共用設定、批次執行、Fusion 與 3D 檢視", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.goto("/?workspace=sandbox");
  const status = page.getByTestId("sandbox-status");
  await expect(status).toContainText("掃描完成", { timeout: 15000 });
  await page.getByRole("button", { name: "階梯量規", exact: true }).click();
  await page.getByRole("tab", { name: "裝置", exact: true }).click();
  await page
    .getByRole("combobox", { name: "裝置擺位預設" })
    .selectOption({ label: "AOI：1 直視 + 4 斜視 Camera × 4 Projector" });
  await expect(page.getByTestId("sandbox-device-C4")).toBeVisible();
  await expect(status).toContainText("掃描完成", { timeout: 30000 });

  await page.getByRole("tab", { name: "多視角分析", exact: true }).click();
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

  // Removing a projector in the sandbox re-derives classes from geometry instead of assuming 4×4.
  await page.getByRole("tab", { name: "3D 沙盒", exact: true }).click();
  await page.getByRole("button", { name: "移除 P3" }).click();
  await page.getByRole("tab", { name: "多視角分析", exact: true }).click();
  await expect(classes.getByRole("row", { name: /^直交 6 / })).toBeVisible();

  const aoiStatus = page.getByTestId("aoi-status");
  await page.getByTestId("aoi-run-selected").click();
  await expect(aoiStatus).toContainText("完成 15 組 Pair", { timeout: 90_000 });
  await expect(
    page.getByTestId("aoi-pair-table").getByRole("row", { name: /C1-P2/ }),
  ).toContainText("%");

  await page.getByRole("tab", { name: "有效量測圖" }).click();
  await expect(page.getByTestId("aoi-valid-map-C1-P2")).toBeVisible();
  await expect(page.getByTestId("aoi-reason-table")).toContainText("準確");

  await page.getByRole("tab", { name: "Fusion" }).click();
  const fusion = page.getByTestId("aoi-fusion-table");
  for (const name of ["① 直視 + 斜視補洞", "② 單一斜視", "③ 斜視 + 斜視融合"])
    await expect(fusion).toContainText(name);
  await expect(page.getByTestId("aoi-consistency")).toBeVisible();

  // AOI reference values are shared settings but never invalidate the simulation.
  const reference = page.getByRole("spinbutton", {
    name: "反対側 參考每 2π 高度",
  });
  await reference.fill("1.1");
  await reference.press("Enter");
  await expect(page.locator(".aoi-stale")).toHaveCount(0);
  await page.getByRole("tab", { name: "Pair 與量測範圍" }).click();
  await expect(classes.getByRole("row", { name: /^反対側/ })).toContainText("1.1");

  const download = page.waitForEvent("download");
  await page.getByTestId("aoi-export-csv").click();
  expect((await download).suggestedFilename()).toBe("aoi-multiview-cells.csv");

  // An analysis change marks results stale, and a single pair can be rerun alone.
  await page.getByRole("spinbutton", { name: "ROI 寬（x） 數值" }).fill("7");
  await page.getByRole("spinbutton", { name: "ROI 寬（x） 數值" }).press("Enter");
  await expect(page.locator(".aoi-stale")).toBeVisible();
  await page.getByTestId("aoi-run-C1-P2").click();
  await expect(aoiStatus).toContainText("完成 1 組 Pair", { timeout: 30_000 });
  await expect(page.locator(".aoi-stale")).toHaveCount(0);

  // Show that pair in the shared 3D view: it becomes the active scan pair.
  await page.getByTestId("aoi-show-C1-P2").click();
  await expect(page.getByTestId("sandbox-canvas")).toBeVisible();
  await expect(page.getByTestId("sandbox-overlay-chip")).toContainText("C1-P2");
  await expect(page.locator(".sandbox-world-label.camera")).toHaveText("Camera C1");
  await expect(status).toContainText("掃描完成", { timeout: 30000 });
  await page.keyboard.press("Control+z");
  await expect(page.locator(".sandbox-world-label.camera")).toHaveText("Camera C0");
  expect(errors).toEqual([]);
});

test("?workspace=aoi 直接開啟沙盒的多視角分析分頁", async ({ page }) => {
  await page.goto("/?workspace=aoi");
  await expect(
    page.getByRole("tab", { name: "多視角分析", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("aoi-pair-table")).toBeVisible();
});
