import { expect, test, type Page } from "@playwright/test";

async function openUnwrapping(page: Page) {
  await page.goto("/?workspace=guided");
  await page
    .getByRole("button", { name: "開始：先看三張照片", exact: true })
    .click();
  await page.getByRole("button", { name: "4 解開週期", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "第 4 步：Phase Unwrapping，補回整圈。",
    }),
  ).toBeVisible();
}

test("unwrap lesson explains and exercises the measured 2π correction", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openUnwrapping(page);
  const chart = page.getByTestId("guide-unwrap-chart");
  await expect(chart.locator("path")).toHaveCount(2);
  const raw = Number(
    await page.getByTestId("unwrap-raw-delta").getAttribute("data-value"),
  );
  expect(raw).toBeLessThan(-Math.PI);
  await page.getByRole("button", { name: "不加不減", exact: true }).click();
  await expect(page.getByTestId("unwrap-feedback")).toContainText("還不符合");
  await page.getByRole("button", { name: "加 2π", exact: true }).click();
  await expect(page.getByTestId("unwrap-feedback")).toContainText(
    "在連續性假設下，這樣接",
  );
  const corrected = Number(
    await page.getByTestId("unwrap-corrected-delta").getAttribute("data-value"),
  );
  expect(corrected).toBeCloseTo(raw + 2 * Math.PI, 10);
  await page
    .getByRole("button", { name: "只看 Wrapped Phase", exact: true })
    .click();
  await expect(chart.locator("path")).toHaveCount(1);
  await page
    .getByRole("button", { name: "套用 Spatial Unwrap", exact: true })
    .click();
  await expect(chart.locator("path")).toHaveCount(2);
  await expect(
    page.getByText("相鄰真實相位差的絕對值必須小於 π。", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("lesson-scene-caption")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("unknown fringe order moves the relative solution but not the observed wrapped phase", async ({
  page,
}) => {
  await openUnwrapping(page);
  const original = await page.getByTestId("unwrap-wrapped-value").textContent();
  const initial = Number(
    await page.getByTestId("unwrap-candidate-value").getAttribute("data-value"),
  );
  await page.getByRole("button", { name: "假設 k = +1", exact: true }).click();
  const shifted = Number(
    await page.getByTestId("unwrap-candidate-value").getAttribute("data-value"),
  );
  expect(shifted - initial).toBeCloseTo(2 * Math.PI, 10);
  await expect(page.getByTestId("unwrap-wrapped-value")).toHaveText(original!);
  await expect(page.getByTestId("unwrap-rewrapped-value")).toHaveText(
    original!,
  );
  await expect(page.getByTestId("unwrap-absolute-warning")).toContainText(
    "無法決定絕對條紋序號",
  );
  await expect(page.getByTestId("unwrap-absolute-warning")).toContainText(
    "不是深度",
  );
});

test("teaching-only invalid gap breaks the curve and reanchors without bridging", async ({
  page,
}) => {
  await openUnwrapping(page);
  await page
    .getByRole("checkbox", { name: "加入無效區段（教學遮罩）", exact: true })
    .check();
  await expect(page.getByTestId("unwrap-segment-count")).toHaveText(
    "2 個獨立連續區段",
  );
  await expect(page.getByTestId("unwrap-gap-note")).toContainText(
    "不是遮擋物理模擬",
  );
  const path = await page
    .getByTestId("guide-unwrap-chart")
    .locator("path")
    .nth(1)
    .getAttribute("d");
  expect((path?.match(/M/g) ?? []).length).toBe(2);
  await page
    .getByRole("button", { name: "看無效區段後的起點", exact: true })
    .click();
  await expect(page.getByTestId("unwrap-transition-note")).toContainText(
    "新區段起點",
  );
  const anchor = Number(
    await page.getByTestId("unwrap-candidate-value").getAttribute("data-value"),
  );
  const wrapped = Number(
    await page.getByTestId("unwrap-wrapped-value").getAttribute("data-value"),
  );
  expect(anchor).toBeCloseTo(wrapped, 12);
});

for (const width of [390, 620, 1440]) {
  test(`unwrap lesson remains readable and keyboard-operable at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 950 });
    await openUnwrapping(page);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const chart = page.getByTestId("guide-unwrap-chart");
    const before = await chart.getAttribute("aria-valuenow");
    await chart.focus();
    await chart.press("ArrowRight");
    // A one-pixel step can round to the same slider percentage; the x readout must change.
    const x = await page.getByTestId("unwrap-pixel-index").textContent();
    await chart.press("ArrowRight");
    await expect(page.getByTestId("unwrap-pixel-index")).not.toHaveText(x!);
    expect(before).not.toBeNull();
    expect(
      await page
        .locator(".unwrap-intro")
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
    ).toBeGreaterThanOrEqual(18);
    await page
      .getByRole("button", { name: "只看 Wrapped Phase", exact: true })
      .click();
    await page
      .getByRole("button", { name: "假設 k = -1", exact: true })
      .click();
    await page
      .getByRole("checkbox", { name: "加入無效區段（教學遮罩）", exact: true })
      .check();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "上一步", exact: true }).click();
    await expect(
      page.getByRole("heading", {
        name: "第 3 步：三個亮度，換成一個 Phase。",
      }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: "下一步：理解 Phase Unwrapping",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "第 4 步：Phase Unwrapping，補回整圈。",
      }),
    ).toBeVisible();
  });
}
