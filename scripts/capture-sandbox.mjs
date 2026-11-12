import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const folder = new URL("../docs/evidence/", import.meta.url);
await mkdir(folder, { recursive: true });
const file = (name) => fileURLToPath(new URL(name, folder));
const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
try {
  const page = await browser.newPage({
      viewport: { width: 1600, height: 1050 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("http://127.0.0.1:5173/?workspace=sandbox");
  await expect(page.getByTestId("sandbox-status")).toContainText("掃描完成", {
    timeout: 20000,
  });
  await page.screenshot({ path: file("sandbox-desktop.png"), fullPage: true });
  await page.getByLabel("顯示重建點雲").check();
  await page.screenshot({
    path: file("sandbox-pointcloud.png"),
    fullPage: true,
  });
  const metrics = await page.locator(".sandbox-result-strip").innerText();
  const csvEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "匯出 3D CSV", exact: true }).click();
  await (await csvEvent).saveAs(file("sandbox-default.csv"));
  const csv = await readFile(file("sandbox-default.csv"), "utf8"),
    rows = csv
      .replace(/^\uFEFF/, "")
      .split("\r\n")
      .filter((s) => s && !s.startsWith("#"));
  expect(rows.length).toBe(96 * 72 + 1);
  const pngEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "PNG 場景", exact: true }).click();
  await (await pngEvent).saveAs(file("sandbox-scene.png"));
  const png = await readFile(file("sandbox-scene.png"));
  expect(png.subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  await page.setViewportSize({ width: 620, height: 950 });
  await page.screenshot({ path: file("sandbox-preview.png"), fullPage: true });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: file("sandbox-mobile.png"), fullPage: true });
  const mobileOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  const report = {
    desktopViewport: [1600, 1050],
    previewWidth: 620,
    mobileWidth: 390,
    metrics,
    csvDataRows: rows.length - 1,
    csvColumns: rows[0].split(",").length,
    pngSize: [png.readUInt32BE(16), png.readUInt32BE(20)],
    previewOverflow: overflow,
    mobileOverflow,
    pageErrors: errors,
  };
  expect(errors).toEqual([]);
  expect(overflow).toBe(false);
  expect(mobileOverflow).toBe(false);
  await writeFile(
    file("sandbox-verification.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
