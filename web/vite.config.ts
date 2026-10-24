import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

// Dev: `npm run server` on :8787 and `npm run web`; the dev server proxies /ws to it.
export default defineConfig({
	root: import.meta.dirname,
	plugins: [svelte()],
	server: {
		port: Number(process.env.WEB_PORT ?? 5173),
		proxy: { "/ws": { target: `ws://localhost:${process.env.PORT ?? 8787}`, ws: true } },
	},
	build: { outDir: "dist", emptyOutDir: true },
});
