<script lang="ts">
	import { tick, untrack } from "svelte";
	import type { BranchInfo, ShareMode, TreeNode } from "../../../shared/protocol.ts";
	import type { BranchesClient } from "../../src/lib/client.svelte.ts";
	import { branchHue } from "../../src/lib/layout.ts";
	import Composer from "./components/Composer.svelte";
	import Lines from "./components/Lines.svelte";
	import Palette, { type Command } from "./components/Palette.svelte";
	import ShareSheet, { type ShareRequest } from "./components/ShareSheet.svelte";
	import Transcript from "./components/Transcript.svelte";
	import { indexTree } from "./lib/rail.ts";

	let { client, demo = false }: { client: BranchesClient; demo?: boolean } = $props();

	// Per-viewer conveniences only; storage may be unavailable (private windows, sandboxes).
	const stored = (key: string): string | null => {
		try {
			return localStorage.getItem(key);
		} catch {
			return null;
		}
	};
	const store = (key: string, value: string) => {
		try {
			localStorage.setItem(key, value);
		} catch {}
	};

	const fromHash = () => {
		const match = /b=(\d+)/.exec(location.hash);
		return match ? Number(match[1]) : undefined;
	};
	let activeId = $state<number | undefined>(fromHash());
	let focusId = $state<number | null>(null);
	/** Branches in the order they were last looked at; the switcher and the rail reopen the one you left. */
	let recent = $state<number[]>([]);
	let drafts = $state<Record<number, string>>({});
	let shareRequest = $state<ShareRequest | undefined>();
	let palette = $state(false);
	let help = $state(false);
	let drawer = $state(false);
	let renaming = $state(false);
	let titleDraft = $state("");

	// An explicit data-theme on <html> wins over the system setting; "auto" removes it.
	type Theme = "auto" | "light" | "dark";
	let theme = $state<Theme>((stored("rail-theme") as Theme | null) ?? (document.documentElement.dataset.theme as Theme | undefined) ?? "auto");
	$effect(() => {
		if (theme === "auto") delete document.documentElement.dataset.theme;
		else document.documentElement.dataset.theme = theme;
		store("rail-theme", theme);
	});
	const nextTheme = () => (theme = theme === "auto" ? "light" : theme === "light" ? "dark" : "auto");

	// Default to the first branch; keep the URL pointing at the open one.
	$effect(() => {
		if (activeId === undefined || !client.tree.branches.some((b) => b.id === activeId)) {
			const first = client.tree.branches[0];
			if (first !== undefined) activeId = first.id;
		}
	});
	$effect(() => {
		const id = activeId;
		if (id === undefined) return;
		try {
			history.replaceState(null, "", `#b=${id}`);
		} catch {
			// Sandboxed frames may refuse URL changes; the open branch just isn't kept in the URL.
		}
		recent = [id, ...untrack(() => recent).filter((r) => r !== id)].slice(0, 8);
	});
	// Keep the last couple of branches live too, so hopping back and forth is instant.
	$effect(() => {
		const live = recent.filter((id) => client.tree.branches.some((b) => b.id === id)).slice(0, 3);
		client.watch(live);
	});

	const active = $derived(client.tree.branches.find((b) => b.id === activeId));
	const index = $derived(indexTree(client.tree.nodes, client.tree.branches));
	const lineage = $derived.by(() => {
		const out: BranchInfo[] = [];
		let at = active?.parent?.conversationId;
		while (at !== undefined && out.length < 8) {
			const branch = client.tree.branches.find((b) => b.id === at);
			if (branch === undefined) break;
			out.unshift(branch);
			at = branch.parent?.conversationId;
		}
		return out;
	});
	const queued = $derived(active === undefined ? 0 : (client.views[active.id]?.docs["pi.inbox"]?.items.length ?? active.queued));
	const overlay = $derived(palette || help || shareRequest !== undefined);

	const open = (id: number, entry: number | null = null) => {
		activeId = id;
		focusId = entry;
		drawer = false;
	};
	// After making a branch you are about to write in it; plain navigation leaves the keys to j/k.
	const write = () => void tick().then(() => document.getElementById("composer")?.focus());

	const fork = async (conversationId: number, at: number, draft = "") => {
		const { conversationId: id } = await client.request<{ conversationId: number }>({ t: "fork", conversationId, at });
		drafts[id] = draft;
		open(id);
		write();
	};
	const branchAfter = (entryId: number) => active && void fork(active.id, entryId);
	const editBranch = async (node: TreeNode) => {
		if (node.before === undefined) return;
		// The tree's preview is cut short; ask for the message itself.
		const { text } = await client.request<{ text: string }>({ t: "text", conversationId: node.conversationId, entryId: node.id });
		await fork(node.conversationId, node.before, text);
	};
	const create = async () => {
		const { conversationId } = await client.request<{ conversationId: number }>({ t: "new" });
		open(conversationId);
		write();
	};
	const send = async (text: string, whenBusy: "followUp" | "steer") => {
		if (activeId === undefined) return;
		focusId = null;
		await client.request({ t: "send", conversationId: activeId, text, whenBusy });
	};
	const abort = () => active && void client.request({ t: "abort", conversationId: active.id });
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
	const unshare = (noteId: string) => void client.request({ t: "unshare", noteId });
	const rename = () => {
		if (active !== undefined && titleDraft.trim() !== "" && titleDraft !== active.title) void client.request({ t: "rename", conversationId: active.id, title: titleDraft.trim() });
		renaming = false;
	};

	const commands = $derived<Command[]>([
		{ id: "new", label: "New thread", run: () => void create() },
		...(active && active.tip !== null ? [{ id: "fork", label: "Branch from the end of this branch", hint: "b", run: () => void fork(active.id, active.tip!) }] : []),
		{ id: "note", label: "Share a note", hint: "n", run: () => (shareRequest = {}) },
		{ id: "rename", label: "Rename this branch", run: () => startRename() },
		{ id: "theme", label: `Theme: ${theme} → ${theme === "auto" ? "light" : theme === "light" ? "dark" : "auto"}`, hint: "t", run: nextTheme },
		{ id: "help", label: "Keyboard shortcuts", hint: "?", run: () => (help = true) },
	]);
	const startRename = () => {
		if (active === undefined) return;
		titleDraft = active.title;
		renaming = true;
	};

	const onKey = (event: KeyboardEvent) => {
		if (help && (event.key === "Escape" || event.key === "?")) {
			help = false;
			return;
		}
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
			event.preventDefault();
			palette = !palette;
			return;
		}
		if (overlay || event.metaKey || event.ctrlKey || event.altKey) return;
		const el = event.target as HTMLElement | null;
		if (el !== null && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
		const act = (fn: () => void) => {
			event.preventDefault();
			fn();
		};
		if (event.key === "g") act(() => (palette = true));
		else if (event.key === "n") act(() => (shareRequest = {}));
		else if (event.key === "?") act(() => (help = true));
		else if (event.key === "/" || event.key === "c") act(() => document.getElementById("composer")?.focus());
		else if (event.key === "x" && active?.busy) act(abort);
		else if (event.key === "t") act(nextTheme);
		else if (event.key === "l") act(() => (drawer = !drawer));
	};
