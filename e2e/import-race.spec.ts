import { test, expect } from "@playwright/test";
import { useExperimentMode } from "./experiment-mode";
test.beforeEach(async ({ page }) => useExperimentMode(page));

const config = {
  width: 512,
  height: 192,
  frequency: 2,
  phaseOffset: 0.6,
  mean: 0.5,
  amplitude: 0.4,
  noiseSigma: 0,
  minModulation: 0.02,
  seed: 42,
};
const envelope = (frequency: number) =>
  JSON.stringify({
    schemaVersion: 1,
    model: "three-step-1d",
    config: { ...config, frequency },
  });
for (const [description, slowContent] of [
  ["較舊成功結果", "valid"],
  ["較舊錯誤結果", "invalid"],
] as const) {
  test(`連續 JSON 匯入不讓${description}覆蓋最新結果`, async ({ page }) => {
    await page.addInitScript(() => {
      const original = File.prototype.text;
      const state = window as unknown as {
        releaseSlow?: () => Promise<void>;
        slowStarted?: boolean;
      };
      File.prototype.text = function () {
        if (this.name !== "slow.json") return original.call(this);
        state.slowStarted = true;
        return new Promise<string>((resolve, reject) => {
          state.releaseSlow = async () => {
            try {
              resolve(await original.call(this));
            } catch (e) {
              reject(e);
            }
          };
        });
      };
    });
    await page.goto("/");
    await page.locator("input[type=file]").setInputFiles({
      name: "slow.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        slowContent === "valid"
          ? envelope(2)
          : '{"schemaVersion":1,"model":"three-step-1d","config":{}}',
      ),
    });
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { slowStarted?: boolean }).slowStarted,
        ),
      )
      .toBe(true);
    await page.locator("input[type=file]").setInputFiles({
      name: "latest.json",
      mimeType: "application/json",
      buffer: Buffer.from(envelope(9)),
    });
    await expect(page.getByTestId("frequency-value")).toHaveText("9.0");
    await page.evaluate(async () => {
      await (
        window as unknown as { releaseSlow: () => Promise<void> }
      ).releaseSlow();
      // Allow the old import's promise continuation and React commit to finish.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    });
    await expect(page.getByTestId("frequency-value")).toHaveText("9.0");
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.locator(".toast")).toContainText("已匯入並驗證參數");
  });
}
