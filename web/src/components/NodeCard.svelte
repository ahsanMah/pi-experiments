<script lang="ts" module>
	import type { TreeNode } from "../../../shared/protocol.ts";

	export type NodeCardData = {
		node: TreeNode;
		hue: number;
		/** Set on the first node of a branch: its title. */
		branchStart?: string;
		/** On the active branch's path from the root. */
		onPath: boolean;
		/** The node the chat is showing. */
		current: boolean;
		/** Tip of a branch that is working. */
		busy: boolean;
		direction: "vertical" | "horizontal";
		open: (node: TreeNode) => void;
		branch: (node: TreeNode) => void;
		editBranch: (node: TreeNode) => void;
		share: (node: TreeNode) => void;
	};
</script>

<script lang="ts">
	import { Handle, NodeToolbar, Position, type NodeProps } from "@xyflow/svelte";

	let { data, selected }: NodeProps & { data: NodeCardData } = $props();

	const label = $derived(
		data.node.role === "user"
			? "You"
			: data.node.role === "assistant"
				? (data.node.model?.split("/").pop() ?? "Assistant")
				: data.node.role === "shared"
					? "Shared context"
					: data.node.role === "compaction"
						? "Compaction"
						: "Reset",
	);
</script>

<Handle type="target" position={data.direction === "vertical" ? Position.Top : Position.Left} isConnectable={false} />

<NodeToolbar isVisible={selected} position={data.direction === "vertical" ? Position.Bottom : Position.Right}>
	<div class="toolbar">
		<button onclick={() => data.open(data.node)}>Open</button>
		<button onclick={() => data.branch(data.node)} title="New branch continuing after this message">Branch</button>
		{#if data.node.role === "user" && data.node.before !== undefined}
			<button onclick={() => data.editBranch(data.node)} title="Branch before this message and edit it">Edit &amp; branch</button>
		{/if}
		<button onclick={() => data.share(data.node)} title="Share this branch up to here with other branches">Share…</button>
	</div>
</NodeToolbar>

<div
	class="card {data.node.role}"
	class:on-path={data.onPath}
	class:current={data.current}
	style="--hue: {data.hue}"
	title={data.node.preview}
>
	{#if data.branchStart !== undefined}
		<div class="branch-chip">{data.branchStart}</div>
	{/if}
	<div class="head">
		<span class="who">{label}</span>
		{#if data.node.toolCalls}
			<span class="badge" title="Tool calls in this turn">⚙ {data.node.toolCalls}</span>
		{/if}
		{#if data.busy}
			<span class="busy" title="Working"></span>
		{/if}
	</div>
	<div class="preview">{data.node.preview || "…"}</div>
</div>

<Handle type="source" position={data.direction === "vertical" ? Position.Bottom : Position.Right} isConnectable={false} />

<style>
	.card {
		box-sizing: border-box;
		width: 240px;
		height: 76px;
		padding: 8px 12px;
		border-radius: 12px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-left: 4px solid hsl(var(--hue) 65% 55%);
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.08);
		position: relative;
		cursor: pointer;
		opacity: 0.72;
	}
	.card.on-path {
		opacity: 1;
	}
	.card.current {
		outline: 2px solid hsl(var(--hue) 70% 55%);
		outline-offset: 2px;
	}
	.card.shared,
	.card.compaction,
	.card.reset {
		background: var(--surface-muted);
		border-style: dashed;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
		font-weight: 600;
		color: var(--text);
	}
	.who {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.user .who {
		color: hsl(var(--hue) 60% 45%);
	}
	.badge {
		font-weight: 500;
		color: var(--text-muted);
	}
	.preview {
		margin-top: 3px;
		font-size: 11px;
		line-height: 1.35;
		color: var(--text-muted);
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.branch-chip {
		position: absolute;
		top: -11px;
		left: 10px;
		max-width: 200px;
		padding: 1px 8px;
		border-radius: 999px;
		font-size: 10px;
		font-weight: 600;
		color: white;
		background: hsl(var(--hue) 60% 48%);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.busy {
		margin-left: auto;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: hsl(var(--hue) 70% 50%);
		animation: pulse 1s ease-in-out infinite;
	}
	@keyframes pulse {
		50% {
			opacity: 0.25;
			transform: scale(0.7);
		}
	}
	.toolbar {
		display: flex;
		gap: 4px;
		padding: 4px;
		border-radius: 8px;
		background: var(--surface);
		border: 1px solid var(--border);
		box-shadow: 0 4px 12px rgb(0 0 0 / 0.12);
	}
	.toolbar button {
		font-size: 11px;
		padding: 3px 8px;
	}
</style>
