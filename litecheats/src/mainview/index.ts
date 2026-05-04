const APP_CONFIG = {
  "name": "Litecheats",
  "title": "Litecheats",
  "origin": "http://localhost:8080",
  "url": "http://localhost:8080/",
  "themeColor": "#bc246e",
  "titlebar": "unified",
  "showOrigin": true,
  "hasIcon": false
};
const mount = document.getElementById("webview-mount");
const siteName = document.getElementById("site-name");
const siteOrigin = document.getElementById("site-origin");
const siteIcon = document.getElementById("site-icon") as HTMLImageElement | null;
const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);

document.title = APP_CONFIG.title;
document.documentElement.style.setProperty("--appbun-accent", APP_CONFIG.themeColor);
document.documentElement.dataset.platform = isMac ? "mac" : "other";
if (!isMac) {
  document.documentElement.style.setProperty("--shell-topbar-display", "none");
  document.documentElement.style.setProperty("--shell-toolbar-height", "0px");
}
siteName && (siteName.textContent = APP_CONFIG.name);
siteOrigin && (siteOrigin.textContent = APP_CONFIG.origin.replace(/^https?:\/\//, ""));

if (mount) {
  const webview = document.createElement("electrobun-webview");
  webview.setAttribute("src", APP_CONFIG.url);
  webview.setAttribute("id", "remote-app");
  webview.classList.add("remote-app");
  mount.appendChild(webview);
}

if (!APP_CONFIG.hasIcon && siteIcon) {
  siteIcon.remove();
}

siteIcon?.addEventListener("error", () => {
  siteIcon.remove();
});

console.log("Loading http://localhost:8080/");
