<script lang="ts">
	import type { BranchInfo } from "../../../../shared/protocol.ts";
	import { branchHue } from "../../../src/lib/layout.ts";
	import type { Dot, Label, RailLayout } from "../lib/rail.ts";

	type Props = {
		layout: RailLayout;
		width: number;
		/** Where the switcher chips start, to tie each junction to its chip. */
		chipX: number;
		compact: boolean;
		branches: readonly BranchInfo[];
		cursorId: number | null;
		/** A dot was clicked: jump to it (same branch) or open the branch it belongs to. */
		open: (dot: Dot) => void;
	};
	let { layout, width, chipX, compact, branches, cursorId, open }: Props = $props();

	let hovered = $state<Dot | undefined>();
	const titles = $derived(new Map(branches.map((branch) => [branch.id, branch.title])));
	const roleLabel = (dot: Dot) =>
		dot.kind === "live"
			? "Writing…"
			: dot.kind === "ghost"
				? "New branch, nothing sent yet"
				: dot.kind === "user"
					? "You"
					: dot.kind === "assistant"
						? (dot.node?.model ?? "Assistant")
						: dot.kind === "shared"
							? "Shared context arrived"
							: "Marker";
	const radius = (dot: Dot) => {
		if (!dot.active) return dot.kind === "ghost" || dot.tip ? 3.6 : 2.6;
		if (dot.kind === "shared") return 5.5;
		return dot.node?.id === cursorId ? 5.5 : dot.kind === "user" ? 4.5 : 3.8;
	};
	const showPreview = (dot: Dot) => (hovered = dot);
	// The layout is rebuilt as the tree changes; follow the hovered dot by key, and drop it once it is gone.
	const card = $derived(hovered === undefined ? undefined : layout.dots.find((dot) => dot.key === hovered!.key));
	// Dotted leader from a name in the label column to its tip, bending at 45° when the name was pushed down.
	const leader = (label: Label) => {
		const end = label.x - 7;
		const dy = label.ly - label.y;
		const bend = Math.max(label.right + 6, end - dy);
		return dy === 0 ? `M${label.right + 4} ${label.ly}H${end}` : `M${label.right + 4} ${label.ly}H${bend}L${end} ${label.y}`;
	};
</script>

