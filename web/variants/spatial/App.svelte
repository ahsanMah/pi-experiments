<script lang="ts">
	// Spatial: the canvas is the workspace. Every branch is a card you can read and type into
	// where it sits; focusing one grows it into a full chat beside the canvas. Shared context
	// lives on the canvas too, as sticky notes wired to the branches that see them.
	import { SvelteFlowProvider } from "@xyflow/svelte";
	import { untrack } from "svelte";
	import type { BranchInfo } from "../../../shared/protocol.ts";
	import type { BranchesClient } from "../../src/lib/client.svelte.ts";
	import Board from "./components/Board.svelte";
	import FocusPanel from "./components/FocusPanel.svelte";
	import Icon, { type IconName } from "./components/Icon.svelte";
	import NoteSheet from "./components/NoteSheet.svelte";
	import ShareSheet from "./components/ShareSheet.svelte";
	import { setSpace, Space } from "./lib/space.svelte.ts";

	let { client, demo = false }: { client: BranchesClient; demo?: boolean } = $props();

	// The client is created once by main.ts and never swapped.
	const space = setSpace(new Space(untrack(() => client)));

	// Per-viewer preferences; storage may be unavailable (private windows, sandboxes).
	const stored = (key: string): string | null => {
		try {
			return localStorage.getItem(key);
		} catch {
			return null;
		}
	};
	const store = (key: string, value: string | null) => {
		try {
			if (value === null) localStorage.removeItem(key);
			else localStorage.setItem(key, value);
		} catch {}
	};

	// An explicit data-theme on <html> wins (a host page may set it); otherwise follow the system.
	type Theme = "system" | "light" | "dark";
	let theme = $state<Theme>((stored("spatial.theme") as Theme | null) ?? "system");
	const query = matchMedia("(prefers-color-scheme: dark)");
	const readDark = () => {
		const explicit = document.documentElement.dataset.theme;
		return explicit === "dark" || (explicit !== "light" && query.matches);
	};
	let dark = $state(readDark());
	$effect(() => {
		if (theme !== "system") document.documentElement.dataset.theme = theme;
		else if (stored("spatial.theme") !== null) delete document.documentElement.dataset.theme;
		store("spatial.theme", theme === "system" ? null : theme);
		dark = readDark();
	});
	$effect(() => {
		const update = () => (dark = readDark());
		query.addEventListener("change", update);
		const observer = new MutationObserver(update);
		observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
		return () => {
			query.removeEventListener("change", update);
			observer.disconnect();
		};
	});
	const themeIcon: Record<Theme, IconName> = { system: "system", light: "sun", dark: "moon" };
	const nextTheme = () => (theme = theme === "system" ? (dark ? "light" : "dark") : theme === "dark" ? "light" : "system");

	let minimap = $state(stored("spatial.minimap") !== "0");
	$effect(() => store("spatial.minimap", minimap ? "1" : "0"));
	let help = $state(false);

	const focused = $derived(space.branch(space.focusId));
	$effect(() => {
		// The focused branch can't vanish today, but don't hold a panel open for nothing.
		if (space.focusId !== null && client.tree.branches.length > 0 && focused === undefined) space.focusId = null;
	});

	let innerWidth = $state(1280);
	$effect(() => {
		// Mirrors the panel width in FocusPanel's CSS, so the camera centers cards beside it.
		const w = innerWidth;
		space.inset = focused === undefined || w <= 760 ? 0 : (w > 1100 ? Math.min(700, w - 420) : Math.min(620, w - 300)) + 24;
	});

	const working = $derived(client.tree.branches.filter((b) => b.busy).length);

	/** Branches in tree order, each fork after the branch it came from: the Tab order. */
	const order = $derived.by(() => {
		const kids = new Map<number | undefined, BranchInfo[]>();
		for (const b of client.tree.branches) kids.set(b.parent?.conversationId, [...(kids.get(b.parent?.conversationId) ?? []), b]);
		const out: number[] = [];
		const visit = (parent: number | undefined) => {
			for (const b of kids.get(parent) ?? []) {
				out.push(b.id);
				visit(b.id);
			}
		};
		visit(undefined);
		for (const b of client.tree.branches) if (!out.includes(b.id)) out.push(b.id);
		return out;
	});

	const cycle = (step: number) => {
		if (order.length === 0) return;
		const from = order.indexOf(space.focusId ?? space.currentId ?? -1);
		const id = order[(from + step + order.length) % order.length]!;
		if (space.focusId !== null) space.focus(id);
		else {
			space.currentId = id;
			space.camera?.reveal(id);
		}
	};

	const onKey = (event: KeyboardEvent) => {
		if (space.sheet !== undefined || space.noteOpen !== null) return;
		const target = event.target as HTMLElement;
		const typing = target.closest("input, textarea, select, [contenteditable]") !== null;
		if (event.key === "Escape") {
			if (help) help = false;
			else if (space.focusId !== null) space.focus(null);
			else space.currentId = null;
			return;
		}
		if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
		const current = space.currentId;
		switch (event.key) {
			case "Tab":
				event.preventDefault();
				cycle(event.shiftKey ? -1 : 1);
				break;
			case "f":
			case "F":
				space.camera?.fit();
				break;
			case "Enter":
				if (current !== null) space.focus(current);
				break;
			case "n":
			case "N":
				if (space.camera) space.newSticky(space.camera.center());
				break;
			case "b":
			case "B": {
				const branch = space.branch(space.focusId ?? current);
				if (branch && branch.tip !== null) void space.fork(branch.id, branch.tip);
				break;
			}
			case "/":
				if (current !== null) {
					event.preventDefault();
					document.querySelector<HTMLTextAreaElement>(`[data-card-id="${current}"] textarea`)?.focus();
				}
				break;
			case "+":
			case "=":
				space.camera?.zoomBy(1.25);
				break;
			case "-":
				space.camera?.zoomBy(0.8);
				break;
			case "0":
				space.camera?.zoomTo(1);
				break;
			case "?":
				help = !help;
				break;
		}
	};

	const openNote = $derived(client.tree.notes.find((n) => n.id === space.noteOpen));
	const shortcuts: [string, string][] = [
		["Drag · Space+drag", "Pan the canvas"],
		["Scroll", "Pan · Ctrl/⌘+scroll or pinch zooms"],
		["Tab / Shift+Tab", "Next / previous card"],
		["Enter · double-click", "Open the card"],
		["Esc", "Back to the canvas"],
		["F", "Fit everything"],
		["B", "Branch from the latest message"],
		["N · double-click canvas", "New sticky note"],
		["/", "Type into the current card"],
		["+ − 0", "Zoom in, out, 100%"],
		["Alt+Enter", "Steer a working branch"],
	];
