<script lang="ts">
	import { SvelteFlowProvider } from "@xyflow/svelte";
	import type { BranchInfo, ShareMode, TreeNode } from "../../shared/protocol.ts";
	import Canvas from "./components/Canvas.svelte";
	import Chat from "./components/Chat.svelte";
	import Palette, { type PaletteItem, type PalettePage } from "./components/Palette.svelte";
	import ShareDialog, { type ShareRequest } from "./components/ShareDialog.svelte";
	import Sidebar from "./components/Sidebar.svelte";
	import type { BranchesClient } from "./lib/client.svelte.ts";
	import { branchHue } from "./lib/layout.ts";
	import Spatial from "./spatial/Spatial.svelte";

	let { client, demo = false }: { client: BranchesClient; demo?: boolean } = $props();

	const fromHash = () => {
		const match = /b=(\d+)/.exec(location.hash);
		return match ? Number(match[1]) : undefined;
	};
	let activeId = $state<number | undefined>(fromHash());
	let focusId = $state<number | null>(null);
	let drafts = $state<Record<number, string>>({});
	let shareRequest = $state<ShareRequest | undefined>();
	/** Where the fork switcher that opened the active branch sat on screen, to keep it in place. */
	let anchor = $state<{ at: number; top: number } | null>(null);
	/** The chat with its overview, or the spatial canvas where every branch is a card. */
	let view = $state<"chat" | "spatial">("chat");
	let palette = $state<{ start?: PalettePage } | undefined>();
	type OverviewMode = "side" | "full" | "hidden";
	// Layout preferences are per-viewer conveniences; storage may be unavailable (private windows, sandboxes).
	const stored = (key: string): string | null => {
		try {
			return localStorage.getItem(key);
		} catch {
			return null;
		}
	};
	// Light, dark, or the system setting. A chosen theme sets data-theme on the root, which every
	// stylesheet here (and the spatial view) already follows; "system" clears it again.
	type Theme = "system" | "light" | "dark";
	let theme = $state<Theme>((stored("theme") as Theme | null) ?? "system");
	let themeSet = false;
	$effect(() => {
		if (theme !== "system") {
			document.documentElement.dataset.theme = theme;
			themeSet = true;
		} else if (themeSet) delete document.documentElement.dataset.theme;
		try {
			localStorage.setItem("theme", theme);
		} catch {}
	});
	const cycleTheme = () => (theme = theme === "system" ? (dark ? "light" : "dark") : theme === "dark" ? "light" : "system");
	let overview = $state<OverviewMode>((stored("overview") as OverviewMode | null) ?? "side");
	let panelWidth = $state(Number(stored("panelWidth") ?? 460));
	// Follow an explicit data-theme on the root (set by a host page), else the system setting.
	const query = matchMedia("(prefers-color-scheme: dark)");
	const readTheme = () => {
		const explicit = document.documentElement.dataset.theme;
		return explicit === "dark" || (explicit !== "light" && query.matches);
	};
	let dark = $state(readTheme());
	$effect(() => {
		const update = () => (dark = readTheme());
		// The saved theme may have been applied before this observer existed (on load); catch up.
		update();
		query.addEventListener("change", update);
		const observer = new MutationObserver(update);
		observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
		return () => {
			query.removeEventListener("change", update);
			observer.disconnect();
		};
	});
	$effect(() => {
		try {
			localStorage.setItem("overview", overview);
			localStorage.setItem("panelWidth", String(panelWidth));
		} catch {}
	});

	// Default to the first branch; keep the URL pointing at the open one.
	$effect(() => {
		if (activeId === undefined || !client.tree.branches.some((b) => b.id === activeId)) {
			const first = client.tree.branches[0];
			if (first !== undefined) activeId = first.id;
		}
	});
	$effect(() => {
		try {
			if (activeId !== undefined) history.replaceState(null, "", `#b=${activeId}`);
		} catch {
			// Sandboxed frames may refuse URL changes; the open branch just isn't kept in the URL.
		}
		// The spatial view watches the cards it shows itself.
		if (view === "chat") client.watch(activeId === undefined ? [] : [activeId]);
	});

	const active = $derived(client.tree.branches.find((b) => b.id === activeId));

	const open = (id: number, entry: number | null = null) => {
		activeId = id;
		focusId = entry;
		anchor = null;
	};
	const switchAt = (id: number, at: number, top: number) => {
		open(id);
		anchor = { at, top };
	};

	const openNode = (node: TreeNode) => {
		// A node is visible in every branch that inherits it; stay in the current branch when it does.
		const view = activeId === undefined ? undefined : client.views[activeId];
		const inActive = view?.entries.some((e) => e.id === node.id) ?? false;
		open(inActive && activeId !== undefined ? activeId : node.conversationId, node.id);
	};

	const fork = async (conversationId: number, at: number, draft = "") => {
		const { conversationId: id } = await client.request<{ conversationId: number }>({ t: "fork", conversationId, at });
		drafts[id] = draft;
		open(id);
	};

	const branchAfter = (node: TreeNode) => void fork(node.conversationId, node.id);
	const editBranch = async (node: TreeNode) => {
		if (node.before === undefined) return;
		// The tree's preview is cut short; ask for the message itself.
		const { text } = await client.request<{ text: string }>({ t: "text", conversationId: node.conversationId, entryId: node.id });
		await fork(node.conversationId, node.before, text);
	};
	const shareFrom = (conversationId: number, at?: number) => {
		shareRequest = { from: { conversationId, ...(at !== undefined ? { at } : {}) } };
	};

	const acceptSuggestion = async (id: string) => {
		const { conversationId, prompt } = await client.request<{ conversationId: number; prompt: string }>({ t: "acceptSuggestion", id });
		drafts[conversationId] = prompt;
		open(conversationId);
	};
	const dismissSuggestion = (id: string) => void client.request({ t: "dismissSuggestion", id });

	const send = async (text: string, whenBusy: "followUp" | "steer") => {
		if (activeId === undefined) return;
		focusId = null;
		await client.request({ t: "send", conversationId: activeId, text, whenBusy });
	};

	const share = async (share: { mode: ShareMode; to: number[] | "*"; title: string; text: string }) => {
		await client.request({
			t: "share",
			mode: share.mode,
			to: share.to,
			...(shareRequest?.from !== undefined ? { from: shareRequest.from } : {}),
			...(share.title.trim() !== "" ? { title: share.title } : {}),
			...(share.text.trim() !== "" ? { text: share.text } : {}),
		});
	};

	// ── Command palette ──
	const shareTo = (mode: ShareMode, to: number[] | "*", from?: { conversationId: number }, text = "") =>
		client.request({ t: "share", mode, to, ...(from !== undefined ? { from } : {}), ...(text !== "" ? { text } : {}) });
	const pickTargets = (title: string, exclude: number | undefined, done: (to: number[] | "*") => Promise<unknown>): PalettePage => ({
		kind: "multi",
		title,
		placeholder: "Pick branches to share with…",
		options: [
			{ value: "*", label: "Every branch", detail: "now and later" },
			...client.tree.branches.filter((b) => b.id !== exclude).map((b) => ({ value: b.id, label: b.title, hue: branchHue(b.id) })),
		],
		initial: [],
		confirmLabel: (n) => (n < 0 ? "Share with every branch" : `Share with ${n} branch${n === 1 ? "" : "es"}`),
		confirm: async (to) => void (await done(to)),
	});
	const sharePage = (branch: BranchInfo, mode: "summary" | "transcript"): PalettePage =>
		pickTargets(`Share ${mode} of ${branch.title}`, branch.id, (to) => shareTo(mode, to, { conversationId: branch.id }));
	const notePage = (): PalettePage => ({
		kind: "input",
		title: "Write a note",
		placeholder: "What should the other branches know?",
		confirmLabel: "Choose branches",
		submit: (text) => pickTargets("Note → branches", undefined, (to) => shareTo("note", to, undefined, text)),
	});
	const renamePage = (branch: BranchInfo): PalettePage => ({
		kind: "input",
		title: `Rename ${branch.title}`,
		placeholder: "New title",
		initial: branch.title,
		confirmLabel: "Rename",
		submit: async (title) => void (await client.request({ t: "rename", conversationId: branch.id, title })),
	});
	/** Confirm before deleting: the branch goes with everything forked from it. */
	const deletePage = (branch: BranchInfo): PalettePage => {
		const doomed = new Set([branch.id]);
		for (const b of client.tree.branches) if (b.parent !== undefined && doomed.has(b.parent.conversationId)) doomed.add(b.id);
		const forks = doomed.size - 1;
		return {
			kind: "list",
			title: `Delete ${branch.title}${forks > 0 ? ` and ${forks} branch${forks === 1 ? "" : "es"} forked from it` : ""}?`,
			placeholder: "This cannot be undone from here",
			items: [
				{ id: "delete-confirm", icon: "✕", label: `Delete ${branch.title}`, group: "Confirm", ...(forks > 0 ? { detail: `with ${forks} fork${forks === 1 ? "" : "s"}` } : {}), run: async () => void (await client.request({ t: "delete", conversationId: branch.id })) },
				{ id: "delete-cancel", icon: "↩", label: "Keep it", group: "Confirm", run: () => {} },
			],
		};
	};
	const restorePage = (): PalettePage => ({
		kind: "list",
		title: "Restore a deleted branch",
		placeholder: "Search deleted branches…",
		items: client.tree.deleted.map((d) => ({
			id: `restore:${d.id}`,
			icon: "↺",
			label: d.title,
			group: "Deleted",
			detail: `${new Date(d.deletedAt).toLocaleString()}${d.forks > 0 ? ` · with ${d.forks} fork${d.forks === 1 ? "" : "s"}` : ""}`,
			run: async () => {
				await client.request({ t: "restore", conversationId: d.id });
				toChat(d.id);
			},
		})),
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
			run: async () => void (await client.request({ t: "configure", conversationId: branch.id, model })),
		})),
	});
	const toChat = (id?: number, entry: number | null = null) => {
		view = "chat";
		if (id !== undefined) open(id, entry);
	};
	const newThread = async () => {
		const { conversationId } = await client.request<{ conversationId: number }>({ t: "new" });
		toChat(conversationId);
	};

	const commands = $derived.by((): PaletteItem[] => {
		const items: PaletteItem[] = [];
		const titleOf = (id: number) => client.tree.branches.find((b) => b.id === id)?.title ?? "another branch";
		const a = active;
		if (a !== undefined) {
			const act = (item: Omit<PaletteItem, "group">) => items.push({ ...item, group: `Actions · ${a.title}` });
			if (a.tip !== null) act({ id: "branch", icon: "⑂", label: "Branch from the latest message", keywords: "fork", run: () => fork(a.id, a.tip!).then(() => toChat()) });
			act({ id: "share-summary", icon: "⇄", label: `Share a summary of ${a.title} to…`, keywords: "context", run: () => sharePage(a, "summary") });
			act({ id: "share-transcript", icon: "⇄", label: `Share the transcript of ${a.title} to…`, keywords: "context", run: () => sharePage(a, "transcript") });
			act({ id: "rename", icon: "✎", label: "Rename…", detail: a.title, run: () => renamePage(a) });
			act({ id: "delete", icon: "✕", label: "Delete branch…", detail: a.title, keywords: "remove trash discard", run: () => deletePage(a) });
			act({ id: "model", icon: "◇", label: "Change model…", detail: a.model, run: () => modelPage(a) });
			if (a.busy) act({ id: "stop", icon: "■", label: `Stop ${a.title}`, keywords: "abort cancel", run: () => void client.request({ t: "abort", conversationId: a.id }) });
		}
		const app = (item: Omit<PaletteItem, "group">) => items.push({ ...item, group: "Pi Branches" });
		app(
			view === "chat"
				? { id: "spatial", icon: "▦", label: "Open the spatial view", detail: "every branch as a card on a canvas", keywords: "canvas tree cards", run: () => void (view = "spatial") }
				: { id: "chat", icon: "☰", label: "Back to the chat view", keywords: "conversation", run: () => toChat() },
		);
		app({ id: "theme", icon: "◐", label: "Change theme", detail: `now ${theme}`, keywords: "light dark appearance mode", run: () => void cycleTheme() });
		app({ id: "new", icon: "＋", label: "New thread", detail: "an unrelated conversation", keywords: "create root branch", run: newThread });
		if (client.tree.deleted.length > 0) app({ id: "restore", icon: "↺", label: "Restore a deleted branch…", detail: `${client.tree.deleted.length} deleted`, keywords: "undelete undo trash recover", run: restorePage });
		app({ id: "note", icon: "✦", label: "Write a note to…", keywords: "share context", run: notePage });
		if (view === "chat")
			app({
				id: "overview",
				icon: "◫",
				label: overview === "hidden" ? "Show the overview" : overview === "side" ? "Overview full screen" : "Hide the overview",
				shortcut: "Alt+O",
				keywords: "tree canvas panel",
				run: () => void (overview = overview === "side" ? "full" : overview === "full" ? "hidden" : "side"),
			});
		for (const branch of client.tree.branches) {
			const parent = branch.parent === undefined ? undefined : titleOf(branch.parent.conversationId);
			items.push({
				id: `branch:${branch.id}`,
				group: "Switch to…",
				label: branch.title,
				hue: branchHue(branch.id),
				detail: [branch.busy ? "working" : "", parent ? `from ${parent}` : "", branch.model ?? ""].filter(Boolean).join(" · "),
				run: () => toChat(branch.id),
				...(branch.tip !== null ? { alt: { label: "branch from its end", run: () => fork(branch.id, branch.tip!).then(() => toChat()) } } : {}),
			});
		}
		// Message search over the tree's previews; opening one scrolls the chat to it.
		for (const node of client.tree.nodes) {
			if (node.role !== "user" && node.role !== "assistant") continue;
			items.push({
				id: `node:${node.id}`,
				group: "Messages",
				searchOnly: true,
				icon: node.role === "user" ? "›" : "◆",
				label: node.preview,
				detail: titleOf(node.conversationId),
				run: () => {
					view = "chat";
					openNode(node);
				},
				alt: { label: "branch from this message", run: () => fork(node.conversationId, node.id).then(() => toChat()) },
			});
		}
		return items;
	});

	const onKey = (event: KeyboardEvent) => {
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
			event.preventDefault();
			palette = palette === undefined ? {} : undefined;
			return;
		}
		if (event.altKey && event.key.toLowerCase() === "o") {
			event.preventDefault();
			overview = overview === "side" ? "full" : overview === "full" ? "hidden" : "side";
		}
	};

	let dragging = false;
	const startDrag = (event: PointerEvent) => {
		dragging = true;
		(event.target as HTMLElement).setPointerCapture(event.pointerId);
	};
	const drag = (event: PointerEvent) => {
		if (dragging) panelWidth = Math.min(Math.max(innerWidth - event.clientX, 280), innerWidth - 420);
	};
