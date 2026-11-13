import { test, expect, type Page } from "@playwright/test";

const openTab = (page: Page, name: string) =>
  page.getByRole("tab", { name, exact: true }).click();
const captureUrl = (page: Page) =>
  page
    .getByTestId("sandbox-capture-0")
    .evaluate((c: HTMLCanvasElement) => c.toDataURL());

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
    page.getByRole("heading", { name: "3D 掃描沙盒" }),
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
    page.getByRole("heading", { name: "3D 掃描沙盒" }),
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
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.5, {
    steps: 8,
  });
  await page.mouse.up({ button: "middle" });
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
    .fill("10");
  await expect(page.getByTestId("sandbox-status")).toContainText("場景已改");
  // Parameter changes rescan automatically after a short pause.
  await expect(page.getByTestId("sandbox-status")).toContainText("掃描完成");
  await expect.poll(() => captureUrl(page)).not.toBe(first);
  await canvas.focus();
  const beforePan = await canvas.evaluate((c: HTMLCanvasElement) =>
    c.toDataURL(),
  );
  await page.keyboard.down("KeyD");
  await expect
    .poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL()))
    .not.toBe(beforePan);
  await page.keyboard.up("KeyD");
  await expect(page.getByTestId("sandbox-object-x")).toHaveValue("10.00");
  await expect(page.getByTestId("sandbox-status")).toContainText("掃描完成");
  await page.getByRole("spinbutton", { name: "物體 Z 位置 數值" }).fill("-12.5");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("slider", { name: "物體 Z 位置", exact: true }),
  ).toHaveValue("-12.5");
  await page.getByRole("button", { name: "方塊", exact: true }).click();
  await expect(page.getByTestId("sandbox-status")).toContainText("掃描完成");
  await page.getByRole("button", { name: "V 型槽", exact: true }).click();
  await page
    .getByRole("slider", { name: "V 型槽夾角", exact: true })
    .fill("60");
  await openTab(page, "裝置");
  await page.getByRole("slider", { name: "Camera X", exact: true }).fill("-50");
  await expect(page.getByTestId("sandbox-baseline")).toContainText("131.8");
  await expect(page.getByTestId("sandbox-status")).toContainText("掃描完成");
  expect(
    Number(await page.getByTestId("sandbox-valid-count").textContent()),
  ).toBeGreaterThan(100);
  await openTab(page, "相位與深度");
  await expect(page.getByText("對應 Projector column")).toBeVisible();
  expect(errors).toEqual([]);
});

test("左鍵點選 Camera 機身後可在 3D 中拖曳，側欄位置同步", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/?workspace=sandbox");
  await expect(page.getByTestId("sandbox-status")).toContainText("掃描完成", {
    timeout: 15000,
  });
  await openTab(page, "裝置");
  const cameraX = page.getByRole("spinbutton", { name: "Camera X 數值" });
  await expect(cameraX).toHaveValue("0.00");
  // The label's bottom edge is anchored 0.36 m above the housing centre.
  const label = (await page
    .locator(".sandbox-world-label.camera")
    .boundingBox())!;
  const x = label.x + label.width / 2;
  let moved = false;
  for (const offset of [12, 18, 24, 30, 38, 46]) {
    const y = label.y + label.height + offset;
    await page.mouse.click(x, y);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 90, y, { steps: 6 });
    await page.mouse.up();
    if ((await cameraX.inputValue()) !== "0.00") {
      moved = true;
      break;
    }
  }
  expect(moved).toBe(true);
  await expect(page.getByTestId("sandbox-status")).toContainText("掃描完成");
  await expect(page.locator(".sandbox-world-label.camera")).toBeVisible();
  const draggedX = await cameraX.inputValue();
  await page.keyboard.press("Control+z");
  await expect(cameraX).toHaveValue("0.00");
  await page.keyboard.press("Control+y");
  await expect(cameraX).toHaveValue(draggedX);
  await page.getByRole("button", { name: "復原", exact: true }).click();
  await expect(cameraX).toHaveValue("0.00");
});

