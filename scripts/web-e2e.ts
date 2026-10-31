// Browser check of the web client against the offline echo model: chat, branch from the
// canvas while the main branch is still answering, switch back, share a note.
// Run: npm run build && npm run e2e:web   (needs Playwright with Chromium available)
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
// Playwright is resolved from the environment rather than installed here, so it is typed loosely.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { chromium } = require("playwright") as { chromium: { launch(): Promise<any> } };

const dir = mkdtempSync(join(tmpdir(), "pi-branches-web-"));
const port = 19000 + Math.floor(Math.random() * 1000);
const shots = process.env.SCREENSHOTS ?? dir;
const server = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings=ExperimentalWarning", "server/main.ts"], {
	env: { ...process.env, PORT: String(port), PI_BRANCHES_DB: join(dir, "db.sqlite"), PI_MODEL: "faux/echo" },
	stdio: ["ignore", "pipe", "inherit"],
});
await new Promise<void>((resolve) => server.stdout!.on("data", (chunk) => String(chunk).includes("pi-branches on") && resolve()));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [];
page.on("pageerror", (error: Error) => errors.push(String(error)));
page.on("console", (message: { type(): string; text(): string }) => message.type() === "error" && errors.push(message.text()));
const ok = (message: string) => console.log(`ok - ${message}`);

try {
	await page.goto(`http://localhost:${port}/`);
	const composer = page.locator("footer textarea");
	await composer.waitFor();

	await composer.fill("What is a durable harness?");
	await composer.press("Enter");
	await page.locator(".row.assistant").first().waitFor({ timeout: 15_000 });
	await page.locator(".chat header .dot:not(.busy)").waitFor();
	ok("main branch answered");

	// Ask a long follow-up on main, then branch from the first answer on the canvas while main works.
	await composer.fill("Now tell me about storage in depth");
	await composer.press("Enter");
	await page.locator(".chat header .dot.busy").waitFor();
	const answerNode = page.locator(".svelte-flow__node .card.assistant").first();
	await answerNode.click();
	await page.locator(".svelte-flow__node-toolbar button", { hasText: "Branch" }).first().click();
	await page.locator(".sidebar .branch").nth(1).waitFor();
	// The fork point now offers both ways on: main's continuation and the new branch, which is open.
	await page.locator(".switcher .lane.current").waitFor();
	if ((await page.locator(".switcher .lane").count()) !== 2) throw new Error("expected two branches at the fork point");
	ok("branched from a canvas node into a new branch");

	await composer.fill("Side question: how do forks work?");
	await composer.press("Enter");
	await page.locator(".row.user .bubble", { hasText: "Side question" }).waitFor();
	ok("sent into the side branch");
	await page.screenshot({ path: join(shots, "web-branching.png") });

	// Main kept running while we were away: switch back at the fork point and see its second answer.
	await page.locator(".switcher .lane:not(.current)").click();
	await page.locator(".chat header .title", { hasText: "Main" }).waitFor();
	await page.locator(".row.assistant").nth(1).waitFor({ timeout: 15_000 });
	ok("main branch finished its answer while we were in the side branch");

	// The command palette switches branches by name.
	const side = (await page.locator(".sidebar .branch .name").nth(1).textContent())!;
	await page.keyboard.press("Control+k");
	await page.locator(".palette input").fill(side);
	await page.keyboard.press("Enter");
	await page.locator(".chat header .title", { hasText: side }).waitFor();
	await page.keyboard.press("Control+k");
	await page.locator(".palette input").fill("main");
	await page.keyboard.press("Enter");
	await page.locator(".chat header .title", { hasText: "Main" }).waitFor();
	ok("command palette switches branches");

	// Share a note with every branch from the sidebar.
	await page.locator(".sidebar button", { hasText: "Note" }).click();
	await page.locator(".dialog textarea").fill("We decided to use SQLite storage.");
	await page.locator(".dialog label", { hasText: "Every branch" }).click();
	await page.locator(".dialog button.primary").click();
	await page.locator(".notes .note-title").first().waitFor();
	ok("note shared with every branch");

	// Two questions and answers on main, one of each on the side branch.
	await page.waitForFunction(() => document.querySelectorAll(".svelte-flow__node").length >= 6, null, { timeout: 15_000 });
	const nodes = await page.locator(".svelte-flow__node").count();
	ok(`canvas shows ${nodes} nodes across branches`);

	// The spatial view shows every branch as a card and comes back to the same branch.
	await page.locator(".overview-bar button", { hasText: "Spatial" }).click();
	await page.waitForFunction(() => document.querySelectorAll(".spatial .svelte-flow__node").length >= 2);
	await page.screenshot({ path: join(shots, "web-spatial.png") });
	await page.locator(".spatial .back").click();
	await page.locator(".chat header .title", { hasText: "Main" }).waitFor();
	ok("spatial view and back");

	await page.locator(".overview-bar button", { hasText: "Full" }).click();
	await page.waitForTimeout(400);
	await page.screenshot({ path: join(shots, "web-overview-full.png") });
	ok("full-screen overview");

	if (errors.length > 0) throw new Error(`page errors:\n${errors.join("\n")}`);
	console.log(`web e2e passed; screenshots in ${shots}`);
} finally {
	await browser.close();
	server.kill("SIGTERM");
	await new Promise((resolve) => server.once("exit", resolve));
	if (process.env.SCREENSHOTS === undefined) rmSync(dir, { recursive: true, force: true });
}
