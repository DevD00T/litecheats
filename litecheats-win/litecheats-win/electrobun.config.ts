import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "Litecheats",
    identifier: "com.litecheats",
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
      bundleCEF: false,
    },
    win: {
      bundleCEF: false,
    },
    linux: {
      bundleCEF: false,
    },
  },
} satisfies ElectrobunConfig;
