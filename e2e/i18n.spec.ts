import { expect, test } from "@playwright/test";

const HAN = /[\u4e00-\u9fff]/;
const PAGES = [
  "/?lang=en",
  "/?lang=en&station=2&part=theory",
  "/?lang=en&station=4&part=theory",
  "/?lang=en&station=4&part=lab",
  "/?lang=en&station=4&part=check",
  "/?lang=en&station=8&part=lab",
  "/?lang=en&workspace=guided",
  "/?lang=en&workspace=guided&step=2",
  "/?lang=en&workspace=guided&step=4",
  "/?lang=en&workspace=guided&step=5",
  "/?lang=en&workspace=explore",
  "/?lang=en&workspace=sandbox",
  "/?lang=en&workspace=analysis",
  "/?lang=en&workspace=calib-lab",
  "/?lang=en&workspace=aoi",
];

for (const url of PAGES)
  test(`English UI has no Chinese text: ${url}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("#root")).not.toBeEmpty();
    // The 3D lab streams OpenCV.js for a while, so networkidle is not usable; give lazy panels a moment.
    await page.waitForLoadState("load");
    await page.waitForTimeout(1000);
    const leftovers = await page.evaluate((pattern) => {
      const han = new RegExp(pattern);
      const out: string[] = [];
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
      );
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = n.textContent ?? "";
        const el = n.parentElement;
        // The language toggle names the other language on purpose.
        if (!han.test(text) || el?.closest(".path-nav-lang")) continue;
        out.push(text.trim().slice(0, 80));
      }
      for (const el of document.querySelectorAll("[aria-label],[title]"))
        for (const a of ["aria-label", "title"]) {
          const v = el.getAttribute(a);
          if (v && han.test(v) && !el.closest(".path-nav-lang"))
            out.push(`${a}=${v.slice(0, 80)}`);
        }
      return out;
    }, HAN.source);
    expect(leftovers).toEqual([]);
    expect(errors).toEqual([]);
  });

test("language toggle switches, persists, and keeps the route", async ({
  page,
}) => {
  await page.goto("/?station=4&part=theory");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hant");
  await page.getByRole("button", { name: "Switch to English" }).first().click();
  await expect(page).toHaveURL(/lang=en/);
  await expect(page).toHaveURL(/station=4/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.goto("/?station=4&part=theory");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByRole("button", { name: "切換為繁體中文" }).first().click();
  await expect(page).not.toHaveURL(/lang=en/);
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hant");
});
