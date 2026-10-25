<script lang="ts">
	import { untrack } from "svelte";
	import type { BranchInfo, ShareMode, TreeIndex, TreeNode } from "../../../shared/protocol.ts";
	import type { BranchesClient } from "../../src/lib/client.svelte.ts";
	import { branchHue } from "../../src/lib/layout.ts";
	import Board, { type Section } from "./components/Board.svelte";
	import Focus from "./components/Focus.svelte";
	import Inbox from "./components/Inbox.svelte";
	import Palette, { type Option, type PaletteItem, type PalettePage } from "./components/Palette.svelte";
	import ShareSheet, { type ShareDraft } from "./components/ShareSheet.svelte";
	import StatusIcon from "./components/StatusIcon.svelte";
	import { erroredOf, isTyping, lineage, liveText, runningTools, STATUS_LABEL, STATUS_ORDER, statusOf, tipPreview, treeOrder, type FeedEvent, type Row } from "./lib.ts";

	let { client, demo = false }: { client: BranchesClient; demo?: boolean } = $props();

	// Per-viewer conveniences; storage may be unavailable (private windows, sandboxes).
	const stored = (key: string): string | null => {
		try {
			return localStorage.getItem(`mission.${key}`);
		} catch {
			return null;
		}
	};
	const store = (key: string, value: string) => {
		try {
			localStorage.setItem(`mission.${key}`, value);
		} catch {}
	};

	const fromHash = () => {
		const match = /b=(\d+)/.exec(location.hash);
		return match ? Number(match[1]) : undefined;
	};

	let openId = $state<number | undefined>(fromHash());
	let cursorId = $state<number | undefined>(fromHash());
	let focusId = $state<number | null>(null);
	let focusComposer = $state(0);
	let drafts = $state<Record<number, string>>({});
	let selected = $state<Set<number>>(new Set());
	let selectMode = $state(false);
	let tab = $state<"branches" | "context">("branches");
	let grouping = $state<"status" | "tree">(stored("grouping") === "tree" ? "tree" : "status");
	let palette = $state<{ start?: PalettePage } | undefined>();
	let shareDraft = $state<ShareDraft | undefined>();
	let bulkText = $state("");
	let notices = $state<{ id: number; text: string; tone: "ok" | "err" }[]>([]);
	let seen = $state<Record<number, number | null>>({});
	let feed = $state<FeedEvent[]>([]);
	let now = $state(Date.now());

	// Theme: an explicit choice wins, then a data-theme the host page set, then the system setting.
	type Theme = "system" | "light" | "dark";
	const hostTheme = document.documentElement.dataset.theme;
	let theme = $state<Theme>((stored("theme") as Theme | null) ?? (hostTheme === "light" || hostTheme === "dark" ? hostTheme : "system"));
	$effect(() => {
		if (theme === "system") delete document.documentElement.dataset.theme;
		else document.documentElement.dataset.theme = theme;
		store("theme", theme);
	});
	$effect(() => store("grouping", grouping));

	// The chat is a side panel on wide screens and a full-screen sheet on phones.
	const wideQuery = matchMedia("(min-width: 761px)");
	let wide = $state(wideQuery.matches);
	$effect(() => {
		const update = () => (wide = wideQuery.matches);
		wideQuery.addEventListener("change", update);
		const timer = setInterval(() => (now = Date.now()), 5000);
		return () => {
			wideQuery.removeEventListener("change", update);
			clearInterval(timer);
		};
	});

	const tree = $derived(client.tree);
	const branches = $derived(tree.branches);
	const byId = $derived(new Map(branches.map((b) => [b.id, b])));
	const open = $derived(openId === undefined ? undefined : byId.get(openId));
	// Keyboard and palette commands act on the highlighted row, which follows the open branch.
	const target = $derived((cursorId === undefined ? undefined : byId.get(cursorId)) ?? open);
	const busy = $derived(branches.filter((b) => b.busy));

	// Live views for every branch (capped), so the board can show streaming text and errors.
	$effect(() => {
		const ids = [
			...(openId !== undefined ? [openId] : []),
			...branches.filter((b) => b.busy).map((b) => b.id),
			...selected,
			...branches.map((b) => b.id),
		];
		client.watch([...new Set(ids)].filter((id) => byId.has(id)).slice(0, 40));
	});

	// Wide screens open the first branch so the chat is never empty; phones start on the board.
	let opened = false;
	$effect(() => {
		if (branches.length === 0) return;
		untrack(() => {
			if (openId !== undefined && !byId.has(openId)) openId = undefined;
			if (!opened && openId === undefined && wide) openId = branches[0]!.id;
			if (cursorId === undefined || !byId.has(cursorId)) cursorId = openId ?? branches[0]!.id;
			opened = true;
		});
	});
	$effect(() => {
		const id = openId;
		try {
			history.replaceState(null, "", id === undefined ? location.pathname + location.search : `#b=${id}`);
		} catch {
			// Sandboxed frames may refuse URL changes; the open branch just isn't kept in the URL.
		}
	});

	// "Done · unread": new output since this viewer last had the branch open.
	$effect(() => {
		const list = branches;
		const current = open;
		untrack(() => {
			const next = { ...seen };
			let changed = false;
			for (const b of list) {
				if (!(b.id in next)) {
					next[b.id] = b.tip;
					changed = true;
				}
			}
			if (current !== undefined && next[current.id] !== current.tip) {
				next[current.id] = current.tip;
				changed = true;
			}
			if (changed) seen = next;
		});
	});

	// Activity log: diff each tree against the previous one, like a CI event stream.
	let previous: TreeIndex | undefined;
	let eventId = 0;
	$effect(() => {
		const next = tree;
		untrack(() => {
			const events: FeedEvent[] = [];
			const at = Date.now();
			const add = (kind: FeedEvent["kind"], text: string, branchId?: number) =>
				events.push({ id: ++eventId, at, kind, text, ...(branchId !== undefined ? { branchId } : {}) });
			if (previous === undefined) {
				if (next.branches.length === 0) return;
				add("start", `Connected · ${next.branches.length} branches, ${next.notes.length} shared note${next.notes.length === 1 ? "" : "s"}`);
			} else {
				const before = new Map(previous.branches.map((b) => [b.id, b]));
				for (const b of next.branches) {
					const old = before.get(b.id);
					if (old === undefined) {
						const parent = b.parent === undefined ? undefined : next.branches.find((p) => p.id === b.parent!.conversationId);
						add(parent ? "fork" : "new", parent ? `${b.title} forked from ${parent.title}` : `New thread ${b.title}`, b.id);
					} else if (!old.busy && b.busy) add("start", `${b.title} started running`, b.id);
					else if (old.busy && !b.busy) {
						const failed = erroredOf(b, client.views[b.id]);
						add(failed ? "error" : "finish", failed ? `${b.title} failed` : `${b.title} finished`, b.id);
					} else if (old.title !== b.title) add("fork", `${old.title} renamed to ${b.title}`, b.id);
				}
				const oldNotes = new Set(previous.notes.map((n) => n.id));
				const newNotes = new Set(next.notes.map((n) => n.id));
				for (const note of next.notes) {
					if (oldNotes.has(note.id)) continue;
					const to = note.to === "*" ? "every branch" : note.to.map((id) => next.branches.find((b) => b.id === id)?.title ?? `#${id}`).join(", ");
					add("note", `${note.author === "model" ? "A model" : "You"} shared ${note.title} → ${to}`);
				}
				for (const note of previous.notes) if (!newNotes.has(note.id)) add("unshare", `Unshared ${note.title}`);
			}
			previous = next;
			if (events.length > 0) feed = [...events.reverse(), ...feed].slice(0, 40);
		});
	});

	const nodeById = $derived(new Map(tree.nodes.map((n) => [n.id, n])));
	const messageCount = $derived.by(() => {
		const counts = new Map<number, number>();
		for (const node of tree.nodes) if (node.role === "user" || node.role === "assistant") counts.set(node.conversationId, (counts.get(node.conversationId) ?? 0) + 1);
		return counts;
	});

	const rows = $derived(
		treeOrder(branches).map(({ branch, depth }): Row => {
			const view = client.views[branch.id];
			const parent = branch.parent === undefined ? undefined : byId.get(branch.parent.conversationId);
			const preview = tipPreview(nodeById, branch);
			return {
				branch,
				depth,
				status: statusOf(branch, view, seen[branch.id]),
				live: liveText(view),
				tools: runningTools(view),
				messages: messageCount.get(branch.id) ?? 0,
				hue: branchHue(branch.id),
				...(preview !== undefined ? { preview } : {}),
				...(parent !== undefined ? { origin: parent.title } : {}),
			};
		}),
	);
	const sections = $derived.by((): Section[] => {
		const out: Section[] =
			grouping === "tree"
				? [{ key: "tree", label: "All branches", rows }]
				: STATUS_ORDER.map((status) => ({ key: status, label: STATUS_LABEL[status], status, rows: rows.filter((r) => r.status === status) })).filter(
						(s) => s.rows.length > 0,
					);
		let key = 0;
		for (const section of out) for (const row of section.rows) if (key < 9) row.key = ++key;
		return out;
	});
	const order = $derived(sections.flatMap((s) => s.rows.map((r) => r.branch.id)));
	const rowById = $derived(new Map(rows.map((r) => [r.branch.id, r])));
	const counts = $derived({
		running: busy.length,
		queued: branches.reduce((sum, b) => sum + b.queued, 0),
		cost: branches.reduce((sum, b) => sum + b.costUsd, 0),
		unread: rows.filter((r) => r.status === "done").length,
		errored: rows.filter((r) => r.status === "errored").length,
	});

	// ── actions ──────────────────────────────────────────────────────────

	let noticeId = 0;
	const notify = (text: string, tone: "ok" | "err" = "ok") => {
		const id = ++noticeId;
		notices = [...notices.slice(-3), { id, text, tone }];
		setTimeout(() => (notices = notices.filter((n) => n.id !== id)), tone === "err" ? 6000 : 2600);
	};
	const fail = (error: unknown) => notify(error instanceof Error ? error.message : String(error), "err");

	const openBranch = (id: number, entry: number | null = null, focus = false) => {
		openId = id;
		cursorId = id;
		focusId = entry;
		tab = "branches";
		if (focus && wide) focusComposer++;
	};
	const titleOf = (id: number) => byId.get(id)?.title ?? `#${id}`;

	const fork = async (conversationId: number, at: number, draft = "") => {
		const { conversationId: id } = await client.request<{ conversationId: number }>({ t: "fork", conversationId, at });
		drafts[id] = draft;
		openBranch(id, null, true);
		notify(`Branched from ${titleOf(conversationId)} — it keeps running on its own`);
	};
	const forkTip = (branch: BranchInfo | undefined) => {
		if (branch === undefined || branch.tip === null) return;
		void fork(branch.id, branch.tip).catch(fail);
	};
	const editBranch = async (node: TreeNode) => {
		if (node.before === undefined) return;
		// The tree's preview is cut short; ask for the message itself.
		const { text } = await client.request<{ text: string }>({ t: "text", conversationId: node.conversationId, entryId: node.id });
		await fork(node.conversationId, node.before, text);
	};
	const newThread = async (title?: string) => {
		const { conversationId } = await client.request<{ conversationId: number }>({ t: "new", ...(title ? { title } : {}) });
		openBranch(conversationId, null, true);
	};
	const send = (conversationId: number, text: string, whenBusy: "followUp" | "steer") =>
		client.request({ t: "send", conversationId, text, whenBusy }).catch((e) => {
			fail(e);
			throw e;
		});
	const abort = (id: number) => void client.request({ t: "abort", conversationId: id }).catch(fail);
	const stopAll = () => {
		for (const b of busy) abort(b.id);
		if (busy.length > 0) notify(`Stopping ${busy.length} running branch${busy.length === 1 ? "" : "es"}`);
	};
	const rename = (id: number, title: string) => client.request({ t: "rename", conversationId: id, title });
	const configure = (id: number, model: string) => client.request({ t: "configure", conversationId: id, model });
	const unshare = (noteId: string) => void client.request({ t: "unshare", noteId }).catch(fail);

	const share = async (draft: ShareDraft, payload: { mode: ShareMode; to: number[] | "*"; title: string; text: string }) => {
		await client.request({
			t: "share",
			mode: payload.mode,
			to: payload.to,
			...(draft.from !== undefined ? { from: draft.from } : {}),
			...(payload.title.trim() !== "" ? { title: payload.title.trim() } : {}),
			...(payload.text.trim() !== "" ? { text: payload.text.trim() } : {}),
		});
		const count = payload.to === "*" ? "every branch" : `${payload.to.length} branch${payload.to.length === 1 ? "" : "es"}`;
		notify(`Shared ${payload.mode} with ${count}`);
	};
	const shareFrom = (id: number, at?: number) => {
		const to = [...selected].filter((s) => s !== id);
		shareDraft = { from: { conversationId: id, ...(at !== undefined ? { at } : {}) }, ...(to.length > 0 ? { to } : {}) };
	};

	const bulkSend = async (text: string, ids: number[]) => {
		await Promise.all(ids.map((id) => client.request({ t: "send", conversationId: id, text, whenBusy: "followUp" })));
		notify(`Sent to ${ids.length} branch${ids.length === 1 ? "" : "es"}; busy ones queue it`);
	};
	const toggle = (id: number) => {
		const next = new Set(selected);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selected = next;
	};
	const toggleMany = (ids: number[]) => {
		const next = new Set(selected);
		const allOn = ids.every((id) => next.has(id));
		for (const id of ids) {
			if (allOn) next.delete(id);
			else next.add(id);
		}
		selected = next;
	};
	const clearSelection = () => {
		selected = new Set();
		selectMode = false;
	};

	// ── command palette ──────────────────────────────────────────────────

	const targetOptions = (exclude?: number): Option[] => [
		{ value: "*", label: "Every branch", detail: "including ones made later" },
		...treeOrder(branches)
			.filter(({ branch }) => branch.id !== exclude)
			.map(({ branch }) => ({ value: branch.id, label: branch.title, hue: branchHue(branch.id), detail: STATUS_LABEL[rowById.get(branch.id)?.status ?? "idle"] })),
	];
	const pickTargets = (title: string, exclude: number | undefined, done: (to: number[] | "*") => Promise<void>): PalettePage => ({
		kind: "multi",
		title,
		placeholder: "Pick branches to share with…",
		options: targetOptions(exclude),
		initial: [...selected].filter((id) => id !== exclude),
		confirmLabel: (n) => (n < 0 ? "Share with every branch" : `Share with ${n} branch${n === 1 ? "" : "es"}`),
		confirm: done,
	});
	const sharePage = (branch: BranchInfo, mode: "summary" | "transcript"): PalettePage =>
		pickTargets(`Share ${mode} of ${branch.title}`, branch.id, (to) => share({ from: { conversationId: branch.id } }, { mode, to, title: "", text: "" }));
	const notePage = (): PalettePage => ({
		kind: "input",
		title: "Write a note",
		placeholder: "What should the other branches know?",
		confirmLabel: "Choose targets",
		submit: (text) => pickTargets("Note → targets", undefined, (to) => share({}, { mode: "note", to, title: "", text })),
	});
	const renamePage = (branch: BranchInfo): PalettePage => ({
		kind: "input",
		title: `Rename ${branch.title}`,
		placeholder: "New title",
		initial: branch.title,
		confirmLabel: "Rename",
		submit: (title) => rename(branch.id, title).then(() => notify(`Renamed to ${title}`)),
	});
	const modelPage = (branch: BranchInfo): PalettePage => ({
		kind: "list",
		title: `Model for ${branch.title}`,
		placeholder: "Search models…",
		items: client.models.map((model) => ({
			id: `model:${model}`,
			label: model,
			group: "Models",
			icon: model === branch.model ? "✓" : "",
			...(model === client.defaultModel ? { detail: "default" } : {}),
			run: () => configure(branch.id, model).then(() => notify(`${branch.title} now uses ${model}`)),
		})),
	});
	const bulkPage = (ids: number[]): PalettePage => ({
		kind: "input",
		title: `Send to ${ids.length} selected`,
		placeholder: "Follow-up for every selected branch…",
		confirmLabel: `Send to ${ids.length}`,
		submit: (text) => bulkSend(text, ids),
	});
	const nextTheme = (): Theme => (theme === "system" ? "dark" : theme === "dark" ? "light" : "system");

	const commands = $derived.by((): PaletteItem[] => {
		const t = target;
		const items: PaletteItem[] = [];
		const act = (item: Omit<PaletteItem, "group">) => items.push({ ...item, group: t ? `Actions · ${t.title}` : "Actions" });
		if (t) {
			if (t.tip !== null) act({ id: "branch", icon: "⑂", label: "Branch from here", detail: "a new branch after the latest message", shortcut: "b", keywords: "fork", run: () => fork(t.id, t.tip!) });
			act({ id: "share-summary", icon: "⇄", label: `Share summary of ${t.title} to…`, shortcut: "s", keywords: "context", run: () => sharePage(t, "summary") });
			act({ id: "share-transcript", icon: "⇄", label: `Share transcript of ${t.title} to…`, keywords: "context", run: () => sharePage(t, "transcript") });
			act({ id: "rename", icon: "✎", label: "Rename…", shortcut: "r", detail: t.title, run: () => renamePage(t) });
			act({ id: "model", icon: "◇", label: "Change model…", shortcut: "m", detail: t.model, run: () => modelPage(t) });
			if (t.busy) act({ id: "stop", icon: "■", label: `Stop ${t.title}`, shortcut: "x", keywords: "abort cancel", run: () => abort(t.id) });
		}
		const global = (item: Omit<PaletteItem, "group">) => items.push({ ...item, group: "Mission" });
		global({ id: "new", icon: "＋", label: "New branch", detail: "an unrelated thread", shortcut: "n", keywords: "create thread root", run: () => newThread() });
		global({ id: "note", icon: "✦", label: "Write a note to…", keywords: "share context", run: notePage });
		if (busy.length > 0) global({ id: "stop-all", icon: "■", label: "Stop all running", detail: `${busy.length} running`, shortcut: "⇧X", keywords: "abort", run: stopAll });
		if (selected.size > 0) {
			const ids = [...selected];
			global({ id: "bulk-send", icon: "↗", label: `Send to ${ids.length} selected…`, keywords: "bulk broadcast follow-up", run: () => bulkPage(ids) });
			global({ id: "bulk-note", icon: "✦", label: `Share a note to ${ids.length} selected…`, keywords: "bulk", run: () => void (shareDraft = { mode: "note", to: ids }) });
			global({ id: "bulk-clear", icon: "✕", label: "Clear selection", run: clearSelection });
		}
		global({ id: "inbox", icon: "⇄", label: tab === "context" ? "Show branches" : "Open context inbox", detail: `${tree.notes.length} shared notes`, shortcut: "i", run: () => void (tab = tab === "context" ? "branches" : "context") });
		global({ id: "group", icon: "≡", label: grouping === "status" ? "Group as tree" : "Group by status", shortcut: "g", keywords: "view layout", run: () => void (grouping = grouping === "status" ? "tree" : "status") });
		global({ id: "theme", icon: "◐", label: `Theme: ${nextTheme()}`, detail: `now ${theme}`, keywords: "dark light appearance", run: () => void (theme = nextTheme()) });

		for (const { branch } of treeOrder(branches)) {
			const row = rowById.get(branch.id);
			items.push({
				id: `branch:${branch.id}`,
				group: "Switch to…",
				label: branch.title,
				hue: branchHue(branch.id),
				detail: [STATUS_LABEL[row?.status ?? "idle"], row?.origin ? `from ${row.origin}` : "", branch.model ?? ""].filter(Boolean).join(" · "),
				...(row?.key !== undefined ? { shortcut: String(row.key) } : {}),
				run: () => openBranch(branch.id, null, true),
				...(branch.tip !== null ? { alt: { label: "branch from its tip", run: () => fork(branch.id, branch.tip!) } } : {}),
			});
		}
		// Message search over the tree's previews; opening one scrolls the chat to it.
		for (const node of tree.nodes) {
			if (node.role !== "user" && node.role !== "assistant") continue;
			items.push({
				id: `node:${node.id}`,
				group: "Messages",
				searchOnly: true,
				icon: node.role === "user" ? "›" : "◆",
				label: node.preview,
				detail: titleOf(node.conversationId),
				run: () => openBranch(node.conversationId, node.id),
				alt: { label: "branch from this message", run: () => fork(node.conversationId, node.id) },
			});
		}
		return items;
	});

	const openPalette = (start?: PalettePage) => (palette = start === undefined ? {} : { start });

	// ── keyboard ─────────────────────────────────────────────────────────

	const move = (delta: number) => {
		if (order.length === 0) return;
		const index = cursorId === undefined ? -1 : order.indexOf(cursorId);
		cursorId = order[Math.min(Math.max(index + delta, 0), order.length - 1)];
	};

	const onKey = (event: KeyboardEvent) => {
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
			event.preventDefault();
			palette = palette === undefined ? {} : undefined;
			return;
		}
		if (palette !== undefined || shareDraft !== undefined) return;
		if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
		const t = target;
		const key = event.key;
		const handled = (() => {
			if (key === "j" || key === "ArrowDown") move(1);
			else if (key === "k" || key === "ArrowUp") move(-1);
			else if ((key === "Enter" || key === "o") && cursorId !== undefined) openBranch(cursorId, null, true);
			else if (key === " " && cursorId !== undefined) toggle(cursorId);
			else if (key === "b") forkTip(t);
			else if (key === "s" && t) shareFrom(t.id);
			else if (key === "x" && t?.busy) abort(t.id);
			else if (key === "X") stopAll();
			else if (key === "n") void newThread().catch(fail);
			else if (key === "r" && t) openPalette(renamePage(t));
			else if (key === "m" && t) openPalette(modelPage(t));
			else if (key === "i") tab = tab === "context" ? "branches" : "context";
			else if (key === "g") grouping = grouping === "status" ? "tree" : "status";
			else if (key === "/") openPalette();
			else if (/^[1-9]$/.test(key) && order[Number(key) - 1] !== undefined) openBranch(order[Number(key) - 1]!, null, true);
			else if (key === "Escape") {
				if (selected.size > 0 || selectMode) clearSelection();
				else if (openId !== undefined) openId = undefined;
				else return false;
			} else return false;
			return true;
		})();
		if (handled) event.preventDefault();
	};
