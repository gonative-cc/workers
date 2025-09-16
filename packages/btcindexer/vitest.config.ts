import { defineConfig } from "vitest/config";
import { defineWorkersProject } from "@cloudflare/vitest-pool-workers/config";

export default defineConfig(
	defineWorkersProject({
		test: {
			globals: true,
			poolOptions: {
				workers: {
					wrangler: { configPath: "./wrangler.jsonc" },
					miniflare: {
						compatibilityDate: "2025-06-20",
						compatibilityFlags: ["nodejs_compat"],
					},
				},
			},
		},
		define: {
			global: "globalThis",
		},
		resolve: {
			alias: {
				"node:crypto": "crypto",
			},
		},
	}),
);
