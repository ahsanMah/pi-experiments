// Terminal client for the branches server: one branch's chat at a time, with an overview
// overlay of every branch (ctrl+o or /tree) to jump, branch, edit-and-resend, and share.
// Other branches keep running on the server while you are elsewhere.
//
// Run: npm run tui   (server: npm run server; env PI_BRANCHES_URL or PORT to point elsewhere)
import {
	CombinedAutocompleteProvider,
	type Component,
	Container,
	Editor,
	isKeyRelease,
	isKeyRepeat,
	isViewportTUI,
	Key,
	matchesKey,
	ProcessTerminal,
	ScrollView,
	type SelectItem,
	type TUI,
	truncateToWidth,
	TuiAltScreen,
	VStack,
} from "@earendil-works/pi-tui";
import type { BranchInfo, ConversationId, TreeNode } from "../shared/protocol.ts";
import { BranchesClient } from "./client.ts";
import { pick, prompt, read } from "./dialogs.ts";
import { OverviewList, OverviewPanel } from "./overview.ts";
import { currentTheme, editorTheme, setTheme, SPINNER, style, THEMES } from "./theme.ts";
import { TranscriptView } from "./transcript.ts";

const url = process.env.PI_BRANCHES_URL ?? `ws://localhost:${process.env.PORT ?? 8787}/ws`;

let client: BranchesClient;
try {
	client = await BranchesClient.connect(url);
} catch (error) {
	console.error(`Could not reach the branches server at ${url}: ${error instanceof Error ? error.message : String(error)}`);
	console.error("Start it with `npm run server`, or set PI_BRANCHES_URL.");
	process.exit(1);
}

const terminal = new ProcessTerminal();
const tui: TUI = new TuiAltScreen(terminal);

const transcript = new TranscriptView();
/** One truncated line whose text changes; renders nothing while empty. */
class Line implements Component {
	#text: string;
	constructor(text = "") {
		this.#text = text;
	}
	setText(text: string): void {
		this.#text = text;
	}
	render(width: number): string[] {
		return this.#text === "" ? [] : [truncateToWidth(` ${this.#text}`, width)];
	}
	invalidate(): void {}
}

const status = new Line();
const notice = new Line();
const footer = new Line(style.dim("ctrl+o overview · ctrl+t thinking · ctrl+x tool output · /help commands · ctrl+c quit"));
const editor = new Editor(tui, editorTheme);

const commands = [
	{ name: "tree", description: "Open the branches overview (ctrl+o)" },
	{ name: "new", description: "Start a new, unrelated thread: /new [title]" },
	{ name: "fork", description: "Branch after this branch's latest message: /fork [title]" },
	{ name: "rename", description: "Rename this branch: /rename <title>" },
	{ name: "model", description: "Set this branch's model: /model [provider/id]" },
	{ name: "share-note", description: "Share a note with every branch: /share-note <text>" },
	{ name: "share", description: "Share this branch (summary or transcript) into other branches" },
	{ name: "notes", description: "Read shared notes and unshare them" },
	{ name: "suggestions", description: "Open or dismiss branches the models suggested" },
	{ name: "abort", description: "Stop this branch's current run" },
	{ name: "steer", description: "Steer the running work: /steer <text>" },
	{ name: "theme", description: `Switch colors: /theme [${Object.keys(THEMES).join("|")}]` },
	{ name: "help", description: "Show commands and keys" },
];
editor.setAutocompleteProvider(new CombinedAutocompleteProvider(commands, process.cwd()));

if (isViewportTUI(tui)) {
	// The coding agent's chat viewport: a following transcript over a fixed input dock.
	const scroll = new ScrollView(transcript, { follow: "end", primary: true, overscroll: "chain", scrollbar: "auto" });
	const dock = new VStack([
		{ component: notice, shrink: 1, minSize: 0 },
		{ component: status, shrink: 1, minSize: 0 },
		{ component: editor, shrink: 1, minSize: 3 },
		{ component: footer, shrink: 1, minSize: 0 },
	]);
	tui.setLayoutRoot(
		new VStack([
			{ component: scroll, basis: 0, grow: 1, shrink: 1, minSize: 1 },
			{ component: dock, basis: "auto", grow: 0, shrink: 1, minSize: 1 },
		]),
	);
} else {
	const root = new Container();
	for (const component of [transcript, notice, status, editor, footer]) root.addChild(component);
	tui.addChild(root);
}

