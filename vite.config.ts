import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react()],
	root: "src/mainview",
	build: {
		outDir: "../../dist",
		emptyOutDir: true,
	},
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "src/mainview"),
			shared: path.resolve(__dirname, "shared"),
		},
	},
	server: {
		port: 5173,
		strictPort: true,
	},
});
