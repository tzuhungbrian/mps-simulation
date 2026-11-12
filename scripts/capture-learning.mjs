import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const output = new URL("../docs/evidence/", import.meta.url);
await mkdir(output, { recursive: true });
const file = (name) => fileURLToPath(new URL(name, output));
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 620, height: 950 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5173/?workspace=guided");
  await expect(page.getByTestId("lesson-intro")).toBeVisible();
  const introFont = await page
    .getByTestId("lesson-intro")
    .evaluate((el) => getComputedStyle(el).fontSize);
  await page.screenshot({ path: file("learning-preview.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.screenshot({ path: file("learning-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 620, height: 950 });
  await page
    .getByRole("button", { name: "開始：先看三張照片", exact: true })
    .click();
  await page.screenshot({ path: file("learning-step1.png"), fullPage: true });
  await page
    .getByRole("button", { name: "下一步：讀取一個像素", exact: true })
    .click();
  await page.screenshot({ path: file("learning-step2.png"), fullPage: true });
  const tickFont = await page
    .getByTestId("guide-intensity-chart")
    .locator(".chart-tick")
    .first()
    .evaluate((el) => getComputedStyle(el).fontSize);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: file("learning-mobile.png"), fullPage: true });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  await page.setViewportSize({ width: 620, height: 950 });
  await page
    .getByRole("button", { name: "下一步：算出 Phase", exact: true })
    .click();
  await page
    .getByRole("button", { name: "把跳變接起來（1D Unwrap）", exact: true })
    .click();
  await page.screenshot({ path: file("learning-step3.png"), fullPage: true });
  const webglContextHealthy = await page
    .getByTestId("lesson-scene-canvas")
    .evaluate((canvas) => {
      const context = canvas.getContext("webgl2");
      return context !== null && !context.isContextLost();
    });
  expect(webglContextHealthy).toBe(true);
  await page
    .getByRole("button", { name: "下一步：理解 Phase Unwrapping", exact: true })
    .click();
  await expect(page.getByTestId("lesson-scene-canvas")).toHaveCount(0);
  await expect(
    page.getByTestId("guide-unwrap-chart").locator("path"),
  ).toHaveCount(2);
  const liveWrapped = Number(
    await page.getByTestId("unwrap-live-wrapped").getAttribute("data-value"),
  );
  const liveRelative = Number(
    await page.getByTestId("unwrap-live-formula").getAttribute("data-value"),
  );
  await expect(page.getByTestId("phase-wrapped-label")).toContainText(
    liveWrapped.toFixed(3),
  );
  await expect(page.getByTestId("phase-unwrapped-label")).toContainText(
    liveRelative.toFixed(3),
  );
  const unwrapViewports = [];
  for (const width of [1440, 620, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    );
    expect(horizontalOverflow).toBe(false);
    const name =
      width === 1440 ? "desktop" : width === 620 ? "preview" : "mobile";
    await page
      .getByTestId("unwrap-workbench")
      .screenshot({ path: file(`learning-unwrapping-${name}.png`) });
    unwrapViewports.push({
      width,
      horizontalOverflow,
      pageHeight: await page.evaluate(
        () => document.documentElement.scrollHeight,
      ),
    });
  }
  await page.setViewportSize({ width: 620, height: 1000 });
  expect(liveRelative - liveWrapped).toBeCloseTo(2 * Math.PI, 10);
  const rawDelta = Number(
    await page.getByTestId("unwrap-raw-delta").getAttribute("data-value"),
  );
  const correctedDelta = Number(
    await page.getByTestId("unwrap-corrected-delta").getAttribute("data-value"),
  );
  expect(rawDelta).toBeLessThan(-Math.PI);
  expect(correctedDelta).toBeCloseTo(rawDelta + 2 * Math.PI, 10);
  await page.getByRole("button", { name: "加 2π", exact: true }).click();
  const candidateAtZero = Number(
    await page.getByTestId("unwrap-candidate-value").getAttribute("data-value"),
  );
  const wrappedAtZero = await page
    .getByTestId("unwrap-wrapped-value")
    .textContent();
  await page.getByRole("button", { name: "假設 k = +1", exact: true }).click();
  const candidateAtOne = Number(
    await page.getByTestId("unwrap-candidate-value").getAttribute("data-value"),
  );
  expect(candidateAtOne - candidateAtZero).toBeCloseTo(2 * Math.PI, 10);
  await expect(page.getByTestId("unwrap-wrapped-value")).toHaveText(
    wrappedAtZero,
  );
  await expect(page.getByTestId("unwrap-rewrapped-value")).toHaveText(
    wrappedAtZero,
  );
  await page.getByRole("button", { name: "假設 k = 0", exact: true }).click();

  await page
    .getByRole("checkbox", { name: "加入無效區段（教學遮罩）", exact: true })
    .check();
  await expect(page.getByTestId("unwrap-segment-count")).toHaveText(
    "2 個獨立連續區段",
  );
  const gapPath = await page
    .getByTestId("guide-unwrap-chart")
    .locator("path")
    .nth(1)
    .getAttribute("d");
  const gapPathSegments = (gapPath.match(/M/g) ?? []).length;
  expect(gapPathSegments).toBe(2);
  await page
    .getByRole("button", { name: "看無效區段後的起點", exact: true })
    .click();
  await expect(page.getByTestId("unwrap-transition-note")).toContainText(
    "新區段起點",
  );
  const anchor = Number(
    await page.getByTestId("unwrap-candidate-value").getAttribute("data-value"),
  );
  const measuredAnchor = Number(
    await page.getByTestId("unwrap-wrapped-value").getAttribute("data-value"),
  );
  expect(anchor).toBeCloseTo(measuredAnchor, 12);

  const report = {
    previewWidth: 620,
    mobileWidth: 390,
    introFont,
    chartTickFont: tickFont,
    mobileOverflow: overflow,
    pageErrors: errors,
    unwrapping: {
      liveWrapped,
      liveRelative,
      rawDelta,
      correctedDelta,
      candidateAtZero,
      candidateAtOne,
      wrappedAtZero,
      gapPathSegments,
      anchor,
      measuredAnchor,
      viewports: unwrapViewports,
      webglContextHealthy,
    },
  };
  expect(errors).toEqual([]);
  expect(overflow).toBe(false);
  await writeFile(
    file("learning-verification.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