// ─── State ───────────────────────────────────────────────────────────────────

let active: ConversationId = client.tree.branches[0]?.id ?? 1;
let spinnerFrame = 0;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
let overview: { panel: OverviewPanel; hide: () => void } | undefined;
let modal = false;

const spinner = () => SPINNER[spinnerFrame % SPINNER.length]!;
const branchOf = (id: ConversationId): BranchInfo | undefined => client.tree.branches.find((b) => b.id === id);
/** Branch title, with a fallback for branches the server has no title for yet. */
const titleOf = (branch: BranchInfo | undefined, _id?: ConversationId): string => branch?.title || "another branch";

const notify = (text: string, kind: "info" | "error" = "info") => {
	notice.setText(kind === "error" ? style.red(`✗ ${text}`) : style.cyan(`• ${text}`));
	if (noticeTimer !== undefined) clearTimeout(noticeTimer);
	noticeTimer = setTimeout(() => {
		notice.setText("");
		tui.requestRender();
	}, 6000);
	tui.requestRender();
};

const failed = (error: unknown) => notify(error instanceof Error ? error.message : String(error), "error");

const renderStatus = () => {
	const branch = branchOf(active);
	if (branch === undefined) {
		status.setText(style.dim("(no branch)"));
		return;
	}
	const parts: string[] = [style.bold(style.cyan(titleOf(branch)))];
	if (branch.parent !== undefined) parts.push(style.dim(`⑂ from ${titleOf(branchOf(branch.parent.conversationId), branch.parent.conversationId)}`));
	parts.push(branch.busy ? style.yellow(`${spinner()} working`) : style.green("idle"));
	if (branch.queued > 0) parts.push(style.yellow(`${branch.queued} queued`));
	if (branch.model !== undefined) parts.push(style.dim(branch.model));
	parts.push(style.dim(`$${branch.costUsd.toFixed(4)}`));
	if (branch.sharedIn > 0) parts.push(style.magenta(`⇄ ${branch.sharedIn} shared`));
	if (client.tree.suggestions.length > 0) parts.push(style.yellow(`✦ ${client.tree.suggestions.length} suggested (/suggestions)`));
	const others = client.tree.branches.filter((b) => b.id !== active && b.busy);
	parts.push(style.dim(`${client.tree.branches.length} branches`));
	if (others.length > 0) parts.push(style.yellow(`${spinner()} also working: ${others.map((b) => titleOf(b)).join(", ")}`));
	status.setText(parts.join(style.dim(" · ")));
};

const renderTranscript = () => transcript.update(active, client.views.get(active), client.tree.branches, client.tree.notes, client.tree.suggestions, spinner());

const refresh = () => {
	renderTranscript();
	renderStatus();
	if (overview !== undefined) {
		overview.panel.list.setSpinner(spinner());
		overview.panel.setTree(client.tree, active);
	}
	tui.requestRender();
};

client.onTree = refresh;
client.onView = (id) => {
	if (id === active) refresh();
};
client.onError = (message) => notify(message, "error");
client.onClose = () => {
	tui.stop();
	console.error("Disconnected from the branches server.");
	process.exit(1);
};

// Spinners only animate while something is working.
setInterval(() => {
	if (!client.tree.branches.some((b) => b.busy)) return;
	spinnerFrame++;
	refresh();
}, 100);

/** Subscribe to a branch's view and wait until it arrives. */
const ensureView = async (id: ConversationId): Promise<void> => {
	if (client.views.has(id)) return;
	await client.subscribe(id);
};

const switchTo = async (id: ConversationId) => {
	if (id === active) return;
	const previous = active;
	active = id;
	refresh();
	await ensureView(id);
	// The previous branch keeps running server-side; only this client's live stream of it stops.
	if (previous !== id) await client.unsubscribe(previous);
	refresh();
};

// ─── Actions ─────────────────────────────────────────────────────────────────

