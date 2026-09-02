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
			"dist/favicon.ico": "views/mainview/favicon.ico",
			"dist/favicon-16x16.png": "views/mainview/favicon-16x16.png",
			"dist/favicon-32x32.png": "views/mainview/favicon-32x32.png",
			"dist/favicon-48x48.png": "views/mainview/favicon-48x48.png",
			"dist/apple-touch-icon.png": "views/mainview/apple-touch-icon.png",
			"dist/android-chrome-192x192.png": "views/mainview/android-chrome-192x192.png",
			"dist/android-chrome-512x512.png": "views/mainview/android-chrome-512x512.png",
			"dist/site.webmanifest": "views/mainview/site.webmanifest",
		},
		watchIgnore: ["dist/**"],
		mac: {
			codesign: true,
			notarize: true,
			bundleCEF: bundleCEFForDistribution,
			icons: "assets/icon.iconset",
			entitlements: {
				"com.apple.security.cs.allow-jit": true,
				"com.apple.security.cs.allow-unsigned-executable-memory": true,
				"com.apple.security.cs.disable-library-validation": true,
			},
		},
		linux: {
			bundleCEF: bundleCEFForDistribution,
			icon: "assets/icon.png",
		},
		win: {
			bundleCEF: bundleCEFForDistribution,
			icon: "assets/icon.ico",
		},
	},
	release: {
		baseUrl: "",
	},
} satisfies ElectrobunConfig;
