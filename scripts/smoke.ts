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
const opsSeen = new Map<number, number>();
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
			opsSeen.set(message.conversationId, (opsSeen.get(message.conversationId) ?? 0) + 1);
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
	// A long message comes back whole for "Edit & branch", though its tree preview is cut short.
	const long = `Long question ${"with many words ".repeat(30)}end`;
	await request({ t: "send", conversationId: side, text: long });
	const longTree = await until((t) => t.nodes.some((n) => n.conversationId === side && n.preview.startsWith("Long question")), "long message node");
	const longNode = longTree.nodes.find((n) => n.conversationId === side && n.preview.startsWith("Long question"))!;
	const { text } = await request<{ text: string }>({ t: "text", conversationId: side, entryId: longNode.id });
	assert(longNode.preview.endsWith("…") && text === long, "full text of a long message is available");

	// A share with every branch leaves a marker in each existing branch.
	await until((t) => t.branches.every((b) => !b.busy), "idle before wildcard share");
	await request({ t: "share", mode: "note", to: "*", title: "For everyone", text: "Use SQLite." });
	await until(
		(t) => [main.id, side].every((id) => t.nodes.filter((n) => n.conversationId === id && n.role === "shared").length >= (id === side ? 2 : 1)),
		"wildcard share markers",
	);
	assert(true, "a share with every branch marks each branch");

	// A summary covers only the source's history after its lowest common ancestor with the target.
	const summarize = async (from: number, to: number[]) => {
		const { noteIds } = await request<{ noteIds: string[] }>({ t: "share", mode: "summary", from: { conversationId: from }, to });
		const tree = await until((t) => noteIds.every((id) => t.notes.some((n) => n.id === id)), "summary notes");
		// The first line names the shared point; the summary body follows it.
		return noteIds.map((id) => {
			const text = tree.notes.find((n) => n.id === id)!.text;
			return { text, body: text.startsWith("Branch") ? text.slice(text.indexOf("\n\n")) : text };
		});
	};
	const [fromSide] = await summarize(side, [main.id]);
	assert(
		fromSide!.text.startsWith("Branch") && fromSide!.body.includes("Side question") && !fromSide!.body.includes("durable harness"),
		`a fork's summary for its parent leaves out what they share:\n${fromSide!.text}`,
	);
	const [fromMain] = await summarize(main.id, [side]);
	assert(
		fromMain!.text.startsWith("Branch") && fromMain!.body.includes("storage backends") && !fromMain!.body.includes("durable harness") && !fromMain!.body.includes("Side question"),
		`a parent's summary for its fork covers only what came after the fork point:\n${fromMain!.text}`,
	);

	// Rapid switching leaves the subscription in its last requested state.
	for (let i = 0; i < 5; i++) {
		socket.send(JSON.stringify({ t: "unsubscribe", conversationId: main.id }));
		socket.send(JSON.stringify({ t: "subscribe", conversationId: main.id }));
	}
	await request({ t: "unsubscribe", conversationId: main.id });
	const opsBefore = opsSeen.get(main.id) ?? 0;
	await request({ t: "send", conversationId: main.id, text: "Anyone watching?" });
	await until((t) => t.branches.every((b) => !b.busy) && t.nodes.some((n) => n.preview.includes("Anyone watching")), "answer while unsubscribed");
	assert((opsSeen.get(main.id) ?? 0) === opsBefore, "no frames arrive after the last unsubscribe");

	// Each model is told where it sits; list_branches marks the caller.
	const sideView = views.get(side) as { entries: { kind: string; model?: { role: string }[] }[] };
	const prompt = JSON.stringify(sideView.entries.flatMap((e) => e.model ?? []).filter((m) => m.role === "system"));
	assert(prompt.includes("It was forked from branch") && prompt.includes("suggest_branch"), "the side branch's prompt names its fork point and the tree tools");
	await request({ t: "send", conversationId: side, text: "Please list branches" });
	const listed = await until(
		(t) => t.branches.every((b) => !b.busy) && t.nodes.some((n) => n.conversationId === side && n.preview.includes("list_branches tool replied")),
		"list_branches answer",
	);
	const listNode = listed.nodes.find((n) => n.conversationId === side && n.preview.includes("list_branches tool replied"))!;
	const { text: listing } = await request<{ text: string }>({ t: "text", conversationId: side, entryId: listNode.id });
	assert(listing.includes("(this branch)") && listing.includes("started with:"), "list_branches marks this branch and what each started with");

	// A model's suggestion becomes a branch only when opened, after the answer it came with.
	await request({ t: "send", conversationId: main.id, text: "Suggest a branch about caching strategies" });
	const suggested = await until((t) => t.suggestions.length === 1 && t.branches.every((b) => !b.busy), "a pending suggestion");
	const suggestion = suggested.suggestions[0]!;
	assert(suggestion.title === "caching strategies" && suggested.branches.length === 2, "the suggestion is pending, no branch yet");
	const opened = await request<{ conversationId: number; prompt: string }>({ t: "acceptSuggestion", id: suggestion.id });
	const withBranch = await until((t) => t.branches.some((b) => b.id === opened.conversationId) && t.suggestions.length === 0, "opened suggestion");
	const answerNode = withBranch.nodes.find((n) => n.conversationId === main.id && n.role === "assistant" && n.id > suggestion.after)!;
	const newBranch = withBranch.branches.find((b) => b.id === opened.conversationId)!;
	assert(
		newBranch.title === "caching strategies" && newBranch.parent?.conversationId === main.id && newBranch.parent.at === answerNode.id && opened.prompt.includes("caching"),
		"opening forks after the suggesting answer, titled, with the proposed prompt",
	);

	// Malformed input gets an error and the server keeps serving.
	// Targets with different common ancestors get separate notes; an unrelated root gets the whole history.
	await until((t) => t.branches.every((b) => !b.busy), "idle before split summary");
	const { conversationId: root2 } = await request<{ conversationId: number }>({ t: "new", title: "Unrelated" });
	const split = await summarize(main.id, [side, root2]);
	assert(
		split.length === 2 && split.some((n) => n.text.includes("durable harness") && !n.text.startsWith("Branch")),
		"targets with different common ancestors get separate notes; an unrelated branch gets the whole history",
	);

	socket.send("null");
	socket.send("42");
	await request({ t: "rename", conversationId: side, title: "Still alive" });
	assert(true, "server survives null and non-object messages");
	console.log("smoke test passed");
} finally {
	socket.close();
	server.kill("SIGTERM");
	await new Promise((resolve) => server.once("exit", resolve));
	rmSync(dir, { recursive: true, force: true });
}
