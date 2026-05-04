import type { ElectrobunConfig } from "electrobun";

const envArg =
  process.argv.find((arg) => arg.startsWith("--env="))?.split("=")[1] ?? "dev";
const bundleCEFForDistribution = envArg !== "dev";

export default {
  app: {
    name: "Litecheats",
    identifier: "localhost.litecheats",
    version: "0.1.0",
  },
  build: {
    views: {
      mainview: {
        entrypoint: "src/mainview/index.ts",
      },
    },
    copy: {
  "src/mainview/index.html": "views/mainview/index.html",
  "src/mainview/index.css": "views/mainview/index.css"
},
    mac: {
      codesign: true,
      notarize: true,
      bundleCEF: bundleCEFForDistribution,
      entitlements: {
        "com.apple.security.cs.allow-jit": true,
        "com.apple.security.cs.allow-unsigned-executable-memory": true,
        "com.apple.security.cs.disable-library-validation": true
      },
    },
    win: {
      bundleCEF: bundleCEFForDistribution,
    },
    linux: {
      bundleCEF: bundleCEFForDistribution,
    },
  },
} satisfies ElectrobunConfig;
