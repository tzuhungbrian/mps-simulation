import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/** Run the exact same acceptance tests against built dist, not Vite dev. */
export default defineConfig({
  ...base,
  use: { ...base.use, baseURL: "http://127.0.0.1:4173" },
  webServer: {
    command: "npm run preview -- --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
  },
});
