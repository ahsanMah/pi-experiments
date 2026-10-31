<script lang="ts">
	import { flip } from "svelte/animate";
	import { fly } from "svelte/transition";
	import { tick, untrack } from "svelte";
	import type { TreeNode } from "../../../shared/protocol.ts";
	import type { BranchesClient } from "../../src/lib/client.svelte.ts";
	import { branchHue } from "../../src/lib/layout.ts";
	import BranchMap from "./components/BranchMap.svelte";
	import Column, { type DragFrom } from "./components/Column.svelte";
	import Compare from "./components/Compare.svelte";
	import Icon from "./components/Icon.svelte";
	import ShareSheet, { type ShareChoice, type ShareRequest } from "./components/ShareSheet.svelte";
	import { entryText, notesFor, treeOrder } from "./lib.ts";

	let { client, demo = false }: { client: BranchesClient; demo?: boolean } = $props();

	// Layout preferences are per-viewer conveniences; storage may be unavailable (private windows, sandboxes).
	const stored = <T,>(key: string, fallback: T): T => {
		try {
			const raw = localStorage.getItem(`columns:${key}`);
			return raw === null ? fallback : (JSON.parse(raw) as T);
		} catch {
			return fallback;
		}
	};
	const store = (key: string, value: unknown) => {
		try {
			localStorage.setItem(`columns:${key}`, JSON.stringify(value));
		} catch {}
	};

	type Width = "fit" | "s" | "m" | "l";
	const WIDTHS: Record<Exclude<Width, "fit">, number> = { s: 360, m: 450, l: 600 };
	const GAP = 12;
	const PAD = 16;

	let openIds = $state<number[]>(stored("open", []));
	let pinned = $state<number[]>(stored("pinned", []));
	let width = $state<Width>(stored("width", "fit"));
	let mapShown = $state<boolean>(stored("map", true));
	let activeId = $state<number | undefined>();
	let drafts = $state<Record<number, string>>({});
	let focusRequests = $state<Record<number, { id: number; n: number } | null>>({});
	let shareRequest = $state<ShareRequest | undefined>();
	let compareSel = $state<number[]>([]);
	let compareOpen = $state(false);
	let mobileMap = $state(false);
	let initialized = false;
	let requests = 0;

	$effect(() => {
		store("open", openIds);
		store("pinned", pinned);
		store("width", width);
		store("map", mapShown);
	});

	// Theme: an explicit data-theme on <html> wins; the toggle sets one, "system" removes it.
	type Theme = "system" | "light" | "dark";
	const root = document.documentElement;
	const savedTheme = stored<Theme | null>("theme", null);
	let theme = $state<Theme>(savedTheme ?? ((root.dataset.theme as Theme | undefined) ?? "system"));
	const applyTheme = (next: Theme) => {
		theme = next;
		store("theme", next);
		if (next === "system") delete root.dataset.theme;
		else root.dataset.theme = next;
	};
	if (savedTheme !== null) applyTheme(savedTheme);

	const narrowQuery = matchMedia("(max-width: 760px)");
	let narrow = $state(narrowQuery.matches);
	$effect(() => {
		const update = () => (narrow = narrowQuery.matches);
		narrowQuery.addEventListener("change", update);
		return () => narrowQuery.removeEventListener("change", update);
	});

	const ordered = $derived(treeOrder(client.tree.branches));
	const byId = $derived(new Map(client.tree.branches.map((b) => [b.id, b])));
	const rank = $derived(new Map(ordered.map((o) => [o.branch.id, o.index])));
	const counts = $derived.by(() => {
		const map = new Map<number, number>();
		for (const node of client.tree.nodes) if (node.role === "user" || node.role === "assistant") map.set(node.conversationId, (map.get(node.conversationId) ?? 0) + 1);
		return map;
	});
	const openSet = $derived(new Set(openIds));
	// Pinned columns lead the strip so their sticky offsets stack from the left edge.
	const columns = $derived(
		[...openIds.filter((id) => pinned.includes(id)), ...openIds.filter((id) => !pinned.includes(id))].flatMap((id) => {
			const branch = byId.get(id);
			return branch === undefined ? [] : [branch];
		}),
	);
	const busyCount = $derived(client.tree.branches.filter((b) => b.busy).length);

	// First tree: drop columns of branches that no longer exist; open the first few if none are left.
	$effect(() => {
		const branches = client.tree.branches;
		if (initialized || branches.length === 0) return;
		initialized = true;
		untrack(() => {
			const ids = new Set(branches.map((b) => b.id));
			openIds = openIds.filter((id) => ids.has(id));
			pinned = pinned.filter((id) => ids.has(id));
			if (openIds.length === 0) openIds = ordered.slice(0, 4).map((o) => o.branch.id);
			activeId = openIds[0];
		});
	});

	// Live views for every open column, plus the branches being compared.
	$effect(() => {
		const wanted = new Set([...openIds, ...(compareOpen ? compareSel : [])].filter((id) => byId.has(id)));
		client.watch([...wanted]);
	});

	let strip: HTMLElement | undefined = $state();
	let stripWidth = $state(1200);
	const colWidth = $derived.by(() => {
		if (narrow) return stripWidth;
		if (width !== "fit") return WIDTHS[width];
		const n = Math.max(1, columns.length);
		return Math.max(340, Math.floor((stripWidth - PAD * 2 - GAP * (n - 1)) / n));
	});
	// Sticky offsets count from the strip's padding edge, so the first pinned column sits at 0.
	const pinLeft = (id: number) => pinned.filter((p) => columns.some((c) => c.id === p)).indexOf(id) * (colWidth + GAP);

	/** Scroll the strip so a column is fully visible, clear of the pinned ones. */
	const scrollToColumn = (id: number) => {
		const el = strip?.querySelector<HTMLElement>(`[data-column="${id}"]`);
		if (strip === undefined || el === null || el === undefined) return;
		if (narrow) {
			strip.scrollTo({ left: el.offsetLeft - strip.offsetLeft, behavior: "smooth" });
			return;
		}
		if (pinned.includes(id)) return;
		const covered = pinned.filter((p) => columns.some((c) => c.id === p)).length * (colWidth + GAP);
		const left = el.offsetLeft - PAD - covered;
		const right = el.offsetLeft + el.offsetWidth + PAD - strip.clientWidth;
		if (strip.scrollLeft > left) strip.scrollTo({ left, behavior: "smooth" });
		else if (strip.scrollLeft < right) strip.scrollTo({ left: Math.min(left, right), behavior: "smooth" });
	};

	// A column asked for before the tree lists it (a fresh fork) is revealed once it renders.
	let pendingReveal = $state<{ id: number; focus: boolean } | null>(null);
	$effect(() => {
		const pending = pendingReveal;
		if (pending === null || !columns.some((c) => c.id === pending.id)) return;
		pendingReveal = null;
		void tick().then(() => {
			// Let the slide-in start before scrolling to it.
			setTimeout(() => {
				scrollToColumn(pending.id);
				if (pending.focus) strip?.querySelector<HTMLTextAreaElement>(`[data-column="${pending.id}"] textarea`)?.focus({ preventScroll: true });
			}, 60);
		});
	});

	/** Open a branch as a column at its place in tree order (or scroll to it when open). */
	const show = (id: number, focus = false) => {
		if (!openIds.includes(id)) {
			const at = rank.get(id) ?? Infinity;
			const index = openIds.findIndex((other) => (rank.get(other) ?? Infinity) > at);
			openIds = index === -1 ? [...openIds, id] : [...openIds.slice(0, index), id, ...openIds.slice(index)];
		}
		activeId = id;
		mobileMap = false;
		pendingReveal = { id, focus };
	};
	const reveal = (id: number, entry?: number) => {
		show(id);
		if (entry !== undefined) focusRequests[id] = { id: entry, n: ++requests };
	};
	const hide = (id: number) => {
		const index = openIds.indexOf(id);
		openIds = openIds.filter((other) => other !== id);
		pinned = pinned.filter((other) => other !== id);
		compareSel = compareSel.filter((other) => other !== id);
		if (activeId === id) activeId = openIds[Math.min(index, openIds.length - 1)];
	};
	const togglePin = (id: number) => {
		pinned = pinned.includes(id) ? pinned.filter((p) => p !== id) : [...pinned, id];
		pendingReveal = { id, focus: false };
	};
	const toggleCompare = (id: number) => {
		if (compareSel.includes(id)) compareSel = compareSel.filter((c) => c !== id);
		else compareSel = [...compareSel, id].slice(-2);
	};
	const openCompare = () => {
		if (compareSel.length < 2) {
			const rest = columns.map((c) => c.id).filter((id) => !compareSel.includes(id));
			compareSel = [...compareSel, ...rest].slice(0, 2);
		}
		if (compareSel.length === 2) compareOpen = true;
	};

	/** Fork `conversationId` at `at`; the new column slides in right after `nextTo`. */
	const fork = async (conversationId: number, at: number, draft = "") => {
		const { conversationId: id } = await client.request<{ conversationId: number }>({ t: "fork", conversationId, at });
		drafts[id] = draft;
		const index = openIds.indexOf(conversationId);
		openIds = index === -1 ? [...openIds, id] : [...openIds.slice(0, index + 1), id, ...openIds.slice(index + 1)];
		activeId = id;
		pendingReveal = { id, focus: true };
	};
	const editBranch = async (columnId: number, node: TreeNode) => {
		if (node.before === undefined) return;
		// The tree's preview is cut short; ask for the message itself.
		const { text } = await client.request<{ text: string }>({ t: "text", conversationId: node.conversationId, entryId: node.id });
		await fork(columnId, node.before, text);
	};
	const create = async () => {
		const { conversationId } = await client.request<{ conversationId: number }>({ t: "new" });
		openIds = [...openIds, conversationId];
		activeId = conversationId;
		pendingReveal = { id: conversationId, focus: true };
	};

	const upTo = $derived.by(() => {
		const from = shareRequest?.from;
		if (from?.at === undefined) return "";
		const entry = client.views[from.conversationId]?.entries.find((e) => e.id === from.at);
		const text = entryText(entry).replace(/\s+/g, " ");
		return text.length > 64 ? `${text.slice(0, 63)}…` : text;
	});
	const share = async (choice: ShareChoice) => {
		await client.request({
			t: "share",
			mode: choice.mode,
			to: choice.to,
			...(shareRequest?.from !== undefined ? { from: shareRequest.from } : {}),
			...(choice.title.trim() !== "" ? { title: choice.title.trim() } : {}),
			...(choice.text.trim() !== "" ? { text: choice.text } : {}),
		});
	};

	// Keep the active tab in view as swipes move through the columns.
	$effect(() => {
		if (!narrow || activeId === undefined) return;
		const id = activeId;
		void tick().then(() => document.querySelector(`.tab[data-tab="${id}"]`)?.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" }));
	});

	// On a phone the strip shows one column at a time; swiping changes the active one.
	const onStripScroll = () => {
		if (!narrow || strip === undefined) return;
		const index = Math.round(strip.scrollLeft / Math.max(1, strip.clientWidth));
		const id = columns[index]?.id;
		if (id !== undefined && id !== activeId) activeId = id;
	};

	const onKey = (event: KeyboardEvent) => {
		// Alt+←/→ walks the columns, keeping the hands on the keyboard.
		if (!event.altKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
		const index = columns.findIndex((c) => c.id === activeId);
		const next = columns[index + (event.key === "ArrowLeft" ? -1 : 1)];
		if (next === undefined) return;
		event.preventDefault();
		show(next.id, true);
	};
</script>

<svelte:window onkeydown={onKey} />

<div class="shell" style="--banner-h: {demo ? 30 : 0}px">
{#if demo}
	<div class="demo-banner">
		<span class="demo-tag">Demo</span>
		<span class="demo-text">The branches server runs inside this page with an offline echo model; nothing is saved.</span>
		<a href="https://github.com/ahsanMah/pi-experiments" target="_blank" rel="noreferrer noopener">Run it with real models →</a>
	</div>
{/if}

<header class="top">
	<div class="brand">
		<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
			<rect x="1" y="3" width="5" height="16" rx="1.5" fill="var(--accent)" />
			<rect x="8.5" y="3" width="5" height="11" rx="1.5" fill="var(--accent)" opacity="0.65" />
			<rect x="16" y="3" width="5" height="7" rx="1.5" fill="var(--accent)" opacity="0.35" />
		</svg>
		<strong>pi-branches</strong>
		<span class="variant">columns</span>
	</div>
	<div class="status">
		<span class="conn" class:on={client.connected} title={client.connected ? "Connected" : "Connecting…"}></span>
		{client.tree.branches.length} branches{#if busyCount > 0}<span class="busy-count"> · {busyCount} working</span>{/if}
	</div>
	<span class="spacer"></span>
	<div class="actions">
		<button class="icon only-narrow" class:on={mobileMap} onclick={() => (mobileMap = !mobileMap)} title="Branch map" aria-label="Branch map"><Icon name="map" /></button>
		<button class="tool" onclick={create} title="Start an unrelated thread in a new column"><Icon name="plus" size={14} /><span>New thread</span></button>
		<button class="tool" onclick={() => (shareRequest = {})} title="Write a note for chosen branches or all of them"><Icon name="note" size={14} /><span>Note</span></button>
		<button class="tool" onclick={openCompare} disabled={columns.length < 2 && compareSel.length < 2} title="Compare the last answers of two columns"><Icon name="compare" size={14} /><span>Compare</span></button>
		<div class="seg not-narrow" role="group" aria-label="Column width">
			{#each ["fit", "s", "m", "l"] as const as w (w)}
				<button class:on={width === w} onclick={() => (width = w)} title={w === "fit" ? "Fit open columns to the window" : `Column width ${w.toUpperCase()}`}>{w === "fit" ? "Fit" : w.toUpperCase()}</button>
			{/each}
		</div>
		<button
			class="icon"
			onclick={() => applyTheme(theme === "system" ? "light" : theme === "light" ? "dark" : "system")}
			title="Theme: {theme}"
			aria-label="Theme: {theme}"
		>
			<Icon name={theme === "system" ? "auto" : theme === "light" ? "sun" : "moon"} />
		</button>
	</div>
</header>

<div class="mapband" class:collapsed={!mapShown} class:mobile-open={mobileMap}>
	<button class="map-toggle not-narrow" onclick={() => (mapShown = !mapShown)} title={mapShown ? "Collapse the branch map" : "Show the branch map"}>
		<Icon name={mapShown ? "up" : "down"} size={12} />Map
	</button>
	{#if mapShown || mobileMap}
		<div class="map-scroll">
			<BranchMap {ordered} open={openSet} {activeId} {counts} show={(id) => show(id)} {hide} vertical={narrow} />
		</div>
		<div class="map-side">
			<button onclick={() => (openIds = ordered.map((o) => o.branch.id))} disabled={openIds.length >= ordered.length} title="Open every branch as a column">Open all</button>
			<button onclick={() => activeId !== undefined && (openIds = [activeId])} disabled={openIds.length <= 1} title="Close every column except the active one">Only active</button>
		</div>
	{:else}
		<div class="map-mini">
			{#each ordered as { branch } (branch.id)}
				<button class="mini" class:open={openSet.has(branch.id)} style="--hue: {branchHue(branch.id)}" onclick={() => show(branch.id)} title={branch.title}>
					<span class:busy={branch.busy}></span>
				</button>
			{/each}
		</div>
	{/if}
</div>

{#if narrow && columns.length > 0}
	<nav class="tabs" aria-label="Open columns">
		{#each columns as branch (branch.id)}
			<button class="tab" data-tab={branch.id} class:on={branch.id === activeId} style="--hue: {branchHue(branch.id)}" onclick={() => show(branch.id)}>
				<span class="tab-dot" class:busy={branch.busy}></span>{branch.title}
			</button>
		{/each}
	</nav>
{/if}

<main
	class="strip"
	bind:this={strip}
	bind:clientWidth={stripWidth}
	onscroll={onStripScroll}
	style="--col-w: {colWidth}px; --gap: {GAP}px; --strip-pad: {PAD}px"
>
	{#each columns as branch (branch.id)}
		{@const isPinned = pinned.includes(branch.id) && !narrow}
		<div class="slot" class:pinned={isPinned} style={isPinned ? `left: ${pinLeft(branch.id)}px` : undefined} animate:flip={{ duration: 260 }} in:fly={{ x: 60, duration: 280, opacity: 0 }}>
			<Column
				{branch}
				view={client.views[branch.id]}
				branches={client.tree.branches}
				nodes={client.tree.nodes}
				notes={notesFor(client.tree.notes, branch.id)}
				models={client.models}
				pinned={isPinned}
				comparing={compareSel.includes(branch.id)}
				active={branch.id === activeId}
				focusRequest={focusRequests[branch.id] ?? null}
				bind:draft={() => drafts[branch.id] ?? "", (value) => (drafts[branch.id] = value)}
				send={async (text, whenBusy) => void (await client.request({ t: "send", conversationId: branch.id, text, whenBusy }))}
				abort={() => void client.request({ t: "abort", conversationId: branch.id })}
				fork={(at) => void fork(branch.id, at)}
				editBranch={(node) => void editBranch(branch.id, node)}
				share={(at) => (shareRequest = { from: { conversationId: branch.id, ...(at !== undefined ? { at } : {}) } })}
				dropShare={(from: DragFrom) => (shareRequest = { from, to: [branch.id] })}
				addNote={() => (shareRequest = { to: [branch.id] })}
				unshare={(noteId) => void client.request({ t: "unshare", noteId })}
				rename={(title) => void client.request({ t: "rename", conversationId: branch.id, title })}
				configure={(model) => void client.request({ t: "configure", conversationId: branch.id, model })}
				close={() => hide(branch.id)}
				togglePin={() => togglePin(branch.id)}
				toggleCompare={() => toggleCompare(branch.id)}
				{reveal}
				activate={() => (activeId = branch.id)}
			/>
		</div>
	{:else}
		<div class="nothing">
			{#if client.tree.branches.length === 0}
				<p>{client.connected ? "Loading the branch tree…" : "Connecting to the branches server…"}</p>
			{:else}
				<p><strong>No columns open.</strong></p>
				<p>Pick branches on the map to lay them side by side.</p>
				<button class="primary" onclick={() => (openIds = ordered.slice(0, 3).map((o) => o.branch.id))}>Open the first three</button>
			{/if}
		</div>
	{/each}
	<div class="tail" aria-hidden="true"></div>
</main>

{#if compareSel.length > 0 && !compareOpen}
	<div class="compare-pill" transition:fly={{ y: 20, duration: 180 }}>
		<Icon name="compare" size={14} />
		{#each compareSel as id, i (id)}
			{#if i > 0}<span class="vs">vs</span>{/if}
			<span class="pick" style="--hue: {branchHue(id)}"><span></span>{byId.get(id)?.title ?? `#${id}`}</span>
		{/each}
		{#if compareSel.length < 2}<span class="vs muted">pick one more column</span>{/if}
		<button class="primary" disabled={compareSel.length < 2} onclick={() => (compareOpen = true)}>Compare</button>
		<button class="icon" onclick={() => (compareSel = [])} aria-label="Clear compare"><Icon name="close" size={14} /></button>
	</div>
{/if}

{#if compareOpen && compareSel.length === 2}
	<Compare
		pair={[compareSel[0]!, compareSel[1]!]}
		{ordered}
		views={client.views}
		pick={(side, id) => (compareSel = side === 0 ? [id, compareSel[1]!] : [compareSel[0]!, id])}
		reveal={(id) => show(id)}
		close={() => (compareOpen = false)}
	/>
{/if}

{#if shareRequest}
	<ShareSheet request={shareRequest} {ordered} {upTo} submit={share} close={() => (shareRequest = undefined)} />
{/if}

{#if client.errors.length > 0}
	<div class="toasts">
		{#each client.errors as error, index (index)}
			<button class="toast" onclick={() => client.dismissError(index)} title="Dismiss">{error}</button>
		{/each}
	</div>
{/if}
</div>

<style>
	.shell {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
	}
	.demo-banner {
		display: flex;
		align-items: center;
		gap: 10px;
		flex: none;
		height: 30px;
		padding: 0 16px;
		font-size: 12.5px;
		background: var(--accent-soft);
		border-bottom: 1px solid var(--border);
		white-space: nowrap;
		overflow: hidden;
	}
	.demo-tag {
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--accent);
	}
	.demo-text {
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--text-muted);
	}
	.demo-banner a {
		color: var(--accent);
		text-decoration: none;
		font-weight: 550;
	}
	.top {
		display: flex;
		align-items: center;
		gap: 16px;
		flex: none;
		height: 52px;
		padding: 0 12px 0 16px;
		background: var(--surface);
		border-bottom: 1px solid var(--border);
	}
	.brand {
		display: flex;
		white-space: nowrap;
		align-items: center;
		gap: 8px;
		font-size: 15px;
		letter-spacing: -0.01em;
	}
	.variant {
		font: 11px var(--mono);
		padding: 1px 6px;
		border-radius: 5px;
		background: var(--surface-sunk);
		color: var(--text-muted);
	}
	.status {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12.5px;
		color: var(--text-muted);
		white-space: nowrap;
	}
	.busy-count {
		color: var(--accent);
	}
	.conn {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--text-faint);
	}
	.conn.on {
		background: #2fb37a;
		box-shadow: 0 0 0 3px rgb(47 179 122 / 0.18);
	}
	.spacer {
		flex: 1;
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.tool {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 30px;
	}
	.seg {
		display: flex;
		padding: 2px;
		border: 1px solid var(--border);
		border-radius: 9px;
		background: var(--surface-sunk);
	}
	.seg button {
		border: none;
		background: transparent;
		font-size: 11.5px;
		padding: 2px 8px;
		border-radius: 7px;
		color: var(--text-muted);
	}
	.seg button.on {
		background: var(--surface);
		color: var(--text);
		box-shadow: 0 1px 2px rgb(0 0 0 / 0.08);
	}
	.only-narrow {
		display: none !important;
	}
	.mapband {
		display: flex;
		align-items: flex-start;
		gap: 14px;
		flex: none;
		padding: 12px 16px;
		background: var(--surface-2);
		border-bottom: 1px solid var(--border);
	}
	.mapband.collapsed {
		align-items: center;
		padding: 6px 16px;
	}
	.map-toggle {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		flex: none;
		margin-top: 3px;
		padding: 1px 6px;
		border: none;
		background: transparent;
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-faint);
	}
	.collapsed .map-toggle {
		margin-top: 0;
	}
	.map-toggle:hover {
		color: var(--text);
	}
	.map-scroll {
		flex: 1;
		min-width: 0;
		overflow: auto;
		max-height: 150px;
		padding-bottom: 2px;
	}
	.map-side {
		display: flex;
		flex-direction: column;
		gap: 4px;
		flex: none;
	}
	.map-side button {
		font-size: 11.5px;
		padding: 2px 9px;
	}
	.map-mini {
		display: flex;
		gap: 4px;
	}
	.mini {
		width: 18px;
		height: 18px;
		padding: 0;
		display: grid;
		place-items: center;
		border: none;
		background: transparent;
	}
	.mini span {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		box-shadow: inset 0 0 0 1.5px var(--c);
	}
	.mini.open span {
		background: var(--c);
	}
	.mini span.busy {
		animation: pulse 1s ease-in-out infinite;
	}
	.strip {
		flex: 1;
		min-height: 0;
		display: flex;
		gap: var(--gap);
		padding: var(--strip-pad);
		overflow-x: auto;
		overflow-y: hidden;
		scroll-padding-inline: var(--strip-pad);
		background-image: radial-gradient(var(--board-line) 1px, transparent 1px);
		background-size: 18px 18px;
	}
	.slot {
		display: flex;
		flex: none;
		height: 100%;
		min-height: 0;
	}
	/* Pinned columns lead the strip and stick to its left edge while the rest scroll under them. */
	.slot.pinned {
		position: sticky;
		z-index: 4;
		background: var(--board);
	}
	/* Cover the strip's gutter beside a pinned column, so columns scrolling under it don't peek out. */
	.slot.pinned::before {
		content: "";
		position: absolute;
		top: calc(-1 * var(--strip-pad));
		bottom: calc(-1 * var(--strip-pad));
		left: calc(-1 * var(--strip-pad) - 1px);
		width: calc(var(--strip-pad) + 1px);
		background: var(--board);
	}
	.tail {
		flex: none;
		width: 1px;
	}
	.nothing {
		margin: auto;
		text-align: center;
		color: var(--text-muted);
	}
	.nothing p {
		margin: 6px 0;
	}
	.nothing button {
		margin-top: 10px;
	}
	.compare-pill {
		position: fixed;
		left: 50%;
		bottom: 20px;
		transform: translateX(-50%);
		z-index: 30;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 6px 6px 14px;
		border: 1px solid var(--border-strong);
		border-radius: 999px;
		background: var(--surface);
		box-shadow: var(--shadow-lift);
		font-size: 13px;
		color: var(--accent);
		white-space: nowrap;
	}
	.pick {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		color: var(--text);
		font-weight: 600;
	}
	.pick span {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--c);
	}
	.vs {
		color: var(--text-faint);
		font-size: 12px;
	}
	.compare-pill .primary {
		border-radius: 999px;
		padding: 4px 14px;
	}
	.toasts {
		position: fixed;
		bottom: 72px;
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
		border-radius: 10px;
		padding: 8px 14px;
		box-shadow: var(--shadow-lift);
	}
	.tabs {
		display: flex;
		gap: 6px;
		flex: none;
		padding: 8px 16px;
		overflow-x: auto;
		background: var(--surface);
		border-bottom: 1px solid var(--border);
		scrollbar-width: none;
	}
	.tab {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		flex: none;
		max-width: 60vw;
		padding: 4px 12px 4px 9px;
		font-size: 13px;
		border-radius: 999px;
		background: var(--surface-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.tab.on {
		border-color: var(--c);
		background: var(--c-soft);
		font-weight: 600;
	}
	.tab-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--c);
		flex: none;
	}
	.tab-dot.busy {
		animation: pulse 1s ease-in-out infinite;
	}

	@media (max-width: 760px) {
		.demo-banner a,
		.variant,
		.status,
		.not-narrow,
		.tool span {
			display: none;
		}
		.only-narrow {
			display: inline-grid !important;
		}
		.top {
			gap: 8px;
			padding: 0 10px 0 16px;
		}
		.tool {
			width: 32px;
			padding: 0;
			justify-content: center;
		}
		.mapband {
			display: none;
		}
		.mapband.mobile-open {
			display: flex;
			position: fixed;
			top: calc(var(--banner-h, 0px) + 52px);
			left: 8px;
			right: 8px;
			z-index: 40;
			flex-direction: column;
			border: 1px solid var(--border);
			border-radius: 14px;
			box-shadow: var(--shadow-lift);
		}
		.mapband.mobile-open .map-scroll {
			width: 100%;
			max-height: 50vh;
		}
		.mapband.mobile-open .map-side {
			flex-direction: row;
		}
		.strip {
			padding: 0;
			gap: 0;
			scroll-snap-type: x mandatory;
			background-image: none;
			background: var(--surface);
			--strip-pad: 0px;
		}
		.slot {
			scroll-snap-align: start;
			scroll-snap-stop: always;
		}
		.strip :global(.column) {
			border-radius: 0;
			border: none;
			box-shadow: none;
		}
		.tail {
			display: none;
		}
		.compare-pill {
			bottom: 96px;
		}
	}
</style>
