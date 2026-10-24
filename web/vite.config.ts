import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

// Dev: `npm run server` on :8787 and `npm run web`; the dev server proxies /ws to it.
// Demo (`--mode demo`): one JS file and one CSS file, which scripts/inline-demo.ts folds into a single page.
export default defineConfig(({ mode }) => ({
	root: import.meta.dirname,
	base: "./",
	plugins: [svelte()],
	server: {
		port: Number(process.env.WEB_PORT ?? 5173),
		proxy: { "/ws": { target: `ws://localhost:${process.env.PORT ?? 8787}`, ws: true } },
	},
	build: {
		outDir: "dist",
		emptyOutDir: true,
		...(mode === "demo" ? { cssCodeSplit: false, chunkSizeWarningLimit: 2000, rollupOptions: { output: { inlineDynamicImports: true } } } : {}),
	},
}));
