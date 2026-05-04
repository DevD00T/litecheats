import type { ElectrobunConfig } from "electrobun/bun";

const envArg =
	process.argv.find((arg) => arg.startsWith("--env="))?.split("=")[1] ?? "dev";
const bundleCEFForDistribution = envArg !== "dev";

export default {
	app: {
		name: "Litecheats",
		identifier: "dev.litecheats.app",
		version: "0.1.0",
	},
	build: {
		useAsar: true,
		bun: {
			entrypoint: "src/bun/index.ts",
			external: [],
		},
		views: {},
		copy: {
			"dist/index.html": "views/mainview/index.html",
			"dist/assets/": "views/mainview/assets/",
		},
		watchIgnore: ["dist/**"],
		mac: {
			codesign: true,
			notarize: true,
			bundleCEF: bundleCEFForDistribution,
			entitlements: {
				"com.apple.security.cs.allow-jit": true,
				"com.apple.security.cs.allow-unsigned-executable-memory": true,
				"com.apple.security.cs.disable-library-validation": true,
			},
		},
		linux: {
			bundleCEF: bundleCEFForDistribution,
		},
		win: {
			bundleCEF: bundleCEFForDistribution,
		},
	},
	release: {
		baseUrl: "",
	},
} satisfies ElectrobunConfig;
