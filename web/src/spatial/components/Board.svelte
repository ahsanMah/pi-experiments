<script lang="ts">
	// The infinite canvas. Branch cards and stickies are xyflow nodes laid out by geometry.ts
	// (or where the viewer dragged them); fork and note wires are its edges. Zoom picks how much
	// each card shows, and the cards in view at reading zoom get live views from the server.
	import { Background, BackgroundVariant, MiniMap, SvelteFlow, useSvelteFlow, useViewport, type Edge, type Node } from "@xyflow/svelte";
	import "@xyflow/svelte/dist/style.css";
	import { tick, untrack } from "svelte";
	import { branchHue } from "../../lib/layout.ts";
	import { buildCards, CARD_W, layoutCards, layoutNotes, STICKY_H, STICKY_W, type Point } from "../lib/geometry.ts";
	import { useSpace } from "../lib/space.svelte.ts";
	import BranchCard, { type BranchCardData } from "./BranchCard.svelte";
	import StickyNote, { type StickyData } from "./StickyNote.svelte";
	import Wire, { type WireData } from "./Wire.svelte";

	let { dark, minimap }: { dark: boolean; minimap: boolean } = $props();
	const space = useSpace();
	const client = space.client;
	const flow = useSvelteFlow();
	const viewport = useViewport();

	const nodeTypes = { card: BranchCard, sticky: StickyNote };
	const edgeTypes = { wire: Wire };
	const FAR = 0.45;
	const NEAR = 0.95;

	let nodes = $state.raw<Node[]>([]);
	let edges = $state.raw<Edge[]>([]);
	let width = $state(0);
	let height = $state(0);
	/** Bumped to put nodes back where the layout says (after a sticky is dropped on a card). */
	let relayout = $state(0);

	const zoom = $derived(viewport.current.zoom);
	$effect(() => {
		space.zoom = zoom;
	});
	const tier = $derived(zoom < FAR ? "far" : zoom >= NEAR ? "near" : "mid");
	const built = $derived(buildCards(client.tree));
	const auto = $derived(layoutCards(client.tree, built.cards, built.links));
	// Drafts rebuild nodes only when they appear, move or go, not on every keystroke.
	const draftKey = $derived(space.stickies.map((s) => `${s.id}:${s.x}:${s.y}`).join("|"));

	$effect(() => {
		void relayout;
		void draftKey;
		const tree = client.tree;
		const { cards, links } = built;
		const previous = untrack(() => nodes);
		// Never yank a node out from under the pointer, and keep the selection across rebuilds.
		const held = new Map(previous.filter((n) => n.dragging).map((n) => [n.id, n.position]));
		const selected = new Set(previous.filter((n) => n.selected).map((n) => n.id));
		const at = (key: string, fallback: Point): Point => held.get(key) ?? space.positions[key] ?? fallback;

		const cardPos = new Map<number, Point>();
		const next: Node[] = [];
		for (const branch of tree.branches) {
			const model = cards.get(branch.id)!;
			const key = `b${branch.id}`;
			const position = at(key, auto.get(branch.id) ?? { x: 0, y: 0 });
			cardPos.set(branch.id, position);
			next.push({
				id: key,
				type: "card",
				position,
				width: CARD_W,
				height: model.height,
				dragHandle: ".grip",
				deletable: false,
				selected: selected.has(key),
				data: { model, hue: branchHue(branch.id) } satisfies BranchCardData,
			});
		}
		// Placeholders for shares in flight queue up in the lane after the real stickies.
		const lane = layoutNotes(
			[
				...tree.notes.map((note) => ({ id: `n${note.id}`, ...(note.from ? { from: note.from.conversationId } : {}) })),
				...space.pending.map((pending) => ({ id: pending.id, ...(pending.from !== undefined ? { from: pending.from } : {}) })),
			],
			cardPos,
		);
		const hueOf = (id: number | undefined) => (id === undefined || !cardPos.has(id) ? null : branchHue(id));
		for (const note of tree.notes) {
			const key = `n${note.id}`;
			next.push({
				id: key,
				type: "sticky",
				position: at(key, lane.get(key)!),
				width: STICKY_W,
				height: STICKY_H,
				deletable: false,
				selected: selected.has(key),
				zIndex: 5,
				data: { kind: "note", note, hue: hueOf(note.from?.conversationId) } satisfies StickyData,
			});
		}
		for (const pending of space.pending) {
			next.push({
				id: pending.id,
				type: "sticky",
				position: lane.get(pending.id)!,
				width: STICKY_W,
				height: STICKY_H,
				draggable: false,
				deletable: false,
				zIndex: 6,
				data: { kind: "pending", pending, hue: hueOf(pending.from) } satisfies StickyData,
			});
		}
		for (const sticky of untrack(() => space.stickies)) {
			next.push({
				id: sticky.id,
				type: "sticky",
				position: held.get(sticky.id) ?? { x: sticky.x, y: sticky.y },
				width: STICKY_W,
				height: STICKY_H,
				deletable: false,
				zIndex: 7,
				data: { kind: "draft", id: sticky.id } satisfies StickyData,
			});
		}
		nodes = next;

		const wires: Edge[] = [];
		const fresh = space.fresh;
		const busy = new Set(tree.branches.filter((b) => b.busy).map((b) => b.id));
		for (const link of links) {
			const source = cards.get(link.source);
			if (source === undefined || !cards.has(link.child)) continue;
			wires.push({
				id: `f${link.child}`,
				type: "wire",
				source: `b${link.source}`,
				sourceHandle: link.at !== null && source.ports.has(link.at) ? `p-${link.at}` : "tail",
				target: `b${link.child}`,
				targetHandle: "in",
				selectable: false,
				deletable: false,
				focusable: false,
				data: { kind: "fork", hue: branchHue(link.child), busy: busy.has(link.child), fresh: fresh.includes(link.child) } satisfies WireData,
			});
		}
		for (const note of tree.notes) {
			const targets = note.to === "*" ? tree.branches.map((b) => b.id) : note.to;
			for (const target of targets) {
				if (!cards.has(target)) continue;
				wires.push({
					id: `n${note.id}>${target}`,
					type: "wire",
					source: `n${note.id}`,
					sourceHandle: "out",
					target: `b${target}`,
					targetHandle: "note-in",
					selectable: false,
					focusable: false,
					zIndex: 4,
					data: { kind: "note", hue: 0, noteId: note.id, quiet: note.to === "*" } satisfies WireData,
				});
			}
			if (note.from !== undefined && cards.has(note.from.conversationId)) {
				wires.push({
					id: `s${note.id}`,
					type: "wire",
					source: `b${note.from.conversationId}`,
					sourceHandle: "note-src",
					target: `n${note.id}`,
					targetHandle: "in",
					selectable: false,
					focusable: false,
					data: { kind: "source", hue: 0, noteId: note.id } satisfies WireData,
				});
			}
		}
		edges = wires;
	});

	// Fit once the seeded tree arrives.
	let fitted = false;
	$effect(() => {
		if (fitted || nodes.length === 0 || width === 0) return;
		fitted = true;
		void tick().then(() => setTimeout(() => void flow.fitView({ padding: padding(), maxZoom: 0.9 }), 30));
	});

	// Live views: the focused branch, working branches, the current card, and cards in view at
	// reading zoom. Recently watched ones linger (up to a cap) so cards don't flicker back to previews.
	const CAP = 8;
	let watched: number[] = [];
	const visible = $derived.by(() => {
		if (tier !== "near" || width === 0) return [] as number[];
		const { x, y, zoom: z } = viewport.current;
		const left = -x / z;
		const top = -y / z;
		const right = left + width / z;
		const bottom = top + height / z;
		return nodes
			.filter((n) => n.type === "card" && n.position.x < right && n.position.x + CARD_W > left && n.position.y < bottom && n.position.y + (n.height ?? 0) > top)
			.map((n) => Number(n.id.slice(1)))
			.slice(0, 6);
	});
	const wanted = $derived.by(() => {
		const ids = new Set<number>();
		if (space.focusId !== null) ids.add(space.focusId);
		if (space.currentId !== null) ids.add(space.currentId);
		for (const branch of client.tree.branches) if (branch.busy) ids.add(branch.id);
		for (const id of visible) ids.add(id);
		return [...ids].join(",");
	});
	$effect(() => {
		const now = wanted === "" ? [] : wanted.split(",").map(Number);
		const exists = new Set(client.tree.branches.map((b) => b.id));
		watched = [...new Set([...now, ...watched])].filter((id) => exists.has(id)).slice(0, Math.max(CAP, now.length));
		client.watch(watched);
	});

	// Room for the floating HUD (top), the toolbar (bottom) and the focus panel (right).
	const px = (n: number) => `${n}px` as const;
	const padding = () =>
		width < 700 ? { top: px(70), bottom: px(80), left: px(16), right: px(16) } : { top: px(84), bottom: px(96), left: px(56), right: px(56 + space.inset) };

	const cardNode = (id: number) => nodes.find((n) => n.id === `b${id}`);

	space.camera = {
		reveal: (id, options) => {
			const node = cardNode(id);
			if (node === undefined || width === 0) return;
			// Center in the part of the canvas the focus panel leaves visible.
			const visibleWidth = Math.max(width - space.inset, width * 0.35);
			const h = node.height ?? 400;
			const fitZoom = Math.min((visibleWidth - 64) / CARD_W, (height - 120) / h);
			const z = options?.zoom === false ? zoom : Math.min(Math.max(zoom, Math.min(0.85, fitZoom)), Math.max(fitZoom, 0.5), 1.1);
			const cx = node.position.x + CARD_W / 2;
			const cy = node.position.y + Math.min(h, (height - 120) / z) / 2;
			void flow.setViewport({ x: visibleWidth / 2 - cx * z, y: height / 2 + 20 - cy * z, zoom: z }, { duration: 450 });
		},
		fit: () => void flow.fitView({ padding: padding(), duration: 450, maxZoom: 1 }),
		zoomBy: (factor) => void flow.setZoom(zoom * factor, { duration: 200 }),
		zoomTo: (z) => void flow.setZoom(z, { duration: 250 }),
		center: () => flow.screenToFlowPosition({ x: (width - space.inset) / 2 + wrapper!.getBoundingClientRect().left, y: height / 2 + wrapper!.getBoundingClientRect().top }),
	};

	let wrapper = $state<HTMLDivElement>();

	const cardAt = (x: number, y: number, except?: number): number | null => {
		for (const element of document.elementsFromPoint(x, y)) {
			const card = (element as HTMLElement).closest?.("[data-card-id]");
			if (card instanceof HTMLElement) {
				const id = Number(card.dataset.cardId);
				if (id !== except) return id;
			}
		}
		return null;
	};
	const pointOf = (event: MouseEvent | TouchEvent) => {
		const touch = "changedTouches" in event ? event.changedTouches[0] : undefined;
		return touch ? { x: touch.clientX, y: touch.clientY } : { x: (event as MouseEvent).clientX, y: (event as MouseEvent).clientY };
	};

	const onDrag = ({ targetNode, event }: { targetNode: Node | null; event: MouseEvent | TouchEvent }) => {
		if (targetNode?.type !== "sticky") return;
		const { x, y } = pointOf(event);
		space.dropTarget = cardAt(x, y);
	};

	const onDragStop = ({ targetNode, event }: { targetNode: Node | null; event: MouseEvent | TouchEvent }) => {
		const target = space.dropTarget;
		space.dropTarget = null;
		if (targetNode === null) return;
		if (targetNode.type === "card") {
			space.place(targetNode.id, targetNode.position);
			return;
		}
		const data = targetNode.data as StickyData;
		const { x, y } = pointOf(event);
		const card = target ?? cardAt(x, y);
		if (data.kind === "draft") {
			if (card === null) {
				space.updateSticky(data.id, targetNode.position);
				return;
			}
			// Shared, it joins the sticky lane above the cards, wired to the card it was dropped on.
			void space.publishSticky(data.id, [card], false);
		} else if (data.kind === "note") {
			if (card === null) {
				space.place(targetNode.id, targetNode.position);
				return;
			}
			relayout++;
			void space.shareNoteWith(data.note, card);
		}
	};

	// Drag a card's knob onto another card to share into it; the sheet asks summary, transcript or note.
	let wire = $state<{ from: number; x1: number; y1: number; x2: number; y2: number } | null>(null);
	const onPointerDown = (event: PointerEvent) => {
		const knob = (event.target as HTMLElement).closest<HTMLElement>("[data-knob]");
		if (knob === null || event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		const from = Number(knob.dataset.knob);
		const box = knob.getBoundingClientRect();
		const start = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
		let moved = false;
		const move = (e: PointerEvent) => {
			if (!moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6) return;
			moved = true;
			wire = { from, x1: start.x, y1: start.y, x2: e.clientX, y2: e.clientY };
			space.dropTarget = cardAt(e.clientX, e.clientY, from);
		};
		const up = () => {
			removeEventListener("pointermove", move);
			removeEventListener("pointerup", up);
			const target = space.dropTarget;
			space.dropTarget = null;
			wire = null;
			if (!moved) {
				space.sheet = { from: { conversationId: from } };
				return;
			}
			space.sheet = { from: { conversationId: from }, ...(target !== null ? { to: [target] } : {}) };
		};
		addEventListener("pointermove", move);
		addEventListener("pointerup", up);
	};

	const onDblClick = (event: MouseEvent) => {
		if (!(event.target as HTMLElement).classList.contains("svelte-flow__pane")) return;
		space.newSticky(flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
	};
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="board tier-{tier}"
	style="--z: {zoom}"
	bind:this={wrapper}
	bind:clientWidth={width}
	bind:clientHeight={height}
	onpointerdowncapture={onPointerDown}
	ondblclick={onDblClick}
>
	<SvelteFlow
		bind:nodes
		bind:edges
		{nodeTypes}
		{edgeTypes}
		minZoom={0.12}
		maxZoom={1.8}
		colorMode={dark ? "dark" : "light"}
		nodesConnectable={false}
		zoomOnDoubleClick={false}
		panOnScroll
		nodeDragThreshold={4}
		onnodedrag={onDrag}
		onnodedragstop={onDragStop}
		onnodeclick={({ node }) => {
			if (node.type === "card") space.currentId = Number(node.id.slice(1));
		}}
		onpaneclick={() => {
			space.currentId = null;
			space.hotNote = null;
		}}
		proOptions={{ hideAttribution: true }}
	>
		<Background variant={BackgroundVariant.Dots} gap={24} size={1.6} bgColor="var(--canvas)" patternColor="var(--grid)" />
		{#if minimap}
			<MiniMap
				pannable
				zoomable
				position="bottom-right"
				width={176}
				height={118}
				bgColor="var(--canvas)"
				maskColor="var(--minimap-mask)"
				maskStrokeColor="var(--ink-faint)"
				maskStrokeWidth={1}
				nodeBorderRadius={18}
				nodeColor={(n) => (n.type === "card" ? `hsl(${(n.data as BranchCardData).hue} 60% 58%)` : "var(--sticky)")}
			/>
		{/if}
	</SvelteFlow>
	{#if wire}
		<svg class="wire-overlay" aria-hidden="true">
			<path d="M {wire.x1} {wire.y1} C {wire.x1 + 80} {wire.y1}, {wire.x2 - 80} {wire.y2}, {wire.x2} {wire.y2}" />
			<circle cx={wire.x2} cy={wire.y2} r="6" />
		</svg>
	{/if}
</div>

<style>
	.board {
		position: absolute;
		inset: 0;
	}
	.wire-overlay {
		position: fixed;
		inset: 0;
		width: 100vw;
		height: 100vh;
		pointer-events: none;
		z-index: 30;
	}
	.wire-overlay path {
		fill: none;
		stroke: var(--sticky-ink);
		stroke-width: 2.5;
		stroke-dasharray: 6 6;
		animation: march 0.6s linear infinite;
	}
	.wire-overlay circle {
		fill: var(--sticky);
		stroke: var(--sticky-ink);
		stroke-width: 2;
	}
	@keyframes march {
		to {
			stroke-dashoffset: -12;
		}
	}
</style>
