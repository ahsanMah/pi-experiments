<script lang="ts">
	// The overview canvas, after Open WebUI's chat Overview: an @xyflow/svelte flow of the
	// message tree with vertical/horizontal layouts and a pinnable viewport. Here it spans
	// every branch, so it doubles as the branch switcher.
	import {
		Background,
		BackgroundVariant,
		ControlButton,
		Controls,
		MiniMap,
		SvelteFlow,
		useSvelteFlow,
		type Edge,
		type Node,
	} from "@xyflow/svelte";
	import "@xyflow/svelte/dist/style.css";
	import { untrack } from "svelte";
	import type { TreeIndex, TreeNode } from "../../../shared/protocol.ts";
	import { branchHue, layoutTree, NODE_HEIGHT, NODE_WIDTH, pathTo, type Direction } from "../lib/layout.ts";
	import NodeCard, { type NodeCardData } from "./NodeCard.svelte";

	type Props = {
		tree: TreeIndex;
		activeId: number | undefined;
		/** Entry the chat is focused on; the viewport follows it unless pinned. */
		focusId: number | null;
		dark: boolean;
		open: (node: TreeNode) => void;
		branch: (node: TreeNode) => void;
		editBranch: (node: TreeNode) => void;
		share: (node: TreeNode) => void;
	};
	let { tree, activeId, focusId, dark, open, branch, editBranch, share }: Props = $props();

	let direction = $state<Direction>("vertical");
	let pinned = $state(false);
	let nodes = $state.raw<Node<NodeCardData>[]>([]);
	let edges = $state.raw<Edge[]>([]);
	const { setCenter, fitView } = useSvelteFlow();
	const nodeTypes = { card: NodeCard };

	const activeBranch = $derived(tree.branches.find((b) => b.id === activeId));
	const activePath = $derived(pathTo(tree.nodes, focusId ?? activeBranch?.tip ?? null));

	$effect(() => {
		const titles = new Map(tree.branches.map((b) => [b.id, b.title]));
		const busyTips = new Set(tree.branches.filter((b) => b.busy && b.tip !== null).map((b) => b.tip!));
		const byId = new Map(tree.nodes.map((n) => [n.id, n]));
		const placed = layoutTree(tree.nodes, direction);
		// Keep the selection (and its toolbar) across rebuilds; untracked so this effect never feeds itself.
		const selectedIds = new Set(untrack(() => nodes).filter((n) => n.selected).map((n) => n.id));
		nodes = placed.map(({ node, x, y }) => {
			const parent = node.parentId === null ? undefined : byId.get(node.parentId);
			const startsBranch = parent === undefined ? tree.branches.length > 1 : parent.conversationId !== node.conversationId;
			return {
				id: String(node.id),
				type: "card",
				position: { x, y },
				width: NODE_WIDTH,
				height: NODE_HEIGHT,
				selected: selectedIds.has(String(node.id)),
				data: {
					node,
					hue: branchHue(node.conversationId),
					...(startsBranch ? { branchStart: titles.get(node.conversationId) ?? "" } : {}),
					onPath: activePath.has(node.id),
					current: node.id === focusId,
					busy: busyTips.has(node.id),
					direction,
					open,
					branch,
					editBranch,
					share,
				},
			};
		});
		edges = tree.nodes
			.filter((node) => node.parentId !== null && byId.has(node.parentId))
			.map((node) => {
				const onPath = activePath.has(node.id) && activePath.has(node.parentId!);
				return {
					id: `${node.parentId}-${node.id}`,
					source: String(node.parentId),
					target: String(node.id),
					type: "smoothstep",
					animated: busyTips.has(node.id),
					style: `stroke: hsl(${branchHue(node.conversationId)} 60% 55%); stroke-width: ${onPath ? 2.5 : 1.25}; opacity: ${onPath ? 1 : 0.6}`,
				};
			});
	});

	// Follow the focused node, as Open WebUI's Overview follows the current message.
	let lastFocus: number | null = null;
	$effect(() => {
		const target = focusId ?? activeBranch?.tip ?? null;
		if (pinned || target === null || target === lastFocus) return;
		const node = nodes.find((n) => n.id === String(target));
		if (node === undefined) return;
		lastFocus = target;
		void setCenter(node.position.x + NODE_WIDTH / 2, node.position.y + NODE_HEIGHT / 2, { duration: 300, zoom: 0.9 });
	});

	const relayout = (next: Direction) => {
		direction = next;
		lastFocus = null;
		setTimeout(() => void fitView({ duration: 300 }), 0);
	};
</script>

<SvelteFlow
	bind:nodes
	bind:edges
	{nodeTypes}
	fitView
	minZoom={0.05}
	maxZoom={1.5}
	colorMode={dark ? "dark" : "light"}
	nodesConnectable={false}
	nodesDraggable={false}
	onlyRenderVisibleElements
	onnodeclick={({ node }) => open((node.data as NodeCardData).node)}
	proOptions={{ hideAttribution: true }}
>
	<Controls showLock={false}>
		<ControlButton onclick={() => (pinned = !pinned)} title={pinned ? "Viewport pinned" : "Viewport follows the chat"}>
			{pinned ? "📌" : "◎"}
		</ControlButton>
		<ControlButton onclick={() => relayout("vertical")} title="Vertical layout">↧</ControlButton>
		<ControlButton onclick={() => relayout("horizontal")} title="Horizontal layout">↦</ControlButton>
	</Controls>
	<MiniMap pannable zoomable nodeColor={(n) => `hsl(${(n.data as NodeCardData).hue} 60% 55%)`} />
	<Background variant={BackgroundVariant.Dots} />
</SvelteFlow>
