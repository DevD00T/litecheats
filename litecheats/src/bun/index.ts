import { BrowserWindow } from "electrobun/bun";

const isMac = process.platform === "darwin";

const mainWindow = new BrowserWindow({
  title: "Litecheats",
  url: "views://mainview/index.html",
  frame: {
    width: 1440,
    height: 900,
    x: 120,
    y: 120,
  },
  titleBarStyle: isMac ? "hiddenInset" : "default",
  styleMask: isMac ? {
        UnifiedTitleAndToolbar: true,
        FullSizeContentView: true,
      } : {},
  transparent: false,
});

mainWindow.webview.on("dom-ready", () => {
  console.log("Litecheats shell loaded")
});

console.log("appbun wrapper started for https://litecheats.com/");
console.log("Description: Desktop wrapper for litecheats.com");
