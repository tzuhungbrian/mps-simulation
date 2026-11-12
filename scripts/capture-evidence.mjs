import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

// A running npm run dev server is required. Evidence uses an isolated profile.
const output = new URL("../docs/evidence/", import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5173/?workspace=guided");
  await page.getByRole("button", { name: "自由實驗", exact: true }).click();
  await expect(page.getByTestId("valid-ratio")).toHaveText("100.0%");
  await expect(page.getByTestId("rmse")).toHaveText("< 10⁻¹²");
  await page.screenshot({
    path: new URL("desktop.png", output).pathname.replace(/^\/(\w:)/, "$1"),
    fullPage: true,
  });
  const pngEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "PNG", exact: true }).click();
  await (
    await pngEvent
  ).saveAs(
    new URL("default-experiment.png", output).pathname.replace(
      /^\/(\w:)/,
      "$1",
    ),
  );
  const jsonEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "匯出 JSON 參數", exact: true })
    .click();
  await (
    await jsonEvent
  ).saveAs(
    new URL("default-parameters.json", output).pathname.replace(
      /^\/(\w:)/,
      "$1",
    ),
  );
  await page.getByRole("button", { name: "關閉通知" }).click();
  await page.getByRole("button", { name: "WebGL 示意", exact: true }).click();
  await expect(page.getByTestId("webgl-canvas")).toBeVisible();
  const webgl = await page.getByTestId("webgl-canvas").evaluate((c) => {
    const gl = c.getContext("webgl2");
    return {
      available: !!gl,
      contextLost: gl?.isContextLost(),
      width: c.width,
      height: c.height,
    };
  });
  await page.screenshot({
    path: new URL("webgl.png", output).pathname.replace(/^\/(\w:)/, "$1"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "2D 量測", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page
        .getByTestId("intensity-chart")
        .evaluate(
          (s) => s.getBoundingClientRect().width / s.viewBox.baseVal.width,
        ),
    )
    .toBeGreaterThan(0.85);
  await page.screenshot({
    path: new URL("mobile.png", output).pathname.replace(/^\/(\w:)/, "$1"),
    fullPage: true,
  });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  const report = {
    viewportDesktop: [1440, 1100],
    viewportMobile: [390, 844],
    defaultRmseDisplay: await page.getByTestId("rmse").textContent(),
    defaultValidRatio: await page.getByTestId("valid-ratio").textContent(),
    webgl,
    mobileOverflow: overflow,
    pageErrors: errors,
  };
  expect(errors).toEqual([]);
  expect(overflow).toBe(false);
  expect(webgl.available).toBe(true);
  await writeFile(
    new URL("browser-verification.json", output),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