</script>

<svelte:window onkeydown={onKey} bind:innerWidth />

<div class="shell">
	{#if demo}
		<div class="demo-banner">
			<span class="demo-tag">Demo</span>
			<span class="demo-text">The branches server runs inside this page with an offline echo model; nothing is saved.</span>
			<a href="https://github.com/ahsanMah/pi-experiments" target="_blank" rel="noreferrer noopener">Run it with real models</a>
		</div>
	{/if}

	<main class="stage" class:panel-open={focused !== undefined} style="--inset: {space.inset}px">
		<SvelteFlowProvider>
			<Board {dark} {minimap} />
		</SvelteFlowProvider>

		<div class="hud top-left">
			<div class="brand">
				<svg class="logo" viewBox="0 0 28 28" aria-hidden="true">
					<rect x="2" y="3" width="11" height="8" rx="2.5" />
					<rect x="15" y="17" width="11" height="8" rx="2.5" />
					<rect x="15" y="3" width="11" height="8" rx="2.5" opacity="0.45" />
					<path d="M13 7h2M8 11v6a4 4 0 0 0 4 4h3" fill="none" />
				</svg>
				<strong>pi branches</strong>
			</div>
			<div class="stats">
				<span>{client.tree.branches.length} branch{client.tree.branches.length === 1 ? "" : "es"}</span>
				{#if working > 0}<span class="working"><i></i>{working} working</span>{/if}
				{#if client.tree.notes.length > 0}<span>{client.tree.notes.length} sticky{client.tree.notes.length === 1 ? "" : " notes"}</span>{/if}
			</div>
		</div>

		<div class="hud top-right">
			{#if !client.connected}<span class="offline">Reconnecting…</span>{/if}
			<button class="round" onclick={() => (help = !help)} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts" aria-pressed={help}><Icon name="keys" /></button>
			<button class="round" onclick={nextTheme} title="Theme: {theme}" aria-label="Theme: {theme}"><Icon name={themeIcon[theme]} /></button>
		</div>

		<nav class="toolbar" aria-label="Canvas tools">
			<button class="tool primary" onclick={() => space.newRoot()} title="Start an unrelated thread"><Icon name="plus" /><span>Thread</span></button>
			<button class="tool" onclick={() => space.camera && space.newSticky(space.camera.center())} title="New sticky note (N)"><Icon name="sticky" /><span>Sticky</span></button>
			<span class="sep"></span>
			<button class="tool icon-only" onclick={() => space.camera?.zoomBy(0.8)} title="Zoom out (−)" aria-label="Zoom out"><Icon name="minus" /></button>
			<button class="tool zoom" onclick={() => space.camera?.zoomTo(1)} title="Zoom to 100% (0)">{Math.round(space.zoom * 100)}%</button>
			<button class="tool icon-only" onclick={() => space.camera?.zoomBy(1.25)} title="Zoom in (+)" aria-label="Zoom in"><Icon name="plus" /></button>
			<button class="tool icon-only" onclick={() => space.camera?.fit()} title="Fit everything (F)" aria-label="Fit everything"><Icon name="fit" /></button>
			<span class="sep wide"></span>
			<button class="tool icon-only wide" onclick={() => space.tidy()} title="Tidy: put every card back in the tree layout" aria-label="Tidy up"><Icon name="tidy" /></button>
			<button class="tool icon-only wide" class:on={minimap} onclick={() => (minimap = !minimap)} title="Minimap" aria-label="Toggle minimap" aria-pressed={minimap}><Icon name="map" /></button>
		</nav>

		{#if help}
			<div class="help" role="dialog" aria-label="Keyboard shortcuts">
				<div class="help-head"><strong>Shortcuts</strong><button class="round small" onclick={() => (help = false)} aria-label="Close"><Icon name="close" size={14} /></button></div>
				<dl>
					{#each shortcuts as [keys, what] (keys)}
						<dt>{keys}</dt>
						<dd>{what}</dd>
					{/each}
				</dl>
				<p>Drag a card's <Icon name="connect" size={12} /> knob onto another card to share into it. Drag a sticky onto a card to share it there.</p>
			</div>
		{/if}

		{#if client.tree.branches.length === 0}
			<div class="connecting">
				<div class="spinner"></div>
				{client.connected ? "Laying out the canvas…" : demo ? "Starting the in-page server…" : "Connecting to the branches server…"}
			</div>
		{/if}

		{#if focused}
			<FocusPanel branch={focused} />
		{/if}
	</main>
</div>

{#if space.sheet}
	<ShareSheet request={space.sheet} />
{/if}
{#if openNote}
	{#key openNote.id}
		<NoteSheet note={openNote} />
	{/key}
{/if}

{#if client.errors.length > 0 || space.notices.length > 0}
	<div class="toasts" aria-live="polite">
		{#each space.notices as notice (notice)}
			<div class="toast">{notice}</div>
		{/each}
		{#each client.errors as error, index (index)}
			<button class="toast error" onclick={() => client.dismissError(index)} title="Dismiss">{error}</button>
		{/each}
	</div>
{/if}

<style>
	.shell {
		display: flex;
		flex-direction: column;
		height: 100%;
	}
	.demo-banner {
		display: flex;
		align-items: center;
		gap: 10px;
		height: 32px;
		flex: none;
		padding: 0 16px;
		font-size: 12.5px;
		color: var(--ink-soft);
		background: var(--panel);
		border-bottom: 1px solid var(--line);
		white-space: nowrap;
		overflow: hidden;
	}
	.demo-tag {
		font-size: 10.5px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		padding: 1px 7px;
		border-radius: 5px;
		background: var(--sticky);
		color: var(--sticky-ink);
	}
	.demo-text {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.demo-banner a {
		color: var(--accent);
		margin-left: auto;
		flex: none;
	}
	.stage {
		position: relative;
		flex: 1;
		min-height: 0;
		overflow: hidden;
		background: var(--canvas);
	}
	.hud {
		position: absolute;
		top: 14px;
		z-index: 10;
		display: flex;
		align-items: center;
		gap: 8px;
		pointer-events: none;
	}
	.hud > :global(*) {
		pointer-events: auto;
	}
	.top-left {
		left: 14px;
		flex-direction: column;
		align-items: flex-start;
		gap: 4px;
	}
	.top-right {
		right: 14px;
	}
	.panel-open .top-right {
		display: none;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 9px;
		height: 40px;
		padding: 0 14px 0 10px;
		border-radius: 13px;
		background: var(--glass);
		backdrop-filter: blur(12px);
		border: 1px solid var(--card-line);
		box-shadow: var(--shadow-card);
		font-size: 14.5px;
		letter-spacing: -0.01em;
	}
	.logo {
		width: 24px;
		height: 24px;
		fill: var(--ink);
		stroke: var(--ink);
		stroke-width: 1.8;
		stroke-linecap: round;
	}
	.logo rect {
		stroke: none;
	}
	.stats {
		display: flex;
		gap: 10px;
		padding-left: 6px;
		font-size: 12px;
		color: var(--ink-faint);
	}
	.working {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		color: var(--ink-soft);
	}
	.working i {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--live);
		animation: blink 1.1s ease-in-out infinite;
	}
	@keyframes blink {
		50% {
			opacity: 0.25;
		}
	}
	.offline {
		font-size: 12px;
		padding: 4px 10px;
		border-radius: 999px;
		background: var(--danger-soft);
		color: var(--danger);
	}
	.round {
		display: grid;
		place-items: center;
		width: 40px;
		height: 40px;
		border-radius: 13px;
		border: 1px solid var(--card-line);
		background: var(--glass);
		backdrop-filter: blur(12px);
		box-shadow: var(--shadow-card);
		color: var(--ink-soft);
		cursor: pointer;
	}
	.round:hover,
	.round[aria-pressed="true"] {
		color: var(--ink);
	}
	.round.small {
		width: 28px;
		height: 28px;
		border-radius: 8px;
		box-shadow: none;
	}
	.toolbar {
		position: absolute;
		left: 50%;
		bottom: 18px;
		transform: translateX(-50%);
		z-index: 10;
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 5px;
		border-radius: 16px;
		background: var(--glass);
		backdrop-filter: blur(14px);
		border: 1px solid var(--card-line);
		box-shadow: var(--shadow-lift);
		transition: transform 0.35s cubic-bezier(0.2, 0.8, 0.2, 1);
	}
	.panel-open .toolbar {
		transform: translateX(calc(-50% - var(--inset, 0px) / 2));
	}
	.tool {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 36px;
		padding: 0 12px;
		border-radius: 11px;
		border: none;
		background: none;
		color: var(--ink-soft);
		font: inherit;
		font-size: 13px;
		font-weight: 550;
		cursor: pointer;
		white-space: nowrap;
	}
	.tool:hover {
		background: var(--chip);
		color: var(--ink);
	}
	.tool.on {
		color: var(--ink);
		background: var(--chip);
	}
	.tool.primary {
		background: var(--ink);
		color: var(--paper);
	}
	.tool.primary:hover {
		opacity: 0.9;
	}
	.tool.icon-only {
		width: 36px;
		padding: 0;
		justify-content: center;
	}
	.tool.zoom {
		min-width: 54px;
		padding: 0 6px;
		justify-content: center;
		font-variant-numeric: tabular-nums;
		font-size: 12.5px;
	}
	.sep {
		width: 1px;
		height: 20px;
		margin: 0 5px;
		background: var(--line);
	}
	.help {
		position: absolute;
		right: 14px;
		top: 64px;
		z-index: 12;
		width: 300px;
		padding: 14px 16px;
		border-radius: 16px;
		background: var(--panel);
		border: 1px solid var(--card-line);
		box-shadow: var(--shadow-lift);
		font-size: 12.5px;
		animation: drop 0.2s ease-out;
	}
	@keyframes drop {
		from {
			opacity: 0;
			transform: translateY(-6px);
		}
	}
	.help-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 8px;
	}
	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 6px 12px;
		margin: 0;
	}
	dt {
		font-family: var(--mono);
		font-size: 11.5px;
		color: var(--ink);
		white-space: nowrap;
	}
	dd {
		margin: 0;
		color: var(--ink-soft);
	}
	.help p {
		margin: 12px 0 0;
		padding-top: 10px;
		border-top: 1px solid var(--line);
		color: var(--ink-soft);
		line-height: 1.5;
	}
	.help p :global(.icon) {
		display: inline-block;
		vertical-align: -2px;
	}
	.connecting {
		position: absolute;
		inset: 0;
		display: grid;
		place-content: center;
		justify-items: center;
		gap: 14px;
		color: var(--ink-soft);
		font-size: 14px;
	}
	.spinner {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		border: 2.5px solid var(--line);
		border-top-color: var(--ink);
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.toasts {
		position: fixed;
		left: 50%;
		bottom: 82px;
		transform: translateX(-50%);
		z-index: 60;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		max-width: calc(100vw - 32px);
	}
	.toast {
		padding: 8px 14px;
		border-radius: 12px;
		border: none;
		background: var(--ink);
		color: var(--paper);
		font: inherit;
		font-size: 13px;
		box-shadow: var(--shadow-lift);
		animation: drop 0.2s ease-out;
	}
	.toast.error {
		background: var(--danger);
		color: white;
		cursor: pointer;
	}
	@media (max-width: 760px) {
		.demo-banner {
			padding: 0 16px;
			gap: 8px;
		}
		.demo-banner a {
			display: none;
		}
		.stats {
			display: none;
		}
		.brand {
			height: 38px;
			font-size: 13.5px;
		}
		.round {
			width: 38px;
			height: 38px;
		}
		.toolbar {
			bottom: max(14px, env(safe-area-inset-bottom));
		}
		.tool span,
		.sep.wide,
		.tool.wide {
			display: none;
		}
		.tool.primary,
		.tool {
			padding: 0 10px;
		}
		.help {
			left: 16px;
			right: 16px;
			width: auto;
		}
	}
</style>