const withModal = async <T>(run: () => Promise<T>): Promise<T> => {
	modal = true;
	try {
		return await run();
	} finally {
		modal = false;
		if (overview === undefined) tui.setFocus(editor);
	}
};

const forkAt = async (conversationId: ConversationId, at: number, defaultTitle: string): Promise<ConversationId | undefined> => {
	const title = await withModal(() => prompt(tui, "Name the new branch", defaultTitle));
	if (title === undefined) return undefined;
	const { conversationId: fork } = await client.request<{ conversationId: ConversationId }>({
		t: "fork",
		conversationId,
		at,
		...(title.trim() !== "" ? { title: title.trim() } : {}),
	});
	closeOverview();
	await switchTo(fork);
	notify(`Branched "${title || titleOf(branchOf(fork))}". The source branch keeps going on its own.`);
	return fork;
};

const branchAfter = (node: TreeNode) => forkAt(node.conversationId, node.id, "").catch(failed);

const editAndResend = async (node: TreeNode) => {
	if (node.role !== "user" || node.before === undefined) {
		notify("Edit & resend works on a user message that has something before it; use b to branch instead.", "error");
		return;
	}
	await ensureView(node.conversationId);
	const entry = client.views.get(node.conversationId)?.entries.find((e) => e.id === node.id);
	const content = entry?.model?.[0]?.content;
	const text =
		typeof content === "string"
			? content
			: Array.isArray(content)
				? (content as { type: string; text?: string }[]).filter((b) => b.type === "text").map((b) => b.text ?? "").join("")
				: node.preview;
	const fork = await forkAt(node.conversationId, node.before, "");
	if (fork !== undefined) {
		editor.setText(text);
		tui.setFocus(editor);
		tui.requestRender();
	}
};

const share = async (from: { conversationId: ConversationId; at?: number }) => {
	await withModal(async () => {
		const mode = await pick(tui, "Share what?", [
			{ value: "summary", label: "Summary", description: "A model summarizes the branch through this point" },
			{ value: "transcript", label: "Transcript", description: "The branch's messages through this point, verbatim" },
		]);
		if (mode === undefined) return;
		const targets: SelectItem[] = [
			{ value: "*", label: "All branches", description: "Every branch, including ones created later" },
			...client.tree.branches
				.filter((b) => b.id !== from.conversationId)
				.map((b) => ({ value: String(b.id), label: titleOf(b), description: b.busy ? "working" : "idle" })),
		];
		const target = await pick(tui, "Share into", targets);
		if (target === undefined) return;
		const title = await prompt(tui, "Title (optional)", "");
		if (title === undefined) return;
		closeOverview();
		notify(mode === "summary" ? "Summarizing…" : "Sharing…");
		await client.request({
			t: "share",
			mode: mode as "summary" | "transcript",
			from,
			to: target === "*" ? "*" : [Number(target)],
			...(title.trim() !== "" ? { title: title.trim() } : {}),
		});
		notify(`Shared ${mode} into ${target === "*" ? "all branches" : titleOf(branchOf(Number(target)), Number(target))}.`);
	}).catch(failed);
};

const rename = async (branch: BranchInfo) => {
	const title = await withModal(() => prompt(tui, `Rename "${titleOf(branch)}"`, titleOf(branch)));
	if (title === undefined || title.trim() === "") return;
	await client.request({ t: "rename", conversationId: branch.id, title: title.trim() }).catch(failed);
};

/** A note's title from its text: the first sentence, or the first words that fit, never a cut word. */
const noteTitle = (text: string, max = 60): string => {
	const sentence = (/^[^.!?\n]+[.!?]?/.exec(text.trim())?.[0] ?? text).trim();
	if (sentence.length <= max) return sentence;
	// Cut at the last space that leaves room for the ellipsis; a first word longer than that stays whole.
	const space = sentence.lastIndexOf(" ", max - 1);
	const kept = space > 0 ? sentence.slice(0, space) : (sentence.split(/\s/)[0] ?? sentence);
	return `${kept.trimEnd()}…`;
};