test("投影條紋可調頻率與步數，高頻靠時間解包重建，且可復原／重做", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?workspace=sandbox");
  const status = page.getByTestId("sandbox-status");
  await expect(status).toContainText("掃描完成", { timeout: 15000 });
  await openTab(page, "投影");
  const count = page.getByTestId("sandbox-frame-count");
  await expect(count).toContainText("3 張");
  await page.getByRole("slider", { name: "條紋頻率 f", exact: true }).fill("8");
  await expect(count).toContainText("6 張");
  await expect(status).toContainText("掃描完成");
  await expect(page.getByTestId("sandbox-capture-5")).toBeVisible();
  await expect(page.getByTestId("sandbox-low-phase")).toBeVisible();
  const single = page.getByRole("radio", { name: "單週期 + 基準面" });
  const temporal = page.getByRole("radio", { name: "時間解包" });
  await single.click();
  await expect(count).toContainText("3 張");
  await expect(status).toContainText("掃描完成");
  await expect(page.getByTestId("sandbox-low-phase")).toHaveCount(0);
  await page.getByRole("slider", { name: "相移步數 N", exact: true }).fill("5");
  await expect(count).toContainText("5 張");
  await expect(status).toContainText("掃描完成");
  await expect(page.getByTestId("sandbox-capture-4")).toBeVisible();
  await page.keyboard.press("Control+z");
  await expect(count).toContainText("3 張");
  await page.keyboard.press("Control+z");
  await expect(temporal).toHaveAttribute("aria-checked", "true");
  await expect(count).toContainText("6 張");
  await page.keyboard.press("Control+z");
  await expect(count).toContainText("3 張");
  await expect(
    page.getByRole("button", { name: "復原", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Control+Shift+z");
  await expect(count).toContainText("6 張");
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect(single).toHaveAttribute("aria-checked", "true");
  await expect(status).toContainText("掃描完成");
});

test("開啟互反射後在背景 Worker 掃描，並對照無互反射的 RMSE", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/?workspace=sandbox");
  await expect(page.getByTestId("sandbox-status")).toContainText("掃描完成", {
    timeout: 15000,
  });
  await expect(page.getByTestId("sandbox-direct-rmse")).toHaveCount(0);
  await page.getByRole("button", { name: "V 型槽", exact: true }).click();
  // Raise the projector above the groove rim so both walls are lit.
  await openTab(page, "裝置");
  await page.getByRole("spinbutton", { name: "Projector Y 數值" }).fill("75");
  await page.keyboard.press("Enter");
  await openTab(page, "材質");
  await page.getByRole("checkbox", { name: "互反射（間接光）" }).check();
  await page
    .getByRole("slider", { name: "物體鏡面強度", exact: true })
    .fill("0.3");
  await expect(page.getByTestId("sandbox-direct-rmse")).toContainText(
    "＜ 0.001",
    { timeout: 30000 },
  );
  await expect(page.getByTestId("sandbox-status")).toContainText("掃描完成");
  const rmse = await page
    .locator(".sandbox-result-strip > div")
    .nth(1)
    .locator("strong")
    .textContent();
  expect(Number.parseFloat(rmse!)).toBeGreaterThan(1);
  await openTab(page, "光傳輸");
  await expect(page.getByTestId("sandbox-indirect")).toBeVisible();
  await openTab(page, "相位與深度");
  await expect(page.getByTestId("sandbox-depth-error")).toBeVisible();
  expect(errors).toEqual([]);
});

test("材質預設可一鍵套用，且可重設材質參數", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/?workspace=sandbox");
  await expect(page.getByTestId("sandbox-status")).toContainText("掃描完成", {
    timeout: 15000,
  });
  await openTab(page, "材質");
  const preset = page.getByRole("combobox", { name: "物體材質預設" });
  await expect(preset).toHaveValue("matte-white");
  await preset.selectOption({ label: "拋光金屬" });
  await expect(
    page.getByRole("spinbutton", { name: "物體鏡面強度 數值" }),
  ).toHaveValue("0.95");
  await expect(
    page.getByRole("spinbutton", { name: "物體反射率 ρ 數值" }),
  ).toHaveValue("0.00");
  await expect(page.getByTestId("sandbox-status")).toContainText("掃描完成");
  await page
    .getByRole("slider", { name: "地面粗糙度", exact: true })
    .fill("0.2");
  await expect(
    page.getByRole("combobox", { name: "地面材質預設" }),
  ).toHaveValue("");
  await page.getByRole("button", { name: "重設材質參數", exact: true }).click();
  await expect(preset).toHaveValue("matte-white");
  await expect(
    page.getByRole("combobox", { name: "地面材質預設" }),
  ).toHaveValue("matte-floor");
});

test("點雲分析頁顯示誤差統計，PCB 顯示逐引腳結果", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?workspace=sandbox");
  await expect(page.getByTestId("sandbox-status")).toContainText("掃描完成", {
    timeout: 15000,
  });
  const shapeInfo = page.getByRole("button", { name: "形狀說明" });
  await expect(shapeInfo).toHaveCount(0);
  await page.getByRole("button", { name: "PCB 板", exact: true }).click();
  await expect(page.getByText("真實尺寸 PCB")).toBeHidden();
  await shapeInfo.click();
  await expect(shapeInfo).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("真實尺寸 PCB")).toBeVisible();
  await expect(page.getByTestId("sandbox-status")).toContainText("掃描完成", {
    timeout: 30000,
  });
  await openTab(page, "點雲分析");
  const cloud = page.getByTestId("analysis-canvas");
  await expect(cloud).toBeVisible();
  await expect(page.getByTestId("sandbox-canvas")).toBeHidden();
  const cloudUrl = () =>
    cloud.evaluate((c: HTMLCanvasElement) => c.toDataURL());
  const home = await cloudUrl();
  const cloudBox = (await cloud.boundingBox())!;
  await page.mouse.move(
    cloudBox.x + cloudBox.width * 0.5,
    cloudBox.y + cloudBox.height * 0.5,
  );
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(
    cloudBox.x + cloudBox.width * 0.65,
    cloudBox.y + cloudBox.height * 0.6,
    { steps: 8 },
  );
  await page.mouse.up({ button: "middle" });
  await expect.poll(cloudUrl).not.toBe(home);
  await page.getByRole("button", { name: "重設視角", exact: true }).click();
  await expect.poll(cloudUrl).toBe(home);
  await cloud.focus();
  await page.keyboard.down("KeyD");
  await expect.poll(cloudUrl).not.toBe(home);
  await page.keyboard.up("KeyD");
  await page.keyboard.press("KeyR");
  await expect.poll(cloudUrl).toBe(home);
  await expect(page.getByTestId("analysis-stats")).toContainText("RMSE");
  const pins = page.getByTestId("analysis-pins");
  await expect(pins).toContainText("U1-1");
  await expect(pins).toContainText("成功");
  const accurate = page.getByTestId("analysis-accurate");
  const strict = Number.parseInt((await accurate.textContent())!);
  await page.getByRole("spinbutton", { name: "誤差容差 mm" }).fill("100");
  await expect
    .poll(async () => Number.parseInt((await accurate.textContent())!))
    .toBeGreaterThanOrEqual(strict);
  await page
    .getByRole("combobox", { name: "點雲著色方式" })
    .selectOption("surface");
  await openTab(page, "3D 沙盒");
  await expect(page.getByTestId("sandbox-canvas")).toBeVisible();
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
