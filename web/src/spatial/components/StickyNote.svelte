<script lang="ts" module>
	import type { SharedNote } from "../../../../shared/protocol.ts";
	import type { PendingShare } from "../lib/space.svelte.ts";

	export type StickyData =
		| { kind: "note"; note: SharedNote; hue: number | null }
		| { kind: "draft"; id: string }
		| { kind: "pending"; pending: PendingShare; hue: number | null };
</script>

<script lang="ts">
	// Shared context as sticky notes. A shared note shows who sees it; a draft is a local sticky
	// you write and then drop onto a card (or share with everyone); a pending one is a share
	// the server is still producing, like a model-written summary.
	import { Handle, Position, type NodeProps } from "@xyflow/svelte";
	import { branchHue } from "../../lib/layout.ts";
	import { useSpace } from "../lib/space.svelte.ts";
	import Icon from "./Icon.svelte";

	let { data, selected }: NodeProps & { data: StickyData } = $props();
	const space = useSpace();

	const draft = $derived(data.kind === "draft" ? space.stickies.find((s) => s.id === data.id) : undefined);
	const targets = $derived(
		data.kind !== "note" || data.note.to === "*"
			? []
			: data.note.to.map((id) => space.branch(id)).filter((b): b is NonNullable<typeof b> => b !== undefined),
	);
	const source = $derived(data.kind === "note" && data.note.from ? space.branch(data.note.from.conversationId) : undefined);
	const kind = $derived(
		data.kind === "note"
			? data.note.author === "model"
				? "Posted by a model"
				: data.note.from
					? data.note.title.startsWith("Transcript")
						? "Transcript"
						: data.note.title.startsWith("Summary")
							? "Summary"
							: "Note"
					: "Note"
			: data.kind === "pending"
				? data.pending.mode === "summary"
					? "Summarizing"
					: "Sharing"
				: "Draft",
	);
	const hue = $derived(data.kind === "draft" ? null : data.hue);
	const hot = $derived(data.kind === "note" && (space.hotNote === data.note.id || selected));
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="sticky {data.kind}"
	class:hot
	class:model={data.kind === "note" && data.note.author === "model"}
	style={hue === null ? "" : `--tape: hsl(${hue} 65% 55%)`}
	onpointerenter={() => data.kind === "note" && (space.hotNote = data.note.id)}
	onpointerleave={() => data.kind === "note" && space.hotNote === data.note.id && (space.hotNote = null)}
	ondblclick={() => data.kind === "note" && (space.noteOpen = data.note.id)}
