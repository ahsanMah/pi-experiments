import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

// UI explorations of the web client, one folder each under web/variants/. They reuse web/src/lib,
// web/src/demo.ts and shared/protocol.ts, and build the same way as the main client.
// Dev:   VARIANT=<name> npm run variant          (against `npm run server`)
// Demo:  VARIANT=<name> npm run build:variant    (single page with the in-browser server)
// Tools that only read the Svelte setup (svelte-check) load this file without VARIANT.
const variant = process.env.VARIANT ?? "";

export default defineConfig(({ mode, command }) => {
	if (variant === "" && command === "build") throw new Error("set VARIANT to a folder under web/variants");
	return config(mode);
});

const config = (mode: string) => ({
	root: `${import.meta.dirname}/${variant}`,
	base: "./",
	plugins: [svelte({ configFile: `${import.meta.dirname}/../svelte.config.js` })],
	server: {
		port: Number(process.env.WEB_PORT ?? 5173),
		proxy: { "/ws": { target: `ws://localhost:${process.env.PORT ?? 8787}`, ws: true } },
	},
	build: {
		outDir: "dist",
		emptyOutDir: true,
		...(mode === "demo" ? { cssCodeSplit: false, chunkSizeWarningLimit: 2000, rollupOptions: { output: { inlineDynamicImports: true } } } : {}),
	},
});
