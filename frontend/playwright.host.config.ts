import { defineConfig } from "@playwright/test";
import config from "./playwright.config";

// Run against a build with NEXT_PUBLIC_BASE_PATH=/script-master and host endpoints.
export default defineConfig({ ...config, testDir: "./e2e-host", outputDir: "test-results-host" });
