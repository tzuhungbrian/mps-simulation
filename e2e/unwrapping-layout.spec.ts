import { expect, test } from "@playwright/test";

test("phase curves, selected values and live formula stay in one view and update together", async ({
  page,
}) => {
  await page.setViewportSize({ width: 620, height: 950 });
  await page.goto("/?workspace=guided");
  await page
    .getByRole("button", { name: "開始：先看三張照片", exact: true })
    .click();
  await page.getByRole("button", { name: "4 解開週期", exact: true }).click();
  const chart = page.getByTestId("guide-unwrap-chart");
  await expect(chart.locator("path")).toHaveCount(2);
  const formula = page.getByTestId("unwrap-live-formula");
  await expect(formula).toBeVisible();
  const wrapped = page.getByTestId("unwrap-live-wrapped");
  const relative = page.getByTestId("unwrap-live-relative");
  await expect(page.getByTestId("phase-wrapped-label")).toContainText(
    (await wrapped.textContent())!.trim(),
  );
  await expect(page.getByTestId("phase-unwrapped-label")).toContainText(
    (await relative.textContent())!.trim(),
  );
  for (const element of [chart, formula]) {
    const box = (await element.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThan(950);
  }
  const original = await wrapped.textContent();
  const viewBox = await chart.getAttribute("viewBox");
  await chart.focus();
  await chart.press("ArrowRight");
  await expect(wrapped).not.toHaveText(original!);
  await expect(page.getByTestId("phase-wrapped-label")).toContainText(
    (await wrapped.textContent())!.trim(),
  );
  await expect(page.getByTestId("phase-unwrapped-label")).toContainText(
    (await relative.textContent())!.trim(),
  );
  const previous = Number(await formula.getAttribute("data-previous"));
  const delta = Number(await formula.getAttribute("data-delta"));
  const current = Number(await formula.getAttribute("data-value"));
  expect(previous + delta).toBeCloseTo(current, 12);
  expect(await chart.getAttribute("viewBox")).toBe(viewBox);
  await expect(
    page.getByRole("button", { name: "補回一圈（+360°）", exact: true }),
  ).toHaveCount(0);
});

test("coincident phases share one graph label instead of covering each other", async ({
  page,
}) => {
  await page.goto("/?workspace=guided");
  await page
    .getByRole("button", { name: "開始：先看三張照片", exact: true })
    .click();
  await page.getByRole("button", { name: "4 解開週期", exact: true }).click();
  const chart = page.getByTestId("guide-unwrap-chart");
  await expect(page.getByTestId("phase-unwrapped-label")).toBeVisible();
  await chart.focus();
  await chart.press("ArrowLeft");
  await expect(page.getByTestId("phase-combined-label")).toBeVisible();
  await expect(page.getByTestId("phase-wrapped-label")).toHaveCount(0);
  await expect(page.getByTestId("phase-unwrapped-label")).toHaveCount(0);
});

test("selecting a masked pixel clears annotations and does not show a fabricated formula result", async ({
  page,
}) => {
  await page.goto("/?workspace=guided");
  await page
    .getByRole("button", { name: "開始：先看三張照片", exact: true })
    .click();
  await page.getByRole("button", { name: "4 解開週期", exact: true }).click();
  await page
    .getByRole("checkbox", { name: "加入無效區段（教學遮罩）", exact: true })
    .check();
  const chart = page.getByTestId("guide-unwrap-chart");
  const box = (await chart.boundingBox())!;
  await chart.click({ position: { x: 68 + (box.width - 88) / 2, y: 130 } });
  await expect(page.getByTestId("unwrap-live-formula")).toContainText(
    "無效像素，不補值",
  );
  expect(
    await page.getByTestId("unwrap-live-formula").getAttribute("data-value"),
  ).toBeNull();
  for (const id of [
    "phase-wrapped-label",
    "phase-unwrapped-label",
    "phase-combined-label",
  ])
    await expect(page.getByTestId(id)).toHaveCount(0);
});
