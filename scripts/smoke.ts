// End-to-end check of the server protocol against the offline echo model:
// send on main, fork while it runs, share a note, and check the tree.
// Run: npm run smoke (starts its own server on a temp database).
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyImmutable } from "@earendil-works/chord/delta";
import WebSocket from "ws";
import type { ClientMessage, ServerMessage, TreeIndex } from "../shared/protocol.ts";

const dir = mkdtempSync(join(tmpdir(), "pi-branches-"));
const port = 18000 + Math.floor(Math.random() * 1000);
const server = spawn(
	process.execPath,
	["--experimental-strip-types", "--no-warnings=ExperimentalWarning", "server/main.ts"],
	{ env: { ...process.env, PORT: String(port), PI_BRANCHES_DB: join(dir, "db.sqlite"), PI_MODEL: "faux/echo" }, stdio: ["ignore", "pipe", "inherit"] },
);
await new Promise<void>((resolve) => server.stdout!.on("data", (chunk) => String(chunk).includes("pi-branches on") && resolve()));

const socket = new WebSocket(`ws://localhost:${port}/ws`);
await new Promise((resolve) => socket.once("open", resolve));

let tree: TreeIndex | undefined;
const views = new Map<number, unknown>();
const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
const treeWaiters: { check: (tree: TreeIndex) => boolean; resolve: (tree: TreeIndex) => void }[] = [];

socket.on("message", (raw) => {
	const message = JSON.parse(String(raw)) as ServerMessage;
	switch (message.t) {
		case "tree":
			tree = message.tree;
			for (const waiter of [...treeWaiters]) {
				if (waiter.check(tree)) {
					treeWaiters.splice(treeWaiters.indexOf(waiter), 1);
					waiter.resolve(tree);
				}
			}
			break;
		case "view":
			views.set(message.conversationId, message.value);
			break;
		case "ops":
			views.set(message.conversationId, applyImmutable(views.get(message.conversationId), message.ops as never));
			break;
		case "ack":
			pending.get(message.requestId)?.resolve(message.result);
			break;
		case "error":
			if (message.requestId !== undefined) pending.get(message.requestId)?.reject(new Error(message.message));
			else console.error("server error:", message.message);
			break;
	}
});

let nextId = 0;
const request = <T>(message: ClientMessage): Promise<T> => {
	const requestId = String(++nextId);
	socket.send(JSON.stringify({ ...message, requestId }));
	return new Promise<T>((resolve, reject) => pending.set(requestId, { resolve: resolve as never, reject }));
};
const until = (check: (tree: TreeIndex) => boolean, label: string): Promise<TreeIndex> => {
	if (tree !== undefined && check(tree)) return Promise.resolve(tree);
	return new Promise((resolve, reject) => {
		treeWaiters.push({ check, resolve });
		setTimeout(() => reject(new Error(`timed out waiting for: ${label}`)), 15_000);
	});
};
const assert = (condition: unknown, message: string) => {
	if (!condition) throw new Error(`assertion failed: ${message}`);
	console.log(`ok - ${message}`);
};

try {
	const main = (await until((t) => t.branches.length >= 1, "root branch")).branches[0]!;
	await request({ t: "subscribe", conversationId: main.id });
	await request({ t: "send", conversationId: main.id, text: "What is a durable harness?" });
	const answered = await until((t) => t.nodes.filter((n) => n.conversationId === main.id && n.role === "assistant").length >= 1 && !t.branches[0]!.busy, "first answer");
	const firstAnswer = answered.nodes.find((n) => n.role === "assistant")!;
	assert(firstAnswer.parentId !== null, "answer hangs off the user node");

	// A second question on main, then fork from the first answer while main is still answering.
	await request({ t: "send", conversationId: main.id, text: "Now explain storage backends in depth" });
	const { conversationId: side } = await request<{ conversationId: number }>({ t: "fork", conversationId: main.id, at: firstAnswer.id, title: "Side inquiry" });
	await request({ t: "send", conversationId: side, text: "Side question: how do forks work?" });
	const both = await until(
		(t) =>
			t.nodes.filter((n) => n.conversationId === main.id && n.role === "assistant").length >= 2 &&
			t.nodes.some((n) => n.conversationId === side && n.role === "assistant") &&
			t.branches.every((b) => !b.busy),
		"both branches answered",
	);
	const sideUser = both.nodes.find((n) => n.conversationId === side && n.role === "user")!;
	assert(sideUser.parentId === firstAnswer.id, "fork's first node hangs off the fork point");
	assert(both.branches.find((b) => b.id === side)?.title === "Side inquiry", "fork keeps its title");

	// Share main's transcript into the side branch; the model sees it as a system section.
	await request({ t: "share", mode: "transcript", from: { conversationId: main.id }, to: [side], title: "Main so far" });
	const shared = await until((t) => t.nodes.some((n) => n.conversationId === side && n.role === "shared") && t.notes.length === 1, "shared marker");
	assert(shared.branches.find((b) => b.id === side)?.sharedIn === 1, "side branch sees one shared note");
	await request({ t: "subscribe", conversationId: side });
	await request({ t: "send", conversationId: side, text: "Use the shared context" });
	await until((t) => t.nodes.filter((n) => n.conversationId === side && n.role === "assistant").length >= 2 && t.branches.every((b) => !b.busy), "answer after share");
	const view = views.get(side) as { entries: { kind: string; model?: { role: string; sections?: Record<string, string> }[] }[] };
	const sections = view.entries.flatMap((e) => e.model ?? []).filter((m) => m.role === "system").map((m) => JSON.stringify(m));
	assert(sections.some((s) => s.includes("shared-context")), "shared context reached the side branch's system prompt");
	assert(views.has(main.id) && (views.get(main.id) as { entries: unknown[] }).entries.length > 0, "ops applied to main's live view");
	console.log("smoke test passed");
} finally {
	socket.close();
	server.kill("SIGTERM");
	await new Promise((resolve) => server.once("exit", resolve));
	rmSync(dir, { recursive: true, force: true });
}
