import { test, expect } from "@playwright/test";
import { useExperimentMode } from "./experiment-mode";
test.beforeEach(async ({ page }) => useExperimentMode(page));

test("顯示由 captures 估計的 DC / Modulation，無裁切時改 A / B 不改 phase", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("estimated-mean")).toHaveText("0.500");
  await expect(page.getByTestId("estimated-modulation")).toHaveText("0.400");
  const phase = await page.getByTestId("estimated-phase").textContent();
  await page.getByLabel("Mean intensity").fill("0.55");
  await page.getByLabel("Modulation amplitude").fill("0.25");
  await expect(page.getByTestId("estimated-mean")).toHaveText("0.550");
  await expect(page.getByTestId("estimated-modulation")).toHaveText("0.250");
  await expect(page.getByTestId("estimated-phase")).toHaveText(phase!);
  await page.getByRole("button", { name: "Valid", exact: true }).click();
  await expect(page.locator(".phase-colorbar")).toHaveText("無效有效");
});
