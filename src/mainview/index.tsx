import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./components/app";
import "./index.css";
import { registerServiceWorker } from "./lib/pwa";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element not found");

registerServiceWorker();

createRoot(rootElement).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
