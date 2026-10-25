<script lang="ts" module>
	import type { CardModel } from "../lib/geometry.ts";

	export type BranchCardData = { model: CardModel; hue: number };
</script>

<script lang="ts">
	// A branch as a mini chat window on the canvas. Rows have fixed heights (see geometry.ts) so
	// child edges leave from the exact message; the answer block streams live when watched.
	import { Handle, Position, type NodeProps } from "@xyflow/svelte";
	import type { TreeNode } from "../../../../shared/protocol.ts";
	import { renderMarkdown } from "../../lib/markdown.ts";
	import { textOf } from "../../lib/view.ts";
	import { ANSWER_H, COMPOSER_H, GAP_H, HEAD_H, ROW_H } from "../lib/geometry.ts";
	import { useSpace } from "../lib/space.svelte.ts";
	import Composer from "./Composer.svelte";
	import Icon from "./Icon.svelte";

	let { data }: NodeProps & { data: BranchCardData } = $props();
	const space = useSpace();

	const model = $derived(data.model);
	const branch = $derived(model.branch);
	const view = $derived(space.client.views[branch.id]);
	const live = $derived(view?.docs["pi.live"]);
	const partial = $derived(textOf(live?.generation?.message?.content));
	const tools = $derived((live?.tools ?? []).filter((t) => t.status !== "done"));
	// The watched view has the full answer; otherwise the tree's preview stands in.
	const fullAnswer = $derived.by(() => {
		if (view === undefined || model.answer === undefined) return undefined;
		const entry = view.entries.find((e) => e.id === model.answer!.id);
		const text = textOf(entry?.model?.[0]?.content as never);
		return text.trim() === "" ? undefined : text;
	});
	const modelName = $derived((branch.model ?? space.client.defaultModel).split("/").pop() ?? "");
	const focused = $derived(space.focusId === branch.id);
	const current = $derived(space.currentId === branch.id);
	const fresh = $derived(space.fresh.includes(branch.id));
	const dropping = $derived(space.dropTarget === branch.id);
	const lastUser = $derived([...model.own].reverse().find((n) => n.role === "user"));

	let input = $state<HTMLTextAreaElement>();
	$effect(() => {
		// A branch made here with a draft (edit & branch) is ready to type into.
		if (fresh && !focused && (space.composer[branch.id] ?? "") !== "") input?.focus();
	});

	const glyph = (node: TreeNode) => (node.role === "user" ? "user" : node.role === "assistant" ? "spark" : "share");
	const open = () => space.focus(branch.id);
	// On phones a tap opens the card: there is no hover, and the cards are small at fit zoom.
	const onClick = (event: MouseEvent) => {
		if ((event.target as HTMLElement).closest(".nodrag, button")) return;
		if (matchMedia("(max-width: 760px)").matches) open();
	};
	const onDblClick = (event: MouseEvent) => {
		if ((event.target as HTMLElement).closest(".nodrag, button")) return;
		open();
	};
</script>

<!-- Keyboard users open the current card with Enter (see App.svelte). -->
<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
<div
	class="card"
	class:busy={branch.busy}
	class:focused
	class:current
	class:fresh
	class:dropping
	data-card-id={branch.id}
	style="--hue: {data.hue}; height: {model.height}px"
	ondblclick={onDblClick}
	onclick={onClick}
	onpointerdown={() => (space.currentId = branch.id)}
