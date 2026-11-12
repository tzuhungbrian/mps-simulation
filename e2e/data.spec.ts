import { test, expect } from "@playwright/test";
import { useExperimentMode } from "./experiment-mode";
test.beforeEach(async ({ page }) => useExperimentMode(page));
import { readFile } from "node:fs/promises";

test("CSV 的逐像素數量、JSON round-trip 與 PNG 編碼皆真實可讀", async ({
  page,
}) => {
  await page.goto("/");
  const csvEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "CSV", exact: true }).click();
  const csv = await readFile((await (await csvEvent).path())!, "utf8");
  const lines = csv
    .replace(/^\uFEFF/, "")
    .split("\r\n")
    .filter((s) => s && !s.startsWith("#"));
  expect(lines).toHaveLength(512 * 192 + 1);
  expect(lines[0].split(",")).toHaveLength(12);
  expect(lines[1].split(",")[7]).not.toBe("");
  expect(lines.at(-1)!.split(",").slice(0, 2)).toEqual(["511", "191"]);
  const pngEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "PNG", exact: true }).click();
  const bytes = await readFile((await (await pngEvent).path())!);
  expect(bytes.subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  expect(bytes.readUInt32BE(16)).toBe(1600);
  expect(bytes.readUInt32BE(20)).toBe(1120);
  const jsonEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "匯出 JSON 參數", exact: true })
    .click();
  const json = await readFile((await (await jsonEvent).path())!, "utf8");
  const envelope = JSON.parse(json);
  expect(envelope.schemaVersion).toBe(1);
  await page.getByLabel("Fringe frequency").fill("10");
  await page.locator("input[type=file]").setInputFiles({
    name: "parameters.json",
    mimeType: "application/json",
    buffer: Buffer.from(json),
  });
  await expect(page.getByTestId("frequency-value")).toHaveText("6.0");
  await page.locator("input[type=file]").setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      '{"schemaVersion":1,"model":"three-step-1d","config":{}}',
    ),
  });
  await expect(page.getByRole("alert")).toContainText("原參數未變更");
  await expect(page.getByTestId("frequency-value")).toHaveText("6.0");
});

test("同 Seed 產生相同 captures，改 Seed 才改變 noise，重新載入可還原", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Noise sigma").fill("0.025");
  const hash = () =>
    page
      .getByTestId("capture-0")
      .evaluate((c: HTMLCanvasElement) => c.toDataURL());
  const first = await hash();
  await page.getByRole("button", { name: "下一個種子" }).click();
  expect(await hash()).not.toBe(first);
  await page.getByLabel("固定隨機種子").fill("42");
  expect(await hash()).toBe(first);
  await page.getByRole("button", { name: "保存參數", exact: true }).click();
  await page.reload();
  expect(await hash()).toBe(first);
  await page.getByLabel("Mean intensity").fill("0.99");
  await expect(page.getByTestId("valid-ratio")).not.toHaveText("100.0%");
});

test("WebGL 確實渲染並可拖曳，切換不影響數值解算", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  const rmse = await page.getByTestId("rmse").textContent();
  await page.getByRole("button", { name: "WebGL 示意", exact: true }).click();
  const canvas = page.getByTestId("webgl-canvas");
  await expect(canvas).toBeVisible();
  await expect
    .poll(() =>
      canvas.evaluate((c: HTMLCanvasElement) => {
        const gl = c.getContext("webgl2");
        return !!gl && !gl.isContextLost() && c.width > 0 && c.height > 0;
      }),
    )
    .toBeTruthy();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.4, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(page.getByTestId("rmse")).toHaveText(rmse!);
  await page.getByRole("button", { name: "2D 量測", exact: true }).click();
  await expect(page.getByTestId("capture-0")).toBeVisible();
  expect(errors).toEqual([]);
});

test("手機曲線文字不隨固定 viewBox 縮成不可讀，鍵盤每次移動一個實際像素", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const chart = page.getByTestId("intensity-chart");
  const scale = await chart.evaluate(
    (s: SVGSVGElement) =>
      s.getBoundingClientRect().width / s.viewBox.baseVal.width,
  );
  expect(scale).toBeGreaterThan(0.85);
  await page.getByText("進階解算設定", { exact: false }).click();
  await page.getByLabel("Image width").selectOption("1024");
  const before = Number(
    (await page.getByTestId("probe-value").innerText()).match(/\d+/)![0],
  );
  await chart.focus();
  await page.keyboard.press("ArrowRight");
  const after = Number(
    (await page.getByTestId("probe-value").innerText()).match(/\d+/)![0],
  );
  expect(after - before).toBe(1);
});

test("Reduced motion 下的 WebGL 不遞迴，鍵盤可操作探針與 Unwrap", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const probe = page.getByTestId("intensity-chart");
  const before = await page.getByTestId("probe-value").innerText();
  await probe.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("probe-value")).not.toHaveText(before);
  await page.getByLabel("顯示 1D Unwrap").uncheck();
  await expect(page.getByTestId("phase-chart").locator("path")).toHaveCount(1);
  await page.getByRole("button", { name: "WebGL 示意", exact: true }).click();
  await expect(page.getByTestId("webgl-canvas")).toBeVisible();
  const box = (await page.getByTestId("webgl-canvas").boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 120, { steps: 5 });
  await page.mouse.up();
  expect(errors).toEqual([]);
});