<div class="rail" class:compact style="width: {width}px; height: {layout.height}px" aria-hidden={compact}>
	<svg width={width} height={layout.height} viewBox="0 0 {width} {layout.height}">
		{#each layout.segments as segment (segment.key)}
			<path
				class="seg"
				class:active={segment.active}
				class:ghost={segment.ghost}
				d={segment.d}
				pathLength="1"
				style="--h: {branchHue(segment.conv)}"
			/>
		{/each}
		{#if !compact}
			{#each layout.labels as label (label.key)}
				<path class="leader" d={leader(label)} style="--h: {branchHue(label.branches[0]!.id)}" />
			{/each}
		{/if}
		{#each layout.junctions as junction (junction.key)}
			<path class="tie" d="M{junction.x + 6} {junction.y}H{chipX - 6}" />
			<rect class="junction" x={junction.x - 4} y={junction.y - 4} width="8" height="8" rx="2" transform="rotate(45 {junction.x} {junction.y})" />
		{/each}
		{#each layout.dots as dot (dot.key)}
			<g class="dot {dot.kind}" class:active={dot.active} class:busy={dot.busy} class:cursor={dot.active && dot.node?.id === cursorId} style="--h: {branchHue(dot.conv)}">
				{#if dot.busy}<circle class="pulse" cx={dot.x} cy={dot.y} r={radius(dot) + 2} />{/if}
				{#if dot.kind === "shared" && dot.active}
					<circle class="station-ring" cx={dot.x} cy={dot.y} r={radius(dot)} />
					<circle class="station-core" cx={dot.x} cy={dot.y} r="2" />
				{:else}
					<circle class="mark" cx={dot.x} cy={dot.y} r={radius(dot)} />
				{/if}
				<!-- A larger invisible target, since the visible dots are tiny. -->
				<circle
					class="hit"
					cx={dot.x}
					cy={dot.y}
					r="9"
					role="button"
					tabindex="-1"
					aria-label={roleLabel(dot)}
					onpointerenter={() => showPreview(dot)}
					onpointerleave={() => hovered?.key === dot.key && (hovered = undefined)}
					onclick={() => {
						hovered = undefined;
						open(dot);
					}}
					onkeydown={(e) => e.key === "Enter" && open(dot)}
				/>
			</g>
		{/each}
	</svg>

	{#each layout.labels as label (label.key)}
		{@const branch = label.branches[0]!}
		<button
			class="tip"
			class:busy={label.busy}
			style="--h: {branchHue(branch.id)}; right: {width - label.right}px; top: {label.ly}px; max-width: {Math.max(label.right - 6, 40)}px"
			onclick={() => open({ key: label.key, x: label.x, y: label.y, conv: branch.id, kind: "ghost", active: false, open: branch.id, busy: label.busy })}
			title="Open {label.branches.map((b) => b.title).join(', ')}"
		>
			<span class="name">{branch.title}</span>
			{#if label.branches.length > 1}<span class="more">+{label.branches.length - 1}</span>{/if}
			{#if branch.queued > 0}<span class="more">{branch.queued} queued</span>{/if}
		</button>
	{/each}

	{#if card}
		{@const dot = card}
		{@const conv = dot.node?.conversationId ?? dot.conv}
		<div class="card" style="--h: {branchHue(conv)}; left: {Math.min(dot.x + 16, width - 40)}px; top: {dot.y}px" role="tooltip">
			<div class="card-head">
				<i></i><span class="card-branch">{titles.get(dot.open ?? conv) ?? `#${conv}`}</span>
				<span class="card-role">{roleLabel(dot)}</span>
			</div>
			{#if dot.node && dot.node.preview !== ""}<p>{dot.node.preview}</p>{/if}
			<div class="card-hint">{dot.active ? "Click to jump here" : "Click to open this branch here"}</div>
		</div>
	{/if}
</div>

<style>
	.rail {
		position: absolute;
		top: 0;
		pointer-events: none;
	}
	svg {
		display: block;
		overflow: visible;
	}
	.seg {
		fill: none;
		stroke: hsl(var(--h) var(--lane-s) var(--lane-l));
		stroke-width: 1.5;
		stroke-linecap: round;
		opacity: var(--lane-faded);
		stroke-dasharray: 1 1;
		stroke-dashoffset: 1;
		animation: draw 0.55s cubic-bezier(0.3, 0.7, 0.2, 1) forwards;
	}
	.seg.active {
		stroke-width: 2.5;
		opacity: 1;
		animation-duration: 0.35s;
	}
	.seg.ghost {
		stroke-dasharray: 2 3;
		stroke-dashoffset: 0;
		animation: fade 0.4s ease-out both;
	}
	@keyframes draw {
		to {
			stroke-dashoffset: 0;
		}
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
	.tie {
		stroke: var(--border-strong);
		stroke-width: 1;
		stroke-dasharray: 2 3;
		animation: fade 0.4s ease-out both;
	}
	.junction {
		fill: var(--bg);
		stroke: var(--text-2);
		stroke-width: 1.5;
		animation: fade 0.4s ease-out both;
	}
	.leader {
		fill: none;
		stroke: hsl(var(--h) var(--lane-s) var(--lane-l));
		stroke-width: 1;
		stroke-dasharray: 1 3;
		stroke-linecap: round;
		opacity: 0.55;
		animation: fade 0.5s 0.2s ease-out both;
	}
	.dot {
		pointer-events: auto;
		animation: fade 0.3s ease-out both;
	}
	.mark {
		fill: hsl(var(--h) var(--lane-s) var(--lane-l));
		stroke: var(--bg);
		stroke-width: 2;
		transition: r 0.15s;
	}
	.dot:not(.active) .mark {
		opacity: calc(var(--lane-faded) + 0.2);
		stroke-width: 1.5;
	}
	.dot.active.assistant .mark {
		fill: var(--bg);
		stroke: hsl(var(--h) var(--lane-s) var(--lane-l));
		stroke-width: 2;
	}
	.dot.ghost .mark {
		fill: var(--bg);
		stroke: hsl(var(--h) var(--lane-s) var(--lane-l));
		stroke-dasharray: 2 2;
		opacity: 0.9;
	}
	.dot.cursor .mark {
		stroke-width: 2.5;
	}
	.station-ring {
		fill: var(--bg);
		stroke: var(--text);
		stroke-width: 2;
	}
	.station-core {
		fill: var(--text);
	}
	.pulse {
		fill: hsl(var(--h) var(--lane-s) var(--lane-l));
		transform-box: fill-box;
		transform-origin: center;
		animation: ping 1.4s cubic-bezier(0, 0, 0.2, 1) infinite;
	}
	@keyframes ping {
		0% {
			opacity: 0.55;
			transform: scale(1);
		}
		100% {
			opacity: 0;
			transform: scale(2.6);
		}
	}
	.hit {
		fill: transparent;
		cursor: pointer;
		outline: none;
	}
	.tip {
		position: absolute;
		pointer-events: auto;
		transform: translateY(-50%);
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 2px 8px;
		box-sizing: border-box;
		font: 500 11.5px/16px var(--sans);
		color: hsl(var(--h) var(--lane-s) var(--lane-ink));
		background: var(--bg);
		border: 1px solid hsl(var(--h) var(--lane-s) var(--lane-l) / 0.35);
		border-radius: 999px;
		cursor: pointer;
		white-space: nowrap;
		animation: fade 0.5s 0.2s ease-out both;
	}
	.tip:hover {
		background: hsl(var(--h) var(--lane-s) var(--lane-l) / 0.12);
		border-color: hsl(var(--h) var(--lane-s) var(--lane-l) / 0.7);
	}
	.tip .name {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.tip .more {
		color: var(--text-3);
		font-size: 10.5px;
	}
	.tip.busy::after {
		content: "";
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: hsl(var(--h) var(--lane-s) var(--lane-l));
		animation: blink 1.1s ease-in-out infinite;
		flex: none;
	}
	@keyframes blink {
		50% {
			opacity: 0.2;
		}
	}
	.card {
		position: absolute;
		z-index: 20;
		width: 260px;
		transform: translateY(-14px);
		padding: 10px 12px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 10px;
		box-shadow: var(--shadow-lg);
		font: 13px/1.45 var(--sans);
		color: var(--text);
		pointer-events: none;
		animation: fade 0.12s ease-out both;
	}
	.card-head {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
	}
	.card-head i {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: hsl(var(--h) var(--lane-s) var(--lane-l));
		flex: none;
	}
	.card-branch {
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.card-role {
		margin-left: auto;
		color: var(--text-3);
		font: 11px var(--mono);
		white-space: nowrap;
	}
	.card p {
		margin: 6px 0 0;
		color: var(--text-2);
		display: -webkit-box;
		-webkit-line-clamp: 4;
		line-clamp: 4;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.card-hint {
		margin-top: 6px;
		font-size: 11px;
		color: var(--text-3);
	}
	.compact .tip {
		display: none;
	}
</style>