</script>

<svelte:window onkeydown={onKey} />

{#if demo}
	<div class="demo-banner">
		Demo: the branches server runs inside this page with an offline echo model, and nothing is saved.
		<a href="https://github.com/ahsanMah/pi-experiments" target="_blank" rel="noreferrer noopener">Run it with real models</a>
	</div>
{/if}

{#if view === "spatial"}
	<div class="spatial-view">
		<Spatial {client} {demo} start={activeId} back={(id) => toChat(id)} />
	</div>
{:else}
<div class="app" class:full={overview === "full"} class:hidden={overview === "hidden"} style="--panel: {panelWidth}px">
	<div class="sidebar">
		<Sidebar
			tree={client.tree}
			{activeId}
			select={(id) => open(id)}
			create={async () => {
				const { conversationId } = await client.request<{ conversationId: number }>({ t: "new" });
				open(conversationId);
			}}
			forkTip={() => active && active.tip !== null && fork(active.id, active.tip)}
			newNote={() => (shareRequest = {})}
			unshare={(noteId) => void client.request({ t: "unshare", noteId })}
			accept={acceptSuggestion}
			dismiss={dismissSuggestion}
			commands={() => (palette = {})}
			{theme}
			{cycleTheme}
		/>
	</div>

	<main class="main">
		{#if client.tree.branches.length > 1}
			<label class="mobile-branches">
				<span>Branch</span>
				<select id="mobile-branch" value={activeId} onchange={(e) => open(Number(e.currentTarget.value))}>
					{#each client.tree.branches as branch (branch.id)}
						<option value={branch.id}>{branch.busy ? "● " : ""}{branch.title}</option>
					{/each}
				</select>
				<button onclick={() => (palette = {})} title="Search or run a command">Search</button>
			</label>
		{/if}
		{#if active}
			{#key active.id}
				<Chat
					branch={active}
					view={client.views[active.id]}
					nodes={client.tree.nodes}
					notes={client.tree.notes}
					branches={client.tree.branches}
					openBranch={(id, entry) => open(id, entry)}
					unshare={(noteId) => void client.request({ t: "unshare", noteId })}
					suggestions={client.tree.suggestions}
					accept={acceptSuggestion}
					dismiss={dismissSuggestion}
					models={client.models}
					{focusId}
					{anchor}
					{switchAt}
					bind:draft={() => drafts[active.id] ?? "", (value) => (drafts[active.id] = value)}
					{send}
					abort={() => void client.request({ t: "abort", conversationId: active.id })}
					branchAfter={(at) => void fork(active.id, at)}
					{editBranch}
					share={(at) => shareFrom(active.id, at)}
					rename={(title) => void client.request({ t: "rename", conversationId: active.id, title })}
					configure={(model) => void client.request({ t: "configure", conversationId: active.id, model })}
				/>
			{/key}
		{:else}
			<div class="connecting">{client.connected ? "Loading…" : "Connecting to the branches server…"}</div>
		{/if}
	</main>

	{#if overview !== "hidden"}
		<div class="resizer" role="separator" aria-orientation="vertical" onpointerdown={startDrag} onpointermove={drag} onpointerup={() => (dragging = false)}></div>
	{/if}
	<section class="overview" aria-label="Branch overview">
		<div class="overview-bar">
			<strong>Overview</strong>
			<span class="muted">{client.tree.branches.length} branches · {client.tree.nodes.length} messages</span>
			<span class="spacer"></span>
			<button onclick={() => (view = "spatial")} title="Open every branch as a card on a canvas">Spatial</button>
			<button onclick={() => (overview = overview === "full" ? "side" : "full")} title="Alt+O cycles side, full, hidden">{overview === "full" ? "Side" : "Full"}</button>
			<button onclick={() => (overview = "hidden")}>Hide</button>
		</div>
		{#if overview !== "hidden"}
			<div class="flow">
				<SvelteFlowProvider>
					<Canvas
						tree={client.tree}
						{activeId}
						{focusId}
						{dark}
						open={(node) => {
							openNode(node);
							if (overview === "full") overview = "side";
						}}
						branch={branchAfter}
						{editBranch}
						share={(node) => shareFrom(node.conversationId, node.id)}
					/>
				</SvelteFlowProvider>
			</div>
		{/if}
	</section>

	{#if overview === "hidden"}
		<div class="show-overview">
			<button onclick={() => (view = "spatial")} title="Open every branch as a card on a canvas">Spatial</button>
			<button onclick={() => (overview = "side")} title="Alt+O">Overview</button>
		</div>
	{/if}
</div>
{/if}

{#if palette}
	<Palette items={commands} start={palette.start} close={() => (palette = undefined)} />
{/if}

{#if shareRequest}
	<ShareDialog request={shareRequest} branches={client.tree.branches} submit={share} close={() => (shareRequest = undefined)} />
{/if}

{#if client.errors.length > 0}
	<div class="toasts">
		{#each client.errors as error, index (index)}
			<button class="toast" onclick={() => client.dismissError(index)}>{error}</button>
		{/each}
	</div>
{/if}

<style>
	.app {
		display: grid;
		grid-template-columns: 240px minmax(0, 1fr) 6px var(--panel);
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}
	.main {
		display: flex;
		flex-direction: column;
	}
	.main > :global(.chat) {
		flex: 1;
		min-height: 0;
	}
	.mobile-branches {
		display: none;
	}
	.demo-banner {
		height: 34px;
		box-sizing: border-box;
		padding: 7px 16px;
		font-size: 13px;
		background: var(--accent-soft);
		border-bottom: 1px solid var(--border);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.demo-banner a {
		color: var(--accent);
		margin-left: 6px;
	}
	.app.hidden {
		grid-template-columns: 240px minmax(0, 1fr) 0 0;
	}
	.app.full {
		grid-template-columns: 240px 0 0 minmax(0, 1fr);
	}
	.sidebar,
	.main {
		min-height: 0;
		overflow: hidden;
	}
	.resizer {
		cursor: col-resize;
		background: var(--border);
		opacity: 0.5;
	}
	.resizer:hover {
		opacity: 1;
	}
	.overview {
		display: flex;
		flex-direction: column;
		min-width: 0;
		background: var(--surface-muted);
	}
	.app.hidden .overview {
		display: none;
	}
	.overview-bar {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 12px;
		border-bottom: 1px solid var(--border);
	}
	.overview-bar button {
		font-size: 12px;
		padding: 2px 8px;
	}
	.flow {
		flex: 1;
		min-height: 0;
	}
	.spacer {
		flex: 1;
	}
	.muted {
		color: var(--text-muted);
		font-size: 12px;
	}
	.connecting {
		display: grid;
		place-items: center;
		height: 100%;
		color: var(--text-muted);
	}
	.show-overview {
		position: fixed;
		top: 10px;
		right: 12px;
		display: flex;
		gap: 6px;
	}
	.spatial-view {
		flex: 1;
		min-height: 0;
	}
	.toasts {
		position: fixed;
		bottom: 16px;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		gap: 6px;
		z-index: 60;
	}
	.toast {
		background: var(--danger);
		color: white;
		border: none;
		border-radius: 8px;
		padding: 8px 14px;
	}
	@media (max-width: 900px) {
		.app {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: minmax(0, 1fr) 40vh;
		}
		.sidebar,
		.resizer {
			display: none;
		}
		.mobile-branches {
			display: flex;
			align-items: center;
			gap: 8px;
			padding: 8px max(16px, env(safe-area-inset-left, 0px));
			border-bottom: 1px solid var(--border);
			font-size: 12px;
			color: var(--text-muted);
		}
		.mobile-branches select {
			flex: 1;
			min-width: 0;
		}
		.app.full {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: 0 minmax(0, 1fr);
		}
		.app.hidden {
			grid-template-rows: minmax(0, 1fr) 0;
		}
	}
</style>
