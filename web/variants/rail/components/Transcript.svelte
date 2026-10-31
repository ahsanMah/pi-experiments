<script lang="ts">
	import { tick } from "svelte";
	import type { BranchInfo, TreeIndex, TreeNode } from "../../../../shared/protocol.ts";
	import { branchHue } from "../../../src/lib/layout.ts";
	import { renderMarkdown } from "../../../src/lib/markdown.ts";
	import { textOf, type ConversationView, type ViewEntry } from "../../../src/lib/view.ts";
	import { forkOptions, layoutRail, type Dot, type Row, type RowKind, type Tree } from "../lib/rail.ts";
	import Entry from "./Entry.svelte";
	import Rail from "./Rail.svelte";
	import Switcher from "./Switcher.svelte";

	type Props = {
		branch: BranchInfo;
		view: ConversationView | undefined;
		tree: TreeIndex;
		index: Tree;
		recent: readonly number[];
		focusId: number | null;
		/** Keyboard shortcuts are live (no dialog open). */
		keys: boolean;
		open: (branchId: number, entryId: number | null) => void;
		branchAfter: (entryId: number) => void;
		editBranch: (node: TreeNode) => void;
		share: (entryId: number) => void;
		unshare: (noteId: string) => void;
	};
	let { branch, view, tree, index, recent, focusId, keys, open, branchAfter, editBranch, share, unshare }: Props = $props();

	let scroller: HTMLElement | undefined = $state();
	let column: HTMLElement | undefined = $state();
	let rows = $state<Row[]>([]);
	let forkYs = $state<Map<number, number>>(new Map());
	let offsetLeft = $state(0);
	let cursorId = $state<number | null>(null);
	/** Extra room below the last message, so a switched-to branch can keep the chip where it was. */
	let slack = $state(0);
	let stick = true;
	/** Where the switcher chip was on screen when it was used, to put it back there in the next branch. */
	let anchor: { at: number; top: number; branch: number } | undefined;
	let focusedDone: number | null = null;

	const entries = $derived(view?.entries ?? []);
	const results = $derived(
		new Map(
			entries
				.filter((e) => e.kind === "pi.tool-result")
				.flatMap((e): [string, ViewEntry][] => {
					const m = e.model?.[0];
					return m?.role === "toolResult" ? [[m.toolCallId, e]] : [];
				}),
		),
	);
	const live = $derived(view?.docs["pi.live"]);
	const partial = $derived(textOf(live?.generation?.message?.content));
	const runningTools = $derived((live?.tools ?? []).filter((t) => t.status !== "done"));
	const path = $derived(new Set(entries.map((e) => e.id)));
	const forks = $derived(
		new Map(entries.map((e) => [e.id, forkOptions(index, tree.branches, e.id, branch.id, path)] as const).filter(([, options]) => options.length > 0)),
	);
	const parent = $derived(tree.branches.find((b) => b.id === branch.parent?.conversationId));
	const forkNode = $derived(branch.tip === null ? undefined : [...path].reverse().find((id) => index.byId.get(id)?.conversationId !== branch.id && index.byId.has(id)));
	const own = $derived(entries.filter((e) => e.conversationId === branch.id && (e.kind === "pi.user" || e.kind === "pi.assistant")).length);

	// Gutter: the lanes need room left of the text; on narrow screens only the active lane fits.
	const compact = $derived(offsetLeft < 120);
	const railWidth = $derived(compact ? 34 : Math.min(320, offsetLeft - 8));
	const x0 = $derived(compact ? 18 : railWidth - 6);
	const layout = $derived(layoutRail({ tree: index, branches: tree.branches, activeId: branch.id, rows, forks: forkYs, recent, x0, colGap: 18, step: 28, compact }));

	const measure = () => {
		if (column === undefined || scroller === undefined) return;
		offsetLeft = column.offsetLeft;
		const top = column.getBoundingClientRect().top;
		const next: Row[] = [];
		for (const el of column.querySelectorAll<HTMLElement>("[data-row]")) {
			const rect = el.getBoundingClientRect();
			next.push({ id: Number(el.dataset.row), y: Math.round(rect.top - top + Math.min(rect.height, 20) / 2), conv: Number(el.dataset.conv), kind: el.dataset.kind as RowKind });
		}
		// Rows change on every streamed token; skip the reactive write when nothing moved.
		if (next.length !== rows.length || next.some((row, i) => row.y !== rows[i]!.y || row.id !== rows[i]!.id || row.conv !== rows[i]!.conv)) rows = next;
		const chips = new Map<number, number>();
		for (const el of column.querySelectorAll<HTMLElement>("[data-fork]")) {
			const rect = el.getBoundingClientRect();
			chips.set(Number(el.dataset.fork), Math.round(rect.top - top + rect.height / 2));
		}
		if (chips.size !== forkYs.size || [...chips].some(([id, y]) => forkYs.get(id) !== y)) forkYs = chips;
	};
	$effect(() => {
		if (column === undefined || scroller === undefined) return;
		const observer = new ResizeObserver(() => measure());
		observer.observe(column);
		observer.observe(scroller);
		return () => observer.disconnect();
	});
	$effect(() => {
		void entries;
		void branch.busy;
		void tick().then(measure);
	});

	// Stay at the bottom while streaming unless the user scrolled up.
	const onScroll = () => {
		if (scroller === undefined) return;
		stick = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
	};
	$effect(() => {
		void entries.length;
		void partial;
		if (stick && focusId === null && anchor === undefined) void tick().then(() => scroller?.scrollTo({ top: scroller.scrollHeight }));
	});
	// A new branch opened: start at its end, unless a switcher chip or a rail dot says where to look.
	let shownBranch: number | undefined;
	$effect(() => {
		if (branch.id === shownBranch) return;
		shownBranch = branch.id;
		cursorId = null;
		if (anchor === undefined) slack = 0;
		if (anchor === undefined && focusId === null) stick = true;
	});
	$effect(() => {
		void entries;
		const pending = anchor;
		if (pending === undefined || pending.branch !== branch.id || view === undefined) return;
		anchor = undefined;
		slack = 0;
		void (async () => {
			await tick();
			const chip = column?.querySelector(`[data-fork="${pending.at}"]`);
			if (chip === null || chip === undefined || scroller === undefined) return;
			const top = scroller.scrollTop + chip.getBoundingClientRect().top - pending.top;
			// A shorter branch can't scroll that far; pad the end so the chip still stays put.
			const max = scroller.scrollHeight - scroller.clientHeight;
			if (top > max) {
				slack = top - max;
				await tick();
			}
			scroller.scrollTo({ top, behavior: "instant" });
		})();
	});
	$effect(() => {
		void entries.length;
		const id = focusId;
		if (id === null || id === focusedDone) return;
		void tick().then(() => {
			const el = column?.querySelector(`[data-entry="${id}"]`);
			if (el === null || el === undefined) return;
			focusedDone = id;
			stick = false;
			cursorId = id;
			el.scrollIntoView({ block: "center", behavior: "smooth" });
		});
	});

	const pick = (branchId: number, at: number) => {
		const chip = column?.querySelector(`[data-fork="${at}"]`);
		anchor = { at, top: chip?.getBoundingClientRect().top ?? 0, branch: branchId };
		stick = false;
		open(branchId, null);
	};

	const openDot = (dot: Dot) => {
		if (dot.active) {
			if (dot.node !== undefined) moveCursor(dot.node.id, "center");
			return;
		}
		if (dot.open !== undefined) open(dot.open, dot.node?.id ?? null);
	};

	// j/k move a reading cursor over the messages; the rail and the toolbar follow it.
	const navigable = $derived(entries.filter((e) => index.byId.has(e.id) && (e.kind !== "pi.assistant" || textOf(e.model?.[0]?.content as never).trim() !== "")));
	const moveCursor = (id: number, block: ScrollLogicalPosition = "nearest") => {
		cursorId = id;
		stick = false;
		column?.querySelector(`[data-entry="${id}"]`)?.scrollIntoView({ block, behavior: "smooth" });
	};
	const step = (delta: number) => {
		const at = navigable.findIndex((e) => e.id === cursorId);
		const next = at === -1 ? (delta > 0 ? navigable[0] : navigable.at(-1)) : navigable[Math.min(Math.max(at + delta, 0), navigable.length - 1)];
		if (next !== undefined) moveCursor(next.id);
	};
	/** The fork the [ and ] keys act on: the nearest one at or above the cursor, else the one nearest mid-screen. */
	const activeFork = (): number | undefined => {
		const ids = [...forks.keys()];
		if (ids.length === 0) return undefined;
		if (cursorId !== null) {
			const order = entries.map((e) => e.id);
			const at = order.indexOf(cursorId);
			const above = ids.filter((id) => order.indexOf(id) <= at);
			if (above.length > 0) return above.at(-1);
		}
		const middle = (scroller?.getBoundingClientRect().top ?? 0) + (scroller?.clientHeight ?? 0) / 2;
		let best: number | undefined;
		let distance = Infinity;
		for (const id of ids) {
			const chip = column?.querySelector(`[data-fork="${id}"]`);
			const d = chip === null || chip === undefined ? Infinity : Math.abs(chip.getBoundingClientRect().top - middle);
			if (d < distance) [best, distance] = [id, d];
		}
		return best;
	};
	const cycle = (delta: number) => {
		const at = activeFork();
		if (at === undefined) return;
		const options = forks.get(at)!;
		const current = Math.max(0, options.findIndex((o) => o.current));
		pick(options[(current + delta + options.length) % options.length]!.branch.id, at);
	};
	const target = () => (cursorId !== null ? cursorId : (navigable.at(-1)?.id ?? null));

	const onKey = (event: KeyboardEvent) => {
		if (!keys || event.metaKey || event.ctrlKey || event.altKey) return;
		const el = event.target as HTMLElement | null;
		if (el !== null && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
		const id = target();
		const node = id === null ? undefined : index.byId.get(id);
		const act = (fn: () => void) => {
			event.preventDefault();
			fn();
		};
		switch (event.key) {
			case "j":
			case "ArrowDown":
				if (event.key === "j" || cursorId !== null) act(() => step(1));
				break;
			case "k":
			case "ArrowUp":
				if (event.key === "k" || cursorId !== null) act(() => step(-1));
				break;
			case "[":
				act(() => cycle(-1));
				break;
			case "]":
				act(() => cycle(1));
				break;
			case "b":
				if (id !== null) act(() => branchAfter(id));
				break;
			case "e":
				if (node?.role === "user" && node.before !== undefined) act(() => editBranch(node));
				break;
			case "s":
				if (id !== null) act(() => share(id));
				break;
			case "Escape":
				cursorId = null;
				break;
		}
	};
</script>

<svelte:window onkeydown={onKey} />

<div class="scroller" bind:this={scroller} onscroll={onScroll}>
	<div class="column" class:compact bind:this={column} style="min-height: {layout.height + 24}px; --h: {branchHue(branch.id)}">
		<Rail {layout} width={railWidth} chipX={compact ? 40 : railWidth + 28} {compact} branches={tree.branches} {cursorId} open={openDot} />

		<header class="head">
			<div class="eyebrow">
				<i></i>
				{#if parent}
					Branched from <button class="link" onclick={() => open(parent.id, forkNode ?? null)}>{parent.title}</button>
				{:else}
					Root thread
				{/if}
				<span class="sep">·</span>{own} message{own === 1 ? "" : "s"} of its own
				{#if branch.costUsd > 0}<span class="sep">·</span>${branch.costUsd.toFixed(4)}{/if}
			</div>
			<h1>{branch.title}</h1>
		</header>

		{#if entries.length === 0 && !branch.busy}
			<p class="empty">An empty thread. Write below, then branch from any message to try another direction while this one keeps going.</p>
		{/if}

		{#each entries as entry (entry.id)}
			<Entry
				{entry}
				{results}
				hue={branchHue(entry.conversationId)}
				cursor={entry.id === cursorId}
				focused={entry.id === focusId}
				actions={index.byId.has(entry.id)}
				notes={tree.notes}
				branch={() => branchAfter(entry.id)}
				editBranch={index.byId.get(entry.id)?.before !== undefined ? () => editBranch(index.byId.get(entry.id)!) : undefined}
				share={() => share(entry.id)}
				{unshare}
				select={() => (cursorId = entry.id)}
			/>
			{#if forks.has(entry.id)}
				<Switcher at={entry.id} options={forks.get(entry.id)!} {pick} />
			{/if}
		{/each}

		{#if branch.busy}
			<div class="live">
				<div class="who" data-row="-1" data-kind="live" data-conv={branch.id}>writing{live?.generation?.retry ? " · retrying" : ""}</div>
				{#if partial !== ""}<div class="prose">{@html renderMarkdown(partial)}</div>{/if}
				{#each runningTools as tool (tool.callId)}
					<div class="tool-running"><code>{tool.name}</code> running…{#if tool.output}<pre>{tool.output.slice(-1500)}</pre>{/if}</div>
				{/each}
				{#if live?.generation?.retry}<div class="retry">{live.generation.retry.error}</div>{/if}
				{#if partial === ""}<div class="typing" aria-label="Working"><span></span><span></span><span></span></div>{/if}
			</div>
		{/if}
		<div style="height: {slack}px" aria-hidden="true"></div>
	</div>
</div>

<style>
	.scroller {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overflow-x: hidden;
		scroll-behavior: smooth;
		/* Text fades into the composer instead of being cut by it. */
		mask-image: linear-gradient(to bottom, #000 calc(100% - 28px), transparent);
	}
	.column {
		position: relative;
		max-width: var(--measure);
		margin: 0 auto 0 var(--col-left);
		padding: 0 28px 48px;
		box-sizing: content-box;
	}
	.column.compact {
		padding: 0 16px 40px 40px;
	}
	.column.compact :global(.rail) {
		left: 0;
	}
	.column:not(.compact) :global(.rail) {
		right: 100%;
	}
	.head {
		padding: 44px 0 6px;
	}
	.eyebrow {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
		font: 500 12px var(--sans);
		color: var(--text-3);
	}
	.eyebrow i {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: hsl(var(--h) var(--lane-s) var(--lane-l));
	}
	.sep {
		opacity: 0.6;
	}
	.link {
		background: none;
		border: none;
		padding: 0;
		font: inherit;
		color: var(--text-2);
		text-decoration: underline;
		text-decoration-color: var(--border-strong);
		text-underline-offset: 3px;
		cursor: pointer;
	}
	.link:hover {
		color: var(--text);
	}
	h1 {
		margin: 8px 0 0;
		font: 650 30px/1.15 var(--sans);
		letter-spacing: -0.025em;
		color: var(--text);
		overflow-wrap: anywhere;
	}
	.empty {
		margin: 40px 0;
		font: 17px/1.6 var(--serif);
		color: var(--text-2);
	}
	.live {
		padding: 18px 0 6px;
	}
	.who {
		font: 500 11px/16px var(--mono);
		color: var(--text-3);
		margin-bottom: 6px;
	}
	.prose {
		font: 400 17.5px/1.68 var(--serif);
		color: var(--text);
	}
	.prose :global(p) {
		margin: 0 0 0.8em;
	}
	.tool-running {
		font: 13px var(--sans);
		color: var(--text-2);
	}
	.tool-running code {
		font: 12px var(--mono);
	}
	.tool-running pre {
		font: 12px/1.5 var(--mono);
		max-height: 160px;
		overflow: auto;
		background: var(--surface-2);
		padding: 8px;
		border-radius: 8px;
	}
	.retry {
		color: var(--text-3);
		font: 12px var(--sans);
	}
	.typing {
		display: flex;
		gap: 5px;
		padding: 8px 0;
	}
	.typing span {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: hsl(var(--h) var(--lane-s) var(--lane-l));
		animation: bounce 1.2s ease-in-out infinite;
	}
	.typing span:nth-child(2) {
		animation-delay: 0.15s;
	}
	.typing span:nth-child(3) {
		animation-delay: 0.3s;
	}
	@keyframes bounce {
		0%,
		60%,
		100% {
			opacity: 0.25;
			transform: none;
		}
		30% {
			opacity: 1;
			transform: translateY(-3px);
		}
	}
	@media (max-width: 640px) {
		.head {
			padding-top: 24px;
		}
		h1 {
			font-size: 24px;
		}
	}
</style>