>
	<Handle type="target" id="in" position={Position.Left} style="top: {HEAD_H / 2}px" isConnectable={false} />
	<Handle type="target" id="note-in" position={Position.Top} style="left: 62%" isConnectable={false} />
	<Handle type="source" id="note-src" position={Position.Top} style="left: 22%" isConnectable={false} />
	<Handle type="source" id="tail" position={Position.Right} style="top: {HEAD_H / 2}px" isConnectable={false} />
	{#each [...model.ports] as [id, y] (id)}
		<Handle type="source" id="p-{id}" position={Position.Right} style="top: {y}px" isConnectable={false} />
	{/each}

	<header class="grip" style="height: {HEAD_H}px" title="Drag to move · double-click to open">
		<span class="dot" class:busy={branch.busy}></span>
		<span class="title">{branch.title}</span>
		{#if branch.sharedIn > 0}<span class="chip shared" title="Shared notes this branch's model sees"><Icon name="sticky" size={11} />{branch.sharedIn}</span>{/if}
		<span class="chip model" title={branch.model ?? space.client.defaultModel}>{modelName}</span>
		<button class="icon-btn nodrag" onclick={open} title="Open (Enter)" aria-label="Open {branch.title}"><Icon name="expand" size={14} /></button>
	</header>

	{#if model.origin}
		<div class="origin">
			<Icon name="branch" size={12} />
			<span>from <b>{model.origin.title}</b> · after “{model.origin.preview}”</span>
		</div>
	{/if}

	<div class="rows">
		{#each model.rows as row (row.kind === "node" ? row.node.id : `gap${row.y}`)}
			{#if row.kind === "gap"}
				<button class="gap nodrag" style="height: {GAP_H}px" onclick={open}>{row.count} earlier message{row.count === 1 ? "" : "s"}</button>
			{:else}
				<div class="row {row.node.role}" class:port={model.ports.has(row.node.id)} style="height: {ROW_H}px">
					<span class="glyph"><Icon name={glyph(row.node)} size={12} /></span>
					<span class="preview">{row.node.preview || (row.node.toolCalls ? `${row.node.toolCalls} tool call${row.node.toolCalls === 1 ? "" : "s"}` : "…")}</span>
					{#if row.node.role === "user" || row.node.role === "assistant"}
						<span class="row-actions nodrag">
							<button onclick={() => space.fork(branch.id, row.node.id)} title="Branch after this message" aria-label="Branch after this message"><Icon name="branch" size={13} /></button>
							{#if row.node.role === "user" && row.node.before !== undefined}
								<button onclick={() => space.editBranch(row.node)} title="Edit & branch: fork before this message with its text" aria-label="Edit and branch"><Icon name="edit" size={13} /></button>
							{/if}
							<button onclick={() => (space.sheet = { from: { conversationId: branch.id, at: row.node.id } })} title="Share up to here…" aria-label="Share up to here"><Icon name="share" size={13} /></button>
						</span>
					{/if}
				</div>
			{/if}
		{/each}
	</div>

	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<section class="answer" class:port={model.answer !== undefined && model.ports.has(model.answer.id)} style="top: {model.answerY}px; height: {ANSWER_H}px" onclick={open}>
		{#if branch.busy}
			<div class="label live-label"><span class="pulse"></span>{tools.length > 0 ? `Running ${tools.map((t) => t.name).join(", ")}` : "Answering"}{#if branch.queued > 0}<span class="queued">+{branch.queued} queued</span>{/if}</div>
			{#if partial !== ""}
				<div class="body markdown">{@html renderMarkdown(partial)}<span class="caret"></span></div>
			{:else}
				<div class="body waiting">
					{#if lastUser}“{lastUser.preview}”{/if}
					<span class="dots"><i></i><i></i><i></i></span>
				</div>
			{/if}
		{:else if model.answer}
			<div class="label">
				<Icon name="spark" size={11} />{model.answer.model?.split("/").pop() ?? "Answer"}
				<span class="answer-actions nodrag">
					<button onclick={(e) => (e.stopPropagation(), space.fork(branch.id, model.answer!.id))} title="Branch after this answer"><Icon name="branch" size={13} /><span>Branch</span></button>
					<button onclick={(e) => (e.stopPropagation(), (space.sheet = { from: { conversationId: branch.id, at: model.answer!.id } }))} title="Share up to here…"><Icon name="share" size={13} /></button>
				</span>
			</div>
			{#if fullAnswer}
				<div class="body markdown">{@html renderMarkdown(fullAnswer)}</div>
			{:else}
				<div class="body">{model.answer.preview}</div>
			{/if}
		{:else if !model.own.some((n) => n.role === "user" || n.role === "assistant")}
			<div class="body empty">
				<strong>Fresh branch.</strong> It already knows everything above its fork point. Ask it something below.
			</div>
		{:else}
			<div class="body empty">No answer yet.</div>
		{/if}
	</section>

	<footer style="height: {COMPOSER_H}px">
		<Composer
			{branch}
			compact
			bind:value={() => space.composer[branch.id] ?? "", (v) => (space.composer[branch.id] = v)}
			bind:input
			send={(text, whenBusy) => space.send(branch.id, text, whenBusy)}
			abort={() => space.abort(branch.id)}
		/>
	</footer>

	<!-- Far zoom: the card turns into a poster with just the title and status. -->
	<div class="poster" aria-hidden="true">
		<span class="poster-title">{branch.title}</span>
		<span class="poster-meta">
			<span class="dot" class:busy={branch.busy}></span>{branch.busy ? "working" : `${model.own.length} message${model.own.length === 1 ? "" : "s"}`} · {modelName}
		</span>
	</div>

	<button
		class="knob nodrag nopan"
		data-knob={branch.id}
		title="Drag onto another branch to share this one with it"
		aria-label="Share {branch.title} with another branch"
		onclick={() => (space.sheet = { from: { conversationId: branch.id } })}
	><Icon name="connect" size={14} /></button>
</div>

<style>
	.card {
		position: relative;
		box-sizing: border-box;
		width: 100%;
		border-radius: 18px;
		background: var(--card);
		border: 1px solid var(--card-line);
		box-shadow: var(--shadow-card);
		color: var(--ink);
		overflow: visible;
		transition:
			box-shadow 0.2s,
			border-color 0.2s,
			transform 0.2s;
	}
	.card::before {
		/* The branch color as a thin cap, so cards read as a family at any zoom. */
		content: "";
		position: absolute;
		inset: 0 0 auto;
		height: 4px;
		border-radius: 18px 18px 0 0;
		background: var(--hue-ink);
		opacity: 0.85;
	}
	.card {
		--hue-ink: hsl(var(--hue) 62% 52%);
		--hue-soft: hsl(var(--hue) 70% 50% / 0.12);
	}
	.card.current {
		border-color: hsl(var(--hue) 55% 60% / 0.7);
		box-shadow:
			0 0 0 3px hsl(var(--hue) 70% 55% / 0.16),
			var(--shadow-card);
	}
	.card.focused {
		border-color: var(--hue-ink);
		box-shadow:
			0 0 0 4px hsl(var(--hue) 70% 55% / 0.28),
			var(--shadow-lift);
	}
	.card.dropping {
		border-color: var(--hue-ink);
		box-shadow:
			0 0 0 6px hsl(var(--hue) 70% 55% / 0.3),
			var(--shadow-lift);
		transform: scale(1.015);
	}
	.card.fresh {
		animation: spawn 0.55s cubic-bezier(0.2, 0.9, 0.25, 1.15);
	}
	@keyframes spawn {
		from {
			opacity: 0;
			transform: translateX(-36px) scale(0.92);
		}
	}
	.card.busy {
		box-shadow:
			0 0 0 1px hsl(var(--hue) 70% 55% / 0.25),
			0 0 28px -4px hsl(var(--hue) 80% 55% / 0.35),
			var(--shadow-card);
	}
	header {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 10px 0 16px;
		box-sizing: border-box;
		cursor: grab;
	}
	header:active {
		cursor: grabbing;
	}
	.dot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		flex: none;
		background: var(--hue-ink);
	}
	.dot.busy {
		animation: beat 1.1s ease-in-out infinite;
	}
	@keyframes beat {
		0%,
		100% {
			box-shadow: 0 0 0 0 hsl(var(--hue) 70% 55% / 0.55);
		}
		50% {
			box-shadow: 0 0 0 6px hsl(var(--hue) 70% 55% / 0);
		}
	}
	.title {
		flex: 1;
		min-width: 0;
		font-weight: 650;
		font-size: 15px;
		letter-spacing: -0.01em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		font-size: 11px;
		line-height: 18px;
		padding: 0 7px;
		border-radius: 999px;
		background: var(--chip);
		color: var(--ink-soft);
		white-space: nowrap;
		max-width: 110px;
		overflow: hidden;
		text-overflow: ellipsis;
		flex: none;
	}
	.chip.model {
		font-family: var(--mono);
		font-size: 10.5px;
	}
	.chip.shared {
		background: var(--sticky-soft);
		color: var(--sticky-ink);
	}
	.icon-btn {
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		border-radius: 8px;
		border: none;
		background: none;
		color: var(--ink-faint);
		cursor: pointer;
	}
	.icon-btn:hover {
		background: var(--chip);
		color: var(--ink);
	}
	.origin {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 0 12px;
		padding: 0 8px;
		box-sizing: border-box;
		font-size: 11.5px;
		border-radius: 8px;
		background: var(--hue-soft);
		height: 24px;
		margin-bottom: 6px;
		color: hsl(var(--hue) 50% var(--hue-text-l));
	}
	.origin span {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.rows {
		position: relative;
	}
	.row {
		position: relative;
		display: flex;
		align-items: center;
		gap: 9px;
		padding: 0 14px 0 16px;
		box-sizing: border-box;
		font-size: 13px;
		color: var(--ink-soft);
	}
	.row:hover {
		background: var(--hover);
	}
	.row.user {
		color: var(--ink);
	}
	.glyph {
		display: grid;
		place-items: center;
		width: 20px;
		height: 20px;
		border-radius: 7px;
		flex: none;
		background: var(--chip);
		color: var(--ink-faint);
	}
	.row.user .glyph {
		background: var(--hue-soft);
		color: var(--hue-ink);
	}
	.row.shared .glyph {
		background: var(--sticky-soft);
		color: var(--sticky-ink);
	}
	.row.port::after {
		/* The exact message a child branch leaves from. */
		content: "";
		position: absolute;
		right: 0;
		top: 50%;
		width: 3px;
		height: 18px;
		transform: translateY(-50%);
		border-radius: 3px 0 0 3px;
		background: var(--ink-faint);
	}
	.preview {
		flex: 1;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.row-actions {
		display: none;
		gap: 2px;
		position: absolute;
		right: 8px;
		padding-left: 24px;
		background: linear-gradient(to right, transparent, var(--card) 22px);
	}
	.row:hover .row-actions,
	.row:focus-within .row-actions {
		display: flex;
	}
	.row-actions button,
	.answer-actions button {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 24px;
		min-width: 24px;
		justify-content: center;
		padding: 0 6px;
		border-radius: 7px;
		border: 1px solid var(--line);
		background: var(--card);
		color: var(--ink-soft);
		font-size: 11.5px;
		cursor: pointer;
	}
	.row-actions button:hover,
	.answer-actions button:hover {
		color: var(--ink);
		border-color: var(--hue-ink);
	}
	.gap {
		display: block;
		width: calc(100% - 32px);
		margin: 0 16px;
		border: none;
		background: none;
		border-top: 1px dashed var(--line);
		color: var(--ink-faint);
		font-size: 11px;
		cursor: pointer;
		text-align: left;
		padding: 4px 0 0 30px;
		box-sizing: border-box;
	}
	.gap:hover {
		color: var(--ink);
	}
	.answer {
		position: absolute;
		left: 10px;
		right: 10px;
		box-sizing: border-box;
		padding: 8px 12px 10px;
		border-radius: 12px;
		background: var(--well);
		cursor: pointer;
		overflow: hidden;
	}
	.answer.port {
		box-shadow: inset -3px 0 0 var(--ink-faint);
	}
	.label {
		display: flex;
		align-items: center;
		gap: 5px;
		height: 22px;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.02em;
		color: var(--ink-faint);
		text-transform: uppercase;
	}
	.live-label {
		color: var(--hue-ink);
	}
	.queued {
		margin-left: auto;
		text-transform: none;
		font-weight: 500;
		color: var(--ink-soft);
	}
	.pulse {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--hue-ink);
		animation: beat 1.1s ease-in-out infinite;
	}
	.answer-actions {
		margin-left: auto;
		display: none;
		gap: 4px;
		text-transform: none;
		letter-spacing: 0;
		font-weight: 500;
	}
	.answer:hover .answer-actions,
	.answer:focus-within .answer-actions {
		display: flex;
	}
	.body {
		font-size: 13px;
		line-height: 1.5;
		color: var(--ink);
		max-height: calc(100% - 22px);
		overflow: hidden;
		mask-image: linear-gradient(to bottom, black 70%, transparent);
	}
	.body.markdown :global(p) {
		margin: 0 0 0.45em;
	}
	.body.markdown :global(ul),
	.body.markdown :global(ol) {
		margin: 0.2em 0;
		padding-left: 1.2em;
	}
	.body.markdown :global(pre) {
		font-size: 11px;
		padding: 6px 8px;
		border-radius: 6px;
		background: var(--chip);
		overflow: hidden;
	}
	.body.markdown :global(h1),
	.body.markdown :global(h2),
	.body.markdown :global(h3) {
		font-size: 13px;
		margin: 0.3em 0;
	}
	.empty {
		color: var(--ink-soft);
		mask-image: none;
		padding-top: 10px;
	}
	.empty strong {
		color: var(--ink);
	}
	.waiting {
		color: var(--ink-soft);
		font-style: italic;
	}
	.caret {
		display: inline-block;
		width: 7px;
		height: 14px;
		margin-left: 2px;
		vertical-align: -2px;
		background: var(--hue-ink);
		animation: blink 0.9s steps(2) infinite;
	}
	@keyframes blink {
		50% {
			opacity: 0;
		}
	}
	.dots {
		display: inline-flex;
		gap: 3px;
		margin-left: 6px;
		vertical-align: middle;
	}
	.dots i {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--hue-ink);
		animation: blink 1s infinite;
	}
	.dots i:nth-child(2) {
		animation-delay: 0.2s;
	}
	.dots i:nth-child(3) {
		animation-delay: 0.4s;
	}
	footer {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		padding: 8px 10px 10px;
		box-sizing: border-box;
	}
	.poster {
		display: none;
		position: absolute;
		inset: 0;
		flex-direction: column;
		justify-content: flex-end;
		gap: calc(8px / var(--z, 1));
		padding: 28px 28px 32px;
		border-radius: 18px;
		background:
			radial-gradient(120% 70% at 0% 0%, hsl(var(--hue) 75% 55% / 0.22), transparent 70%),
			var(--card);
		border-top: 6px solid var(--hue-ink);
		box-sizing: border-box;
		pointer-events: none;
	}
	.poster-title {
		font-weight: 700;
		font-size: min(calc(14px / var(--z, 1)), 64px);
		line-height: 1.1;
		letter-spacing: -0.02em;
		overflow-wrap: anywhere;
	}
	.poster-meta {
		display: flex;
		align-items: center;
		gap: 0.5em;
		font-size: min(calc(10px / var(--z, 1)), 40px);
		color: var(--ink-soft);
	}
	.poster-meta .dot {
		width: 0.7em;
		height: 0.7em;
	}
	:global(.tier-far) .poster {
		display: flex;
	}
	:global(.tier-far) .knob,
	:global(.tier-far) footer,
	:global(.tier-far) header,
	:global(.tier-far) .origin {
		visibility: hidden;
	}
	.knob {
		position: absolute;
		right: -13px;
		bottom: 22px;
		display: grid;
		place-items: center;
		width: 26px;
		height: 26px;
		border-radius: 50%;
		border: 1px solid var(--line);
		background: var(--card);
		color: var(--ink-faint);
		cursor: crosshair;
		opacity: 0;
		transition: opacity 0.15s;
		touch-action: none;
	}
	.card:hover .knob,
	.card.current .knob,
	.knob:focus-visible {
		opacity: 1;
	}
	.knob:hover {
		color: var(--sticky-ink);
		border-color: var(--sticky-ink);
		background: var(--sticky);
	}
	.card :global(.svelte-flow__handle) {
		opacity: 0;
		width: 6px;
		height: 6px;
		min-width: 0;
		min-height: 0;
		border: none;
		pointer-events: none;
	}
</style>