</script>

<svelte:window onkeydown={onKey} />

{#if demo}
	<div class="demo-banner">
		<span class="demo-tag">Demo</span>
		<span class="demo-text">The branches server runs inside this page with an offline echo model; nothing is saved.</span>
		<a href="https://github.com/ahsanMah/pi-experiments" target="_blank" rel="noreferrer noopener">Run it with real models →</a>
	</div>
{/if}

<header class="topbar">
	<div class="brand">
		<span class="logo" aria-hidden="true"><i></i><i></i><i></i></span>
		<span class="name">Pi Branches</span>
		<span class="slash">/</span>
		<span class="sub">Mission Control</span>
	</div>
	<div class="stats" aria-label="Summary">
		<span class="stat run" class:zero={counts.running === 0}><StatusIcon status={counts.running > 0 ? "running" : "idle"} size={10} /> <b class="mono">{counts.running}</b> running</span>
		{#if counts.queued > 0}<span class="stat warn"><b class="mono">{counts.queued}</b> queued</span>{/if}
		{#if counts.unread > 0}<span class="stat ok"><b class="mono">{counts.unread}</b> unread</span>{/if}
		{#if counts.errored > 0}<span class="stat err"><b class="mono">{counts.errored}</b> failed</span>{/if}
		<span class="stat"><b class="mono">{branches.length}</b> branches</span>
		<span class="stat"><b class="mono">${counts.cost.toFixed(counts.cost > 0 && counts.cost < 0.01 ? 4 : 2)}</b> spent</span>
	</div>
	<button class="search" onclick={() => openPalette()} aria-label="Open the command palette">
		<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5l3 3" /></svg>
		<span class="search-text">Search or run a command…</span>
		<kbd>⌘K</kbd>
	</button>
	<div class="top-actions">
		{#if busy.length > 1}<button class="btn sm danger stop-all" onclick={stopAll} title="Stop every running branch (⇧X)">■ Stop all</button>{/if}
		<button class="btn ghost sm theme" onclick={() => (theme = nextTheme())} title="Theme: {theme}" aria-label="Theme: {theme}">
			<svg viewBox="0 0 16 16" aria-hidden="true">
				{#if theme === "dark"}
					<path d="M13 9.6A5.5 5.5 0 0 1 6.4 3a5.5 5.5 0 1 0 6.6 6.6z" />
				{:else if theme === "light"}
					<circle cx="8" cy="8" r="2.8" /><path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" />
				{:else}
					<rect x="2" y="3" width="12" height="8.5" rx="1.5" /><path d="M5.5 14h5" />
				{/if}
			</svg>
		</button>
		<button class="btn sm primary" onclick={() => void newThread().catch(fail)} title="New branch (n)">＋ New</button>
	</div>
</header>

<div class="workspace" class:with-focus={open !== undefined}>
	<section class="left" aria-label="Board">
		<div class="toolbar">
			<div class="tabs" role="tablist">
				<button role="tab" aria-selected={tab === "branches"} class:on={tab === "branches"} onclick={() => (tab = "branches")}>
					Branches <span class="count mono">{branches.length}</span>
				</button>
				<button role="tab" aria-selected={tab === "context"} class:on={tab === "context"} onclick={() => (tab = "context")}>
					Context <span class="count mono">{tree.notes.length}</span>
				</button>
			</div>
			<span class="spacer"></span>
			{#if tab === "branches"}
				<button class="btn ghost sm" class:pressed={selectMode || selected.size > 0} onclick={() => (selectMode || selected.size > 0 ? clearSelection() : (selectMode = true))}>
					{selectMode || selected.size > 0 ? "Done" : "Select"}
				</button>
				<div class="seg" role="radiogroup" aria-label="Group by">
					<button role="radio" aria-checked={grouping === "status"} class:on={grouping === "status"} onclick={() => (grouping = "status")}>Status</button>
					<button role="radio" aria-checked={grouping === "tree"} class:on={grouping === "tree"} onclick={() => (grouping = "tree")}>Tree</button>
				</div>
			{/if}
		</div>

		<div class="pane">
			{#if branches.length === 0}
				<div class="connecting"><StatusIcon status="running" /> {client.connected ? "Loading the tree…" : "Connecting to the branches server…"}</div>
			{:else if tab === "branches"}
				<Board
					{sections}
					tree={grouping === "tree"}
					selecting={selectMode}
					{cursorId}
					{openId}
					{selected}
					{feed}
					{now}
					open={(id) => openBranch(id, null, true)}
					{toggle}
					{toggleMany}
				/>
			{:else}
				<Inbox notes={tree.notes} {branches} {openId} {now} open={(id, entry) => openBranch(id, entry ?? null)} {unshare} compose={() => (shareDraft = { mode: "note" })} />
			{/if}
		</div>

		{#if selected.size > 0}
			{@const ids = [...selected].filter((id) => byId.has(id))}
			<form
				class="bulk"
				onsubmit={(e) => {
					e.preventDefault();
					const text = bulkText.trim();
					if (text === "") return;
					void bulkSend(text, ids)
						.then(() => (bulkText = ""))
						.catch(fail);
				}}
			>
				<span class="bulk-count"><b class="mono">{ids.length}</b> selected</span>
				<input bind:value={bulkText} placeholder="Send a follow-up to all {ids.length}…" aria-label="Follow-up for the selected branches" onkeydown={(e) => e.key === "Escape" && (e.currentTarget.blur(), clearSelection())} />
				<button class="btn sm primary" type="submit" disabled={bulkText.trim() === ""}>Send</button>
				<button class="btn sm" type="button" onclick={() => (shareDraft = { mode: "note", to: ids })}>✦ Note</button>
				{#if ids.some((id) => byId.get(id)?.busy)}<button class="btn sm danger" type="button" onclick={() => ids.forEach((id) => byId.get(id)?.busy && abort(id))}>■ Stop</button>{/if}
				<button class="btn ghost sm" type="button" onclick={clearSelection} aria-label="Clear selection">✕</button>
			</form>
		{/if}
	</section>

	{#if open}
		{@const branch = open}
		<section class="right">
			{#key branch.id}
				<Focus
					{branch}
					status={rowById.get(branch.id)?.status ?? "idle"}
					view={client.views[branch.id]}
					nodes={tree.nodes}
					models={client.models}
					crumbs={lineage(branches, branch.id)}
					forks={branches.filter((b) => b.parent?.conversationId === branch.id)}
					{focusId}
					{focusComposer}
					bind:draft={() => drafts[branch.id] ?? "", (value) => (drafts[branch.id] = value)}
					send={async (text, whenBusy) => {
						focusId = null;
						await send(branch.id, text, whenBusy);
					}}
					abort={() => abort(branch.id)}
					fork={(at) => void fork(branch.id, at).catch(fail)}
					editBranch={(node) => void editBranch(node).catch(fail)}
					share={(at) => shareFrom(branch.id, at)}
					rename={(title) => void rename(branch.id, title).catch(fail)}
					configure={(model) => void configure(branch.id, model).catch(fail)}
					open={(id, entry) => openBranch(id, entry ?? null)}
					close={() => (openId = undefined)}
				/>
			{/key}
		</section>
	{/if}
</div>

<footer class="statusbar">
	<span class="conn" class:off={!client.connected}><i></i>{client.connected ? "Connected" : "Reconnecting…"}</span>
	{#if client.defaultModel}<span class="mono faint">default {client.defaultModel}</span>{/if}
	<span class="spacer"></span>
	<span class="keys">
		<span><kbd>j</kbd><kbd>k</kbd> move</span>
		<span><kbd>↵</kbd> open</span>
		<span><kbd>space</kbd> select</span>
		<span><kbd>b</kbd> branch</span>
		<span><kbd>s</kbd> share</span>
		<span><kbd>x</kbd> stop</span>
		<span><kbd>1</kbd>–<kbd>9</kbd> jump</span>
		<span><kbd>⌘K</kbd> commands</span>
	</span>
</footer>

{#if palette !== undefined}
	<Palette items={commands} start={palette.start} close={() => (palette = undefined)} />
{/if}

{#if shareDraft}
	{@const draft = shareDraft}
	<ShareSheet {draft} {branches} nodes={tree.nodes} submit={(payload) => share(draft, payload)} close={() => (shareDraft = undefined)} />
{/if}

{#if notices.length > 0 || client.errors.length > 0}
	<div class="toasts" class:lifted={selected.size > 0} aria-live="polite">
		{#each client.errors as error, index (index)}
			<button class="toast err" onclick={() => client.dismissError(index)}>{error}</button>
		{/each}
		{#each notices as notice (notice.id)}
			<div class="toast {notice.tone}">{notice.text}</div>
		{/each}
	</div>
{/if}

<style>
	.demo-banner {
		display: flex;
		align-items: center;
		gap: 10px;
		height: 30px;
		flex: none;
		padding: 0 16px;
		font-size: 12px;
		color: var(--text-2);
		background: var(--accent-soft);
		border-bottom: 1px solid var(--line);
		white-space: nowrap;
		overflow: hidden;
	}
	.demo-tag {
		flex: none;
		padding: 0 6px;
		border-radius: 4px;
		background: var(--accent);
		color: white;
		font-size: 10.5px;
		font-weight: 650;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		line-height: 17px;
	}
	.demo-text {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.demo-banner a {
		flex: none;
		color: var(--accent);
		font-weight: 550;
		text-decoration: none;
	}
	.topbar {
		display: flex;
		align-items: center;
		gap: 16px;
		flex: none;
		height: 50px;
		padding: 0 14px 0 16px;
		background: var(--panel);
		border-bottom: 1px solid var(--line);
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: none;
		font-weight: 650;
	}
	.logo {
		display: grid;
		grid-template-columns: repeat(3, 4px);
		align-items: end;
		gap: 2px;
		width: 22px;
		height: 22px;
		padding: 4px;
		box-sizing: border-box;
		border-radius: 6px;
		background: var(--text);
	}
	.logo i {
		display: block;
		border-radius: 1px;
		background: var(--panel);
	}
	.logo i:nth-child(1) {
		height: 8px;
	}
	.logo i:nth-child(2) {
		height: 14px;
		background: var(--run);
	}
	.logo i:nth-child(3) {
		height: 10px;
	}
	.slash {
		color: var(--text-3);
		font-weight: 400;
	}
	.sub {
		color: var(--text-2);
		font-weight: 550;
	}
	.stats {
		display: flex;
		align-items: center;
		gap: 14px;
		min-width: 0;
		overflow: hidden;
		font-size: 12px;
		color: var(--text-2);
		white-space: nowrap;
	}
	.stat {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}
	.stat b {
		color: var(--text);
		font-weight: 600;
	}
	.stat.run b {
		color: var(--run);
	}
	.stat.run.zero b {
		color: var(--text-2);
	}
	.stat.warn b {
		color: var(--warn);
	}
	.stat.ok b {
		color: var(--ok);
	}
	.stat.err b {
		color: var(--err);
	}
	.search {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 0 1 340px;
		min-width: 0;
		height: 32px;
		margin-left: auto;
		padding: 0 6px 0 10px;
		border: 1px solid var(--line-strong);
		border-radius: 8px;
		background: var(--bg);
		color: var(--text-3);
		font-size: 12.5px;
		text-align: left;
	}
	.search:hover {
		border-color: var(--accent-line);
		color: var(--text-2);
	}
	.search svg {
		flex: none;
		width: 14px;
		height: 14px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.6;
		stroke-linecap: round;
	}
	.search-text {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.top-actions {
		display: flex;
		align-items: center;
		gap: 6px;
		flex: none;
	}
	.theme {
		width: 28px;
		justify-content: center;
		padding: 0;
	}
	.theme svg {
		width: 15px;
		height: 15px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.4;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.workspace {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		flex: 1;
		min-height: 0;
	}
	.workspace.with-focus {
		grid-template-columns: minmax(0, 1fr) clamp(440px, 44vw, 720px);
	}
	.left {
		position: relative;
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
	}
	.right {
		min-width: 0;
		min-height: 0;
		border-left: 1px solid var(--line);
		box-shadow: -12px 0 32px -24px rgb(0 0 0 / 0.25);
	}
	.toolbar {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: none;
		height: 44px;
		padding: 0 16px 0 12px;
	}
	.tabs {
		display: flex;
		gap: 2px;
	}
	.tabs button {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 28px;
		padding: 0 10px;
		border: none;
		border-radius: 7px;
		background: none;
		color: var(--text-2);
		font-size: 13px;
		font-weight: 550;
	}
	.tabs button:hover {
		color: var(--text);
		background: var(--hover);
	}
	.tabs button.on {
		color: var(--text);
		background: var(--sunken);
		box-shadow: inset 0 0 0 1px var(--line);
	}
	.count {
		padding: 0 5px;
		border-radius: 4px;
		background: var(--line);
		color: var(--text-2);
		font-size: 10.5px;
		line-height: 16px;
	}
	.spacer {
		flex: 1;
	}
	.pressed {
		color: var(--accent);
		background: var(--accent-soft);
	}
	.seg {
		display: flex;
		gap: 2px;
		padding: 2px;
		border-radius: 8px;
		background: var(--sunken);
		border: 1px solid var(--line);
	}
	.seg button {
		height: 22px;
		padding: 0 9px;
		border: none;
		border-radius: 6px;
		background: none;
		color: var(--text-2);
		font-size: 12px;
		font-weight: 550;
	}
	.seg button.on {
		background: var(--raised);
		color: var(--text);
		box-shadow: var(--shadow), 0 0 0 1px var(--line);
	}
	.pane {
		flex: 1;
		min-height: 0;
		border-top: 1px solid var(--line);
	}
	.connecting {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 10px;
		height: 60%;
		color: var(--text-2);
	}
	.bulk {
		position: absolute;
		left: 50%;
		bottom: 18px;
		transform: translateX(-50%);
		z-index: 5;
		display: flex;
		align-items: center;
		gap: 6px;
		width: min(640px, calc(100% - 32px));
		box-sizing: border-box;
		padding: 6px 6px 6px 12px;
		border-radius: 12px;
		background: var(--raised);
		box-shadow: var(--shadow-lg);
		animation: rise 0.16s ease-out;
	}
	@keyframes rise {
		from {
			transform: translate(-50%, 8px);
			opacity: 0;
		}
	}
	.bulk-count {
		flex: none;
		font-size: 12px;
		color: var(--text-2);
	}
	.bulk-count b {
		color: var(--accent);
	}
	.bulk input {
		flex: 1;
		min-width: 0;
		height: 28px;
		padding: 0 10px;
		border: 1px solid var(--line-strong);
		border-radius: 7px;
		background: var(--bg);
		font-size: 12.5px;
	}
	.bulk input:focus {
		outline: none;
		border-color: var(--accent-line);
		box-shadow: 0 0 0 3px var(--accent-soft);
	}
	.statusbar {
		display: flex;
		align-items: center;
		gap: 14px;
		flex: none;
		height: 28px;
		padding: 0 16px;
		border-top: 1px solid var(--line);
		background: var(--panel);
		color: var(--text-3);
		font-size: 11.5px;
		white-space: nowrap;
		overflow: hidden;
	}
	.conn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--text-2);
	}
	.conn i {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--ok);
	}
	.conn.off i {
		background: var(--warn);
	}
	.faint {
		color: var(--text-3);
	}
	.keys {
		display: flex;
		gap: 12px;
		overflow: hidden;
	}
	.keys span {
		display: inline-flex;
		align-items: center;
		gap: 3px;
	}
	/* Bottom-left over the board, clear of the composer; lifted above the bulk bar when it shows. */
	.toasts {
		position: fixed;
		left: 16px;
		bottom: 40px;
		z-index: 90;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 6px;
		max-width: min(420px, calc(100vw - 32px));
	}
	.toasts.lifted {
		bottom: 84px;
	}
	.toast {
		padding: 8px 12px;
		border-radius: 9px;
		border: none;
		background: var(--text);
		color: var(--bg);
		font-size: 12.5px;
		text-align: left;
		box-shadow: var(--shadow-lg);
		animation: toast-in 0.18s ease-out;
	}
	.toast.err {
		background: var(--err);
		color: white;
	}
	@keyframes toast-in {
		from {
			transform: translateY(6px);
			opacity: 0;
		}
	}

	@media (max-width: 1180px) {
		.stats .stat:nth-last-child(-n + 2) {
			display: none;
		}
	}
	@media (max-width: 960px) {
		.stats {
			display: none;
		}
	}
	/* Phones: the board is home; the chat slides over it as a full-screen sheet. */
	@media (max-width: 760px) {
		.topbar {
			gap: 8px;
			padding: 0 12px 0 16px;
		}
		.slash,
		.sub,
		.search-text,
		.search kbd,
		.theme,
		.stop-all {
			display: none;
		}
		.search {
			flex: none;
			width: 32px;
			justify-content: center;
			padding: 0;
		}
		.workspace.with-focus {
			grid-template-columns: minmax(0, 1fr);
		}
		.right {
			position: fixed;
			inset: 0;
			z-index: 40;
			border: none;
			animation: slide 0.2s ease-out;
		}
		@keyframes slide {
			from {
				transform: translateX(24px);
				opacity: 0;
			}
		}
		.toolbar {
			padding: 0 12px 0 10px;
		}
		.statusbar {
			display: none;
		}
		.demo-banner a {
			display: none;
		}
		.toasts {
			right: 16px;
			bottom: 16px;
			align-items: stretch;
		}
		.toasts.lifted {
			bottom: 76px;
		}
	}
</style>