>
	<Handle type="target" id="in" position={Position.Bottom} isConnectable={false} />
	<Handle type="source" id="out" position={Position.Bottom} isConnectable={false} />
	<span class="tape"></span>

	{#if data.kind === "note"}
		<div class="kind">
			<Icon name={data.note.author === "model" ? "spark" : data.note.from ? "share" : "sticky"} size={11} />
			{kind}{#if source}<span class="from">· {source.title}</span>{/if}
			<button class="open nodrag" onclick={() => (space.noteOpen = data.note.id)} title="Open note" aria-label="Open note"><Icon name="expand" size={12} /></button>
		</div>
		<h3>{data.note.title}</h3>
		<p>{data.note.text}</p>
		<div class="to">
			{#if data.note.to === "*"}
				<span class="everyone"><Icon name="globe" size={11} />Every branch</span>
			{:else}
				{#each targets as branch (branch.id)}
					<span class="target" style="--hue: {branchHue(branch.id)}" title="Seen by {branch.title}"><i></i>{branch.title}</span>
				{/each}
			{/if}
		</div>
	{:else if data.kind === "draft" && draft}
		<div class="kind"><Icon name="sticky" size={11} />New sticky<button class="open nodrag" onclick={() => space.dropSticky(draft.id)} title="Discard" aria-label="Discard sticky"><Icon name="close" size={12} /></button></div>
		<input
			class="nodrag"
			value={draft.title}
			oninput={(e) => space.updateSticky(draft.id, { title: e.currentTarget.value })}
			placeholder="Title"
			aria-label="Sticky title"
		/>
		<!-- svelte-ignore a11y_autofocus -->
		<textarea
			class="nodrag nowheel"
			value={draft.text}
			oninput={(e) => space.updateSticky(draft.id, { text: e.currentTarget.value })}
			placeholder="What should the other branches know? Drag me onto a card to share."
			aria-label="Sticky text"
			autofocus
		></textarea>
		<div class="draft-actions">
			<span class="hint">Drag onto a card</span>
			<button class="nodrag" onclick={() => space.publishSticky(draft.id, "*")} title="Share with every branch, including future ones"><Icon name="globe" size={12} />All</button>
		</div>
	{:else if data.kind === "pending"}
		<div class="kind"><Icon name="spark" size={11} />{kind}…</div>
		<h3>{data.pending.title}</h3>
		<div class="shimmer"><i></i><i></i><i></i></div>
	{/if}
</div>

<style>
	.sticky {
		position: relative;
		box-sizing: border-box;
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: column;
		padding: 14px 14px 10px;
		border-radius: 4px 4px 14px 4px;
		background: var(--sticky);
		color: var(--sticky-text);
		box-shadow: var(--shadow-sticky);
		transform: rotate(-0.6deg);
		transition:
			transform 0.2s,
			box-shadow 0.2s;
		cursor: grab;
	}
	.sticky.model {
		background: var(--sticky-model);
	}
	.sticky.hot {
		transform: rotate(0deg) translateY(-2px);
		box-shadow: var(--shadow-lift);
	}
	:global(.svelte-flow__node.dragging) .sticky {
		transform: rotate(2.5deg) scale(1.04);
		box-shadow: var(--shadow-lift);
		cursor: grabbing;
	}
	.sticky.draft {
		background: var(--card);
		color: var(--ink);
		border: 1.5px dashed var(--sticky-ink);
		transform: none;
	}
	.sticky.pending {
		opacity: 0.85;
	}
	.tape {
		position: absolute;
		top: -7px;
		left: 50%;
		width: 64px;
		height: 14px;
		margin-left: -32px;
		border-radius: 2px;
		background: var(--tape, var(--sticky-ink));
		opacity: 0.55;
		transform: rotate(1.5deg);
	}
	.draft .tape {
		display: none;
	}
	.kind {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 10.5px;
		font-weight: 650;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--sticky-ink);
		white-space: nowrap;
		min-width: 0;
	}
	.from {
		overflow: hidden;
		text-overflow: ellipsis;
		text-transform: none;
		letter-spacing: 0;
		font-weight: 500;
	}
	.open {
		margin-left: auto;
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		border: none;
		border-radius: 6px;
		background: none;
		color: inherit;
		cursor: pointer;
		flex: none;
	}
	.open:hover {
		background: rgb(0 0 0 / 0.07);
	}
	h3 {
		margin: 6px 0 2px;
		font-size: 13.5px;
		line-height: 1.25;
		font-weight: 680;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	p {
		flex: 1;
		margin: 0;
		font-size: 12px;
		line-height: 1.45;
		white-space: pre-wrap;
		overflow: hidden;
		mask-image: linear-gradient(to bottom, black 65%, transparent);
		opacity: 0.85;
	}
	.to {
		display: flex;
		flex-wrap: nowrap;
		gap: 4px;
		margin-top: 6px;
		overflow: hidden;
	}
	.target,
	.everyone {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 10.5px;
		padding: 1px 7px;
		border-radius: 999px;
		background: rgb(0 0 0 / 0.06);
		white-space: nowrap;
	}
	.target i {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: hsl(var(--hue) 62% 50%);
	}
	input,
	textarea {
		font: inherit;
		border: none;
		outline: none;
		background: none;
		color: var(--ink);
		padding: 0;
	}
	input {
		margin-top: 6px;
		font-weight: 650;
		font-size: 13.5px;
	}
	textarea {
		flex: 1;
		resize: none;
		font-size: 12.5px;
		line-height: 1.45;
		margin-top: 2px;
	}
	::placeholder {
		color: var(--ink-faint);
	}
	.draft-actions {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.hint {
		flex: 1;
		font-size: 11px;
		color: var(--ink-faint);
	}
	.draft-actions button {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 24px;
		padding: 0 8px;
		border-radius: 7px;
		border: 1px solid var(--line);
		background: var(--chip);
		color: var(--ink);
		font-size: 11.5px;
		cursor: pointer;
	}
	.shimmer {
		display: flex;
		flex-direction: column;
		gap: 7px;
		margin-top: 10px;
	}
	.shimmer i {
		height: 8px;
		border-radius: 4px;
		background: linear-gradient(90deg, rgb(0 0 0 / 0.06), rgb(0 0 0 / 0.14), rgb(0 0 0 / 0.06));
		background-size: 200% 100%;
		animation: shimmer 1.2s linear infinite;
	}
	.shimmer i:nth-child(2) {
		width: 80%;
	}
	.shimmer i:nth-child(3) {
		width: 60%;
	}
	@keyframes shimmer {
		to {
			background-position: -200% 0;
		}
	}
	/* Far out, a sticky is just its title. */
	:global(.tier-far) .note p,
	:global(.tier-far) .note .to,
	:global(.tier-far) .note .kind {
		display: none;
	}
	:global(.tier-far) .note h3 {
		margin: auto 0;
		white-space: normal;
		font-size: min(calc(11px / var(--z, 1)), 40px);
		line-height: 1.15;
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
	}
	.sticky :global(.svelte-flow__handle) {
		opacity: 0;
		pointer-events: none;
		min-width: 0;
		min-height: 0;
		width: 4px;
		height: 4px;
		border: none;
	}
</style>
