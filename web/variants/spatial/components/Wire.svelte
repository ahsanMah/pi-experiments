<script lang="ts" module>
	export type WireData = {
		kind: "fork" | "note" | "source";
		hue: number;
		/** The child branch is working: a spark travels down the fork. */
		busy?: boolean;
		/** Just created here: the edge draws itself in. */
		fresh?: boolean;
		noteId?: string;
		/** A note shared with every branch: only drawn while the note is hovered. */
		quiet?: boolean;
	};
</script>

<script lang="ts">
	// Edges: fork wires run from the exact parent message to the child card's header; note wires
	// are dashed connectors from a sticky to the branches that see it.
	import { getBezierPath, Position, type Edge, type EdgeProps } from "@xyflow/svelte";
	import { useSpace } from "../lib/space.svelte.ts";

	let { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data: given }: EdgeProps<Edge<WireData>> = $props();
	const data = $derived<WireData>(given ?? { kind: "note", hue: 0 });
	const space = useSpace();

	const path = $derived.by(() => {
		if (data.kind === "fork") {
			// A level S-curve: leave the port to the right, enter the child header from the left.
			const dx = Math.max(60, Math.abs(targetX - sourceX) * 0.5);
			return `M ${sourceX},${sourceY} C ${sourceX + dx},${sourceY} ${targetX - dx},${targetY} ${targetX},${targetY}`;
		}
		return getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition: sourcePosition ?? Position.Bottom, targetPosition: targetPosition ?? Position.Top, curvature: 0.35 })[0];
	});
	const hot = $derived(data.noteId !== undefined && space.hotNote === data.noteId);
	const color = $derived(data.kind === "fork" ? `hsl(${data.hue} 62% 55%)` : "var(--sticky-ink)");
</script>

{#if data.kind === "fork"}
	<path d={path} class="halo" />
	<path d={path} class="fork" class:fresh={data.fresh} stroke={color} pathLength="1" />
	<circle cx={sourceX} cy={sourceY} r="4.5" class="port" fill={color} />
	<circle cx={targetX} cy={targetY} r="3" fill={color} />
	{#if data.busy}
		<circle r="3.5" fill={color} class="spark">
			<animateMotion dur="1.6s" repeatCount="indefinite" path={path} />
		</circle>
	{/if}
{:else if !data.quiet || hot}
	<path d={path} class="note" class:hot class:source={data.kind === "source"} stroke={color} />
	{#if data.kind === "note"}<circle cx={targetX} cy={targetY} r={hot ? 4 : 3} fill={color} opacity={hot ? 1 : 0.6} />{/if}
{/if}

<style>
	path {
		fill: none;
	}
	.halo {
		stroke: var(--canvas);
		stroke-width: 7;
		opacity: 0.9;
	}
	.fork {
		stroke-width: 2.25;
		stroke-linecap: round;
	}
	.fork.fresh {
		stroke-dasharray: 1;
		animation: draw 0.9s cubic-bezier(0.3, 0.7, 0.2, 1) both;
	}
	@keyframes draw {
		from {
			stroke-dashoffset: 1;
		}
		to {
			stroke-dashoffset: 0;
		}
	}
	.port {
		stroke: var(--card);
		stroke-width: 2;
	}
	.spark {
		filter: drop-shadow(0 0 4px currentColor);
	}
	.note {
		stroke-width: 1.5;
		stroke-dasharray: 5 5;
		opacity: 0.45;
		transition: opacity 0.15s;
	}
	.note.source {
		stroke-dasharray: 1 5;
		stroke-linecap: round;
		stroke-width: 2;
		opacity: 0.35;
	}
	.note.hot {
		opacity: 1;
		stroke-width: 2;
		animation: march 0.8s linear infinite;
	}
	@keyframes march {
		to {
			stroke-dashoffset: -10;
		}
	}
</style>
