<script lang="ts">
	import { branchHue } from "../../../src/lib/layout.ts";
	import type { Ordered } from "../lib.ts";
	import Icon from "./Icon.svelte";

	type Props = {
		ordered: readonly Ordered[];
		open: ReadonlySet<number>;
		activeId: number | undefined;
		/** Messages per branch (its own), for the hover title. */
		counts: ReadonlyMap<number, number>;
		show: (id: number) => void;
		hide: (id: number) => void;
		/** Phones draw the map top to bottom, as an indented list. */
		vertical?: boolean;
	};
	let { ordered, open, activeId, counts, show, hide, vertical = false }: Props = $props();

	// The map is the column strip in miniature: x follows tree order (the order columns take),
	// y is fork depth, and elbows connect each fork to the branch it came from.
	const CELL = 164;
	const CHIP = 26;
	const ROW = 42;
	const INDENT = 22;
	const LINE = 32;
	const deepest = $derived(Math.max(0, ...ordered.map((o) => o.depth)));
	const position = $derived(
		new Map(ordered.map((o) => [o.branch.id, vertical ? { x: o.depth * INDENT, y: o.index * LINE } : { x: o.index * CELL, y: o.depth * ROW }])),
	);
	const width = $derived(vertical ? deepest * INDENT + 240 : Math.max(1, ordered.length) * CELL - 8);
	const height = $derived(vertical ? Math.max(1, ordered.length) * LINE - (LINE - CHIP) : (deepest + 1) * ROW - (ROW - CHIP));
	const edges = $derived(
		ordered.flatMap(({ branch }) => {
			const from = branch.parent === undefined ? undefined : position.get(branch.parent.conversationId);
			const to = position.get(branch.id)!;
			if (from === undefined) return [];
			if (vertical) {
				// File-tree elbows: down the parent's left edge, then across into the child.
				const x = from.x + 11;
				const y = to.y + CHIP / 2;
				return [{ id: branch.id, d: `M${x} ${from.y + CHIP} V${y - 5} Q${x} ${y} ${x + 5} ${y} H${to.x}` }];
			}
			// Org-chart elbows: down from the parent, along a bus between rows, down into the child.
			const x = from.x + 14;
			const cx = to.x + 14;
			const bus = to.y - (ROW - CHIP) / 2;
			const r = Math.min(5, (cx - x) / 2);
			const d = cx === x ? `M${x} ${from.y + CHIP} V${to.y}` : `M${x} ${from.y + CHIP} V${bus - r} Q${x} ${bus} ${x + r} ${bus} H${cx - r} Q${cx} ${bus} ${cx} ${bus + r} V${to.y}`;
			return [{ id: branch.id, d }];
		}),
	);
</script>

<div class="map" class:vertical style="width: {width}px; height: {height}px">
	<svg {width} {height} aria-hidden="true">
		{#each edges as edge (edge.id)}
			<path d={edge.d} style="--hue: {branchHue(edge.id)}" class:dim={!open.has(edge.id)} />
		{/each}
	</svg>
	{#each ordered as { branch } (branch.id)}
		{@const p = position.get(branch.id)!}
		{@const isOpen = open.has(branch.id)}
		<div class="node" class:open={isOpen} class:active={branch.id === activeId} style="--hue: {branchHue(branch.id)}; left: {p.x}px; top: {p.y}px">
			<button
				class="chip"
				onclick={() => show(branch.id)}
				title="{branch.title}{branch.busy ? ' — working' : ''} · {counts.get(branch.id) ?? 0} messages{isOpen ? '' : ' · click to open as a column'}"
			>
				<span class="dot" class:busy={branch.busy}></span>
				<span class="name">{branch.title}</span>
				{#if branch.queued > 0}<span class="badge">+{branch.queued}</span>{/if}
			</button>
			{#if isOpen}
				<button class="hide" onclick={() => hide(branch.id)} title="Close this column" aria-label="Close {branch.title}"><Icon name="close" size={11} /></button>
			{/if}
		</div>
	{/each}
</div>

<style>
	.map {
		position: relative;
		flex: none;
	}
	svg {
		position: absolute;
		inset: 0;
		overflow: visible;
	}
	path {
		fill: none;
		stroke: hsl(var(--hue) var(--hue-s) var(--hue-l));
		stroke-width: 1.5;
		opacity: 0.7;
	}
	path.dim {
		opacity: 0.3;
		stroke-dasharray: 3 3;
	}
	.node {
		position: absolute;
		display: flex;
		align-items: center;
		width: 156px;
		height: 26px;
	}
	.vertical .node {
		width: 240px;
	}
	.chip {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		height: 100%;
		padding: 0 8px;
		font-size: 12px;
		border-radius: 8px;
		border: 1px dashed var(--border-strong);
		background: transparent;
		color: var(--text-muted);
	}
	.open .chip {
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text);
		box-shadow: 0 1px 1px rgb(0 0 0 / 0.04);
		padding-right: 24px;
	}
	.active .chip {
		border-color: var(--c);
		box-shadow: 0 0 0 2px var(--c-soft);
		font-weight: 600;
	}
	.chip:hover:not(:disabled) {
		border-color: var(--c);
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--c);
		flex: none;
	}
	:not(.open) > .chip .dot {
		background: transparent;
		box-shadow: inset 0 0 0 1.5px var(--c);
	}
	.dot.busy {
		animation: pulse 1s ease-in-out infinite;
	}
	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		text-align: left;
	}
	.badge {
		font: 10px var(--mono);
		color: var(--text-muted);
	}
	.hide {
		position: absolute;
		right: 3px;
		display: grid;
		place-items: center;
		width: 18px;
		height: 18px;
		padding: 0;
		border: none;
		border-radius: 5px;
		background: transparent;
		color: var(--text-faint);
		opacity: 0;
	}
	.node:hover .hide,
	.hide:focus-visible {
		opacity: 1;
	}
	.hide:hover {
		background: var(--surface-sunk);
		color: var(--text);
	}
	@media (hover: none) {
		.hide {
			opacity: 1;
		}
	}
</style>