const manageSuggestions = async () => {
	await withModal(async () => {
		const suggestions = client.tree.suggestions;
		if (suggestions.length === 0) {
			notify("No suggested branches. Models suggest them with suggest_branch.");
			return;
		}
		const chosen = await pick(
			tui,
			"Suggested branches",
			suggestions.map((s) => ({ value: s.id, label: s.title, description: `from ${titleOf(branchOf(s.conversationId as ConversationId))} · ${s.reason}` })),
		);
		const suggestion = suggestions.find((s) => s.id === chosen);
		if (suggestion === undefined) return;
		const action = await read(
			tui,
			suggestion.title,
			`Suggested in ${titleOf(branchOf(suggestion.conversationId as ConversationId))}: ${suggestion.reason}`,
			`The branch would start with:\n\n> ${suggestion.prompt}`,
			[
				{ key: "o", label: "open (prompt goes in the editor)" },
				{ key: "d", label: "dismiss" },
			],
		);
		if (action === "d") {
			await client.request({ t: "dismissSuggestion", id: suggestion.id });
			notify(`Dismissed "${suggestion.title}".`);
		} else if (action === "o") {
			const { conversationId, prompt: opening } = await client.request<{ conversationId: ConversationId; prompt: string }>({
				t: "acceptSuggestion",
				id: suggestion.id,
			});
			closeOverview();
			await switchTo(conversationId);
			editor.setText(opening);
			notify(`Opened "${suggestion.title}". Edit the first message and press Enter to send it.`);
		}
	}).catch(failed);
};

const manageNotes = async () => {
	await withModal(async () => {
		// Read notes one at a time; u unshares the open one, esc goes back to the list.
		for (;;) {
			const notes = client.tree.notes;
			if (notes.length === 0) {
				notify("No shared notes yet. Use /share-note, /share, or s in the overview.");
				return;
			}
			const targets = (note: (typeof notes)[number]) =>
				note.to === "*" ? "every branch" : note.to.map((id) => titleOf(branchOf(id as ConversationId), id as ConversationId)).join(", ");
			const chosen = await pick(
				tui,
				"Shared notes (enter to read)",
				notes.map((note) => ({
					value: note.id,
					label: note.title,
					description: `→ ${targets(note)} · ${note.author === "model" ? "by a model" : "by you"}`,
				})),
			);
			const note = notes.find((n) => n.id === chosen);
			if (note === undefined) return;
			const from = note.from === undefined ? "" : ` from ${titleOf(branchOf(note.from.conversationId as ConversationId), note.from.conversationId as ConversationId)}`;
			const meta = `${note.author === "model" ? "Posted by a model" : "Shared by you"}${from} → ${targets(note)} · ${new Date(note.createdAt).toLocaleString()}`;
			const action = await read(tui, note.title, meta, note.text, [{ key: "u", label: "unshare" }]);
			if (action === "u") {
				await client.request({ t: "unshare", noteId: note.id });
				notify(`Unshared "${note.title}". Branches stop seeing it from their next reply.`);
			}
		}
	}).catch(failed);
};

const closeOverview = () => {
	if (overview === undefined) return;
	overview.hide();
	overview = undefined;
	tui.setFocus(editor);
	tui.requestRender();
};

const openOverview = () => {
	if (overview !== undefined) return;
	const list = new OverviewList(
		client.tree,
		active,
		{
			jump: (node) => {
				closeOverview();
				void switchTo(node.conversationId).catch(failed);
			},
			branch: (node) => void branchAfter(node),
			edit: (node) => void editAndResend(node).catch(failed),
			share: (node) => void share({ conversationId: node.conversationId, at: node.id }),
			rename: (branch) => void rename(branch),
			close: closeOverview,
		},
		() => Math.max(5, terminal.rows - 12),
	);
	const panel = new OverviewPanel(list, client.tree);
	const handle = tui.showOverlay(panel, { width: "90%", maxHeight: "90%", anchor: "center", margin: 1 });
	overview = { panel, hide: () => handle.hide() };
	tui.requestRender();
};

// ─── Editor ──────────────────────────────────────────────────────────────────

