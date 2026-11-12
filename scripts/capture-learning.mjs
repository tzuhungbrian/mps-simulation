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
  const report = {
    previewWidth: 620,
    mobileWidth: 390,
    introFont,
    chartTickFont: tickFont,
    mobileOverflow: overflow,
    pageErrors: errors,
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