</script>

<svelte:window onkeydown={onKey} />

{#if demo}
	<div class="demo-banner">
		<span class="pip"></span>
		<span class="demo-text">Demo: the branches server runs inside this page with an offline echo model. Nothing is saved.</span>
		<a href="https://github.com/ahsanMah/pi-experiments" target="_blank" rel="noreferrer noopener">Run it with real models →</a>
	</div>
{/if}

<div class="shell" style="--h: {active ? branchHue(active.id) : 220}">
	<header class="top">
		<div class="brand" title="pi branches">
			<svg viewBox="0 0 20 20" aria-hidden="true">
				<path d="M6 2v16" class="b-main" />
				<path d="M6 7c0 3 8 2 8 6v5" class="b-side" />
				<circle cx="6" cy="7" r="2.2" class="b-dot" />
				<circle cx="14" cy="15" r="2.2" class="b-dot side" />
			</svg>
			<span>branches</span>
		</div>
		<nav class="crumbs" aria-label="Branch lineage">
			{#each lineage as branch (branch.id)}
				<button class="crumb" style="--h: {branchHue(branch.id)}" onclick={() => open(branch.id)}><i></i>{branch.title}</button>
				<span class="slash">/</span>
			{/each}
			{#if active}
				{#if renaming}
					<!-- svelte-ignore a11y_autofocus -->
					<input
						class="rename"
						bind:value={titleDraft}
						autofocus
						aria-label="Branch title"
						onkeydown={(e) => {
							if (e.key === "Enter") rename();
							else if (e.key === "Escape") renaming = false;
						}}
						onblur={rename}
					/>
				{:else}
					<button class="crumb current" style="--h: {branchHue(active.id)}" onclick={startRename} title="Rename this branch">
						<i class:busy={active.busy}></i>{active.title}
						<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 13l1-3 7-7 2 2-7 7-3 1z" /></svg>
					</button>
				{/if}
			{/if}
		</nav>
		<span class="spacer"></span>
		<button class="tool wide" onclick={() => (palette = true)} title="Go to a branch (g or Ctrl+K)">
			<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" /></svg>
			<span>Go to</span><kbd>K</kbd>
		</button>
		<button class="tool lines-toggle" class:on={drawer} onclick={() => (drawer = !drawer)} title="Lines and shared context (l)" aria-expanded={drawer}>
			<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2v12M4 6c0 2.5 8 1.5 8 5v3" /></svg>
			<span>{client.tree.branches.length}</span>
		</button>
		<button class="tool icon" onclick={nextTheme} title="Theme: {theme} (t)" aria-label="Theme: {theme}">
			{#if theme === "dark"}
				<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 9.5A5.5 5.5 0 1 1 6.5 3a4.5 4.5 0 0 0 6.5 6.5z" /></svg>
			{:else if theme === "light"}
				<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3" /><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6L13 13M3 13l1.4-1.4M11.6 4.4L13 3" /></svg>
			{:else}
				<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5" /><path d="M8 2.5v11a5.5 5.5 0 0 0 0-11z" class="fill" /></svg>
			{/if}
		</button>
		<button class="tool icon" onclick={() => (help = true)} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">?</button>
	</header>

	<div class="body">
		<main>
			{#if active}
				<Transcript
					branch={active}
					view={client.views[active.id]}
					tree={client.tree}
					{index}
					{recent}
					{focusId}
					keys={!overlay}
					{open}
					{branchAfter}
					{editBranch}
					share={(at) => active && (shareRequest = { from: { conversationId: active.id, at } })}
					{unshare}
				/>
				<Composer
					branch={active}
					models={client.models}
					{queued}
					bind:draft={() => drafts[active.id] ?? "", (value) => (drafts[active.id] = value)}
					{send}
					{abort}
					configure={(model) => void client.request({ t: "configure", conversationId: active.id, model })}
				/>
			{:else}
				<div class="connecting">
					<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M12 4v32M12 14c0 6 16 4 16 12v10" /></svg>
					{client.connected ? "Loading the tree…" : "Connecting to the branches server…"}
				</div>
			{/if}
		</main>

		{#if drawer}<button class="drawer-scrim" aria-label="Close" onclick={() => (drawer = false)}></button>{/if}
		<aside class="legend" class:open={drawer} aria-label="Lines and shared context">
			<Lines tree={client.tree} {activeId} select={(id) => open(id)} create={() => void create()} newNote={() => (shareRequest = {})} {unshare} />
			<div class="keys-hint">
				<kbd>j</kbd><kbd>k</kbd> messages <kbd>[</kbd><kbd>]</kbd> siblings <kbd>b</kbd> branch <kbd>?</kbd> more
			</div>
		</aside>
	</div>
</div>

{#if shareRequest}
	<ShareSheet request={shareRequest} branches={client.tree.branches} submit={share} close={() => (shareRequest = undefined)} />
{/if}

{#if palette}
	<Palette branches={client.tree.branches} {activeId} {commands} select={(id) => open(id)} close={() => (palette = false)} />
{/if}

{#if help}
	<div class="help-backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && (help = false)}>
		<div class="help" role="dialog" aria-modal="true" aria-labelledby="help-title">
			<h2 id="help-title">Keyboard</h2>
			<dl>
				<dt><kbd>j</kbd> <kbd>k</kbd></dt><dd>Next / previous message</dd>
				<dt><kbd>[</kbd> <kbd>]</kbd></dt><dd>Previous / next sibling branch at the nearest fork</dd>
				<dt><kbd>b</kbd></dt><dd>Branch after the selected (or last) message</dd>
				<dt><kbd>e</kbd></dt><dd>Edit &amp; branch the selected question</dd>
				<dt><kbd>s</kbd></dt><dd>Share this branch up to the selected message</dd>
				<dt><kbd>n</kbd></dt><dd>Share a note</dd>
				<dt><kbd>g</kbd> <kbd>Ctrl K</kbd></dt><dd>Go to a branch</dd>
				<dt><kbd>c</kbd> <kbd>/</kbd></dt><dd>Write in the composer</dd>
				<dt><kbd>↵</kbd> · <kbd>Alt ↵</kbd></dt><dd>Send or queue · steer while working</dd>
				<dt><kbd>x</kbd></dt><dd>Stop the running work</dd>
				<dt><kbd>l</kbd> · <kbd>t</kbd></dt><dd>Lines panel · theme</dd>
			</dl>
		</div>
	</div>
{/if}

{#if client.errors.length > 0}
	<div class="toasts">
		{#each client.errors as error, i (i)}
			<button class="toast" onclick={() => client.dismissError(i)}>{error}<span>Dismiss</span></button>
		{/each}
	</div>
{/if}

<style>
	.demo-banner {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 30px;
		padding: 0 16px;
		box-sizing: border-box;
		font: 12px var(--sans);
		color: var(--text-2);
		background: var(--surface-2);
		border-bottom: 1px solid var(--border);
		white-space: nowrap;
		flex: none;
	}
	.demo-text {
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}
	.pip {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: hsl(150 60% 45%);
		flex: none;
	}
	.demo-banner a {
		color: var(--text);
		font-weight: 500;
		text-decoration: none;
		margin-left: auto;
		flex: none;
	}
	.shell {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	.top {
		display: flex;
		align-items: center;
		gap: 10px;
		height: 52px;
		padding: 0 14px 0 18px;
		box-sizing: border-box;
		flex: none;
		border-bottom: 1px solid var(--border);
		background: var(--bg);
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 7px;
		font: 650 14px var(--sans);
		letter-spacing: -0.02em;
		color: var(--text);
		flex: none;
		padding-right: 10px;
		border-right: 1px solid var(--border);
		height: 22px;
	}
	.brand svg {
		width: 20px;
		height: 20px;
		fill: none;
		stroke-width: 2;
		stroke-linecap: round;
	}
	.b-main {
		stroke: var(--text);
	}
	.b-side {
		stroke: hsl(var(--h) var(--lane-s) var(--lane-l));
	}
	.b-dot {
		fill: var(--bg);
		stroke: var(--text);
		stroke-width: 1.8;
	}
	.b-dot.side {
		stroke: hsl(var(--h) var(--lane-s) var(--lane-l));
	}
	.crumbs {
		display: flex;
		align-items: center;
		gap: 2px;
		min-width: 0;
		overflow: hidden;
	}
	.crumb {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		min-width: 0;
		max-width: 220px;
		border: none;
		background: none;
		padding: 5px 8px;
		border-radius: 8px;
		font: 500 13.5px var(--sans);
		color: var(--text-3);
		cursor: pointer;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		flex-shrink: 1;
	}
	.crumb:hover {
		background: var(--surface-2);
		color: var(--text);
	}
	.crumb.current {
		color: var(--text);
		font-weight: 600;
		flex-shrink: 0;
		max-width: 340px;
	}
	.crumb i {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: hsl(var(--h) var(--lane-s) var(--lane-l));
		flex: none;
	}
	.crumb i.busy {
		animation: blink 1.1s ease-in-out infinite;
	}
	@keyframes blink {
		50% {
			opacity: 0.25;
		}
	}
	.crumb svg {
		width: 12px;
		height: 12px;
		fill: none;
		stroke: var(--text-3);
		stroke-width: 1.5;
		opacity: 0;
		flex: none;
	}
	.crumb.current:hover svg {
		opacity: 1;
	}
	.slash {
		color: var(--border-strong);
		font-size: 14px;
	}
	.rename {
		font: 600 13.5px var(--sans);
		padding: 4px 8px;
		border-radius: 8px;
		border: 1px solid var(--border-strong);
		background: var(--surface);
		color: var(--text);
		outline: none;
		box-shadow: 0 0 0 3px var(--ring);
		width: 240px;
	}
	.spacer {
		flex: 1;
	}
	.tool {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 30px;
		padding: 0 10px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface);
		color: var(--text-2);
		font: 500 12.5px var(--sans);
		cursor: pointer;
		flex: none;
	}
	.tool:hover,
	.tool.on {
		color: var(--text);
		border-color: var(--border-strong);
	}
	.tool.icon {
		width: 30px;
		padding: 0;
		justify-content: center;
		font-weight: 600;
	}
	.tool svg {
		width: 15px;
		height: 15px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
	}
	.tool svg .fill {
		fill: currentColor;
		stroke: none;
	}
	.tool kbd {
		font: 10.5px var(--mono);
		color: var(--text-3);
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 0 4px;
	}
	.body {
		flex: 1;
		min-height: 0;
		display: grid;
		grid-template-columns: minmax(0, 1fr) 300px;
		position: relative;
	}
	main {
		/* The reading column sits right of centre on wide screens, so the rail gets the larger margin. */
		--col-left: clamp(0px, calc((100% - var(--measure) - 56px) * 0.62), 300px);
		display: flex;
		flex-direction: column;
		min-height: 0;
		min-width: 0;
	}
	.legend {
		border-left: 1px solid var(--border);
		background: var(--panel);
		padding: 22px 14px;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 20px;
	}
	.keys-hint {
		margin-top: auto;
		padding: 0 6px;
		font: 11.5px var(--sans);
		color: var(--text-3);
		line-height: 2;
	}
	.keys-hint kbd,
	.help kbd {
		font: 11px var(--mono);
		padding: 1px 5px;
		border: 1px solid var(--border);
		border-bottom-width: 2px;
		border-radius: 5px;
		background: var(--surface);
		color: var(--text-2);
		margin-right: 2px;
	}
	.lines-toggle {
		display: none;
	}
	.drawer-scrim {
		display: none;
	}
	.connecting {
		flex: 1;
		display: grid;
		place-content: center;
		justify-items: center;
		gap: 14px;
		color: var(--text-3);
		font: 14px var(--sans);
	}
	.connecting svg {
		width: 40px;
		height: 40px;
		fill: none;
		stroke: var(--text-3);
		stroke-width: 2;
		stroke-linecap: round;
		stroke-dasharray: 60;
		animation: dash 1.6s ease-in-out infinite;
	}
	@keyframes dash {
		0% {
			stroke-dashoffset: 60;
		}
		100% {
			stroke-dashoffset: -60;
		}
	}
	.help-backdrop {
		position: fixed;
		inset: 0;
		z-index: 55;
		display: grid;
		place-items: center;
		padding: 16px;
		background: var(--scrim);
	}
	.help {
		width: min(440px, 100%);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 16px;
		padding: 20px 22px;
		box-shadow: var(--shadow-xl);
		font: 13.5px var(--sans);
		color: var(--text);
	}
	.help h2 {
		margin: 0 0 14px;
		font: 650 17px var(--sans);
	}
	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 10px 16px;
		margin: 0;
		align-items: baseline;
	}
	dt {
		white-space: nowrap;
	}
	dd {
		margin: 0;
		color: var(--text-2);
	}
	.toasts {
		position: fixed;
		bottom: 110px;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		gap: 6px;
		z-index: 60;
		width: min(480px, calc(100% - 32px));
	}
	.toast {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		text-align: left;
		background: var(--text);
		color: var(--bg);
		border: none;
		border-radius: 10px;
		padding: 10px 14px;
		font: 13px var(--sans);
		box-shadow: var(--shadow-lg);
		cursor: pointer;
	}
	.toast span {
		opacity: 0.6;
		flex: none;
	}
	/* Below the wide layout the legend becomes a drawer over the chat. */
	@media (max-width: 1279px) {
		.body {
			grid-template-columns: minmax(0, 1fr);
		}
		.lines-toggle {
			display: inline-flex;
		}
		.legend {
			position: absolute;
			top: 0;
			right: 0;
			bottom: 0;
			width: min(320px, 88vw);
			box-sizing: border-box;
			z-index: 30;
			box-shadow: var(--shadow-xl);
			transform: translateX(105%);
			transition: transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
			visibility: hidden;
		}
		.legend.open {
			transform: none;
			visibility: visible;
		}
		.drawer-scrim {
			display: block;
			position: absolute;
			inset: 0;
			z-index: 25;
			border: none;
			background: var(--scrim);
			cursor: default;
		}
	}
	@media (max-width: 640px) {
		.top {
			padding: 0 10px 0 12px;
			gap: 6px;
		}
		.brand span,
		.tool.wide,
		.crumb:not(.current),
		.slash {
			display: none;
		}
		.brand {
			padding-right: 6px;
		}
		.crumb.current {
			flex-shrink: 1;
		}
		.demo-banner a {
			display: none;
		}
		.keys-hint {
			display: none;
		}
	}
</style>