const help = () =>
	notify(
		"Enter sends (queued after a running answer) · /steer redirects running work · ctrl+o overview: enter jump, b branch, e edit & resend, s share, r rename · " +
			commands.map((c) => `/${c.name}`).join(" "),
	);

const runCommand = async (line: string) => {
	const [name, ...rest] = line.slice(1).split(" ");
	const arg = rest.join(" ").trim();
	const branch = branchOf(active);
	switch (name) {
		case "tree":
			return openOverview();
		case "new": {
			const { conversationId } = await client.request<{ conversationId: ConversationId }>({ t: "new", ...(arg ? { title: arg } : {}) });
			await switchTo(conversationId);
			return notify("Started a new thread.");
		}
		case "fork": {
			if (branch?.tip === null || branch === undefined) return notify("Nothing to branch from yet; send a message first.", "error");
			const { conversationId } = await client.request<{ conversationId: ConversationId }>({
				t: "fork",
				conversationId: active,
				at: branch.tip,
				...(arg ? { title: arg } : {}),
			});
			await switchTo(conversationId);
			return notify(`Branched from "${titleOf(branch)}". It keeps going on its own.`);
		}
		case "rename":
			if (!arg) return branch && rename(branch);
			return client.request({ t: "rename", conversationId: active, title: arg });
		case "model": {
			const model = arg || (await withModal(() => pick(tui, "Model for this branch", client.models.map((m) => ({ value: m, label: m })))));
			if (!model) return;
			await client.request({ t: "configure", conversationId: active, model });
			return notify(`Model set to ${model} for this branch.`);
		}
		case "share-note":
			if (!arg) return notify("Usage: /share-note <text>", "error");
			await client.request({ t: "share", mode: "note", to: "*", text: arg, title: noteTitle(arg) });
			return notify("Shared with every branch.");
		case "share":
			return share({ conversationId: active });
		case "notes":
			return manageNotes();
		case "suggestions":
			return manageSuggestions();
		case "abort":
			await client.request({ t: "abort", conversationId: active });
			return notify("Stopped this branch's run.");
		case "steer":
			if (!arg) return notify("Usage: /steer <text>", "error");
			return client.request({ t: "send", conversationId: active, text: arg, whenBusy: "steer" });
		case "theme": {
			const name = arg || (await withModal(() => pick(tui, `Theme (now ${currentTheme()})`, Object.keys(THEMES).map((t) => ({ value: t, label: t })))));
			if (!name) return;
			if (!setTheme(name)) return notify(`Unknown theme "${name}". Themes: ${Object.keys(THEMES).join(", ")}.`, "error");
			refresh();
			return notify(`Theme set to ${name}.`);
		}
		case "help":
			return help();
		default:
			return notify(`Unknown command /${name}. Try /help.`, "error");
	}
};

editor.onSubmit = (value) => {
	const text = value.trim();
	if (text === "") return;
	editor.setText("");
	editor.addToHistory(text);
	const run = text.startsWith("/") ? runCommand(text) : client.request({ t: "send", conversationId: active, text, whenBusy: "followUp" });
	void Promise.resolve(run).catch(failed);
};

tui.addInputListener((data) => {
	// Listeners get every key event, including the release and repeat events terminals with the
	// Kitty keyboard protocol send (pi-tui filters those only for the focused component). Toggles
	// act on the press alone: a release must not close what the press just opened.
	if (isKeyRelease(data) || isKeyRepeat(data)) return undefined;
	if (matchesKey(data, Key.ctrl("c"))) {
		tui.stop();
		client.close();
		process.exit(0);
	}
	if (matchesKey(data, Key.ctrl("t")) && !modal) {
		transcript.setOptions({ showThinking: !transcript.options.showThinking });
		refresh();
		return { consume: true };
	}
	if (matchesKey(data, Key.ctrl("x")) && !modal) {
		transcript.setOptions({ expandTools: !transcript.options.expandTools });
		refresh();
		return { consume: true };
	}
	if (matchesKey(data, Key.ctrl("o")) && !modal) {
		if (overview === undefined) openOverview();
		else closeOverview();
		return { consume: true };
	}
	return undefined;
});

await ensureView(active);
refresh();
tui.setFocus(editor);
tui.start();
