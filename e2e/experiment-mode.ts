import type { Page } from "@playwright/test";
export async function useExperimentMode(page: Page) {
  await page.addInitScript(() =>
    sessionStorage.setItem("structured-light.view-mode", "explore"),
  );
}
