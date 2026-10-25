<script lang="ts">
	import type { SharedNote } from "../../../../shared/protocol.ts";
	import { renderMarkdown } from "../../../src/lib/markdown.ts";
	import { textOf, type ContentBlock, type ViewEntry } from "../../../src/lib/view.ts";

	type Props = {
		entry: ViewEntry;
		/** Results of this entry's tool calls, by call id. */
		results: Map<string, ViewEntry>;
		/** Lane hue of the branch that wrote this entry. */
		hue: number;
		/** The j/k cursor is on this message. */
		cursor: boolean;
		focused: boolean;
		/** The tree knows this entry, so it can be branched from and shared. */
		actions: boolean;
		notes: readonly SharedNote[];
		branch: () => void;
		editBranch?: () => void;
		share: () => void;
		unshare: (noteId: string) => void;
		select: () => void;
	};
	let { entry, results, hue, cursor, focused, actions, notes, branch, editBranch, share, unshare, select }: Props = $props();

	const message = $derived(entry.model?.[0]);
	const blocks = $derived<ContentBlock[]>(
		message === undefined ? [] : typeof message.content === "string" ? [{ type: "text", text: message.content }] : ((message.content as ContentBlock[]) ?? []),
	);
	const text = $derived(textOf(blocks));
	const model = $derived(message?.role === "assistant" && message.model !== undefined ? `${message.provider ?? ""}/${message.model}` : "");
	const shared = $derived(entry.data as { noteId?: string; title?: string } | undefined);
	const note = $derived(notes.find((n) => n.id === shared?.noteId));
	let copied = $state(false);

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(text);
			copied = true;
			setTimeout(() => (copied = false), 1200);
		} catch {
			// Clipboard access can be refused (insecure origin, sandboxed frame); nothing else to do.
		}
	};
</script>

{#snippet toolbar(kind: "user" | "assistant")}
	{#if actions}
		<div class="tools" role="toolbar" aria-label="Message actions">
			<button onclick={branch} title="New branch that continues after this message (b)"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 2v8m0 0c0 2.5 1.5 4 6 4M11 2v3a3 3 0 0 1-3 3H5" /></svg>Branch</button>
			{#if kind === "user" && editBranch}
				<button onclick={editBranch} title="Fork just before this message and edit it (e)"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 13l1-3 7-7 2 2-7 7-3 1z" /></svg>Edit &amp; branch</button>
			{/if}
			<button onclick={share} title="Share this branch up to here (s)"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v8M5 5l3-3 3 3M3 9v4h10V9" /></svg>Share</button>
			{#if text !== ""}<button onclick={copy} title="Copy text">{copied ? "Copied" : "Copy"}</button>{/if}
		</div>
	{/if}
{/snippet}

{#if entry.kind === "pi.user"}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="row user" class:cursor class:focused data-entry={entry.id} style="--h: {hue}" onclick={select}>
		<div class="who" data-row={entry.id} data-kind="user" data-conv={entry.conversationId}>you</div>
		<div class="bubble">{text}</div>
		{@render toolbar("user")}
	</div>
{:else if entry.kind === "pi.assistant"}
	{@const hasText = text.trim() !== ""}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="row assistant" class:cursor class:focused class:steps={!hasText} data-entry={entry.id} style="--h: {hue}" onclick={select}>
		{#if hasText}<div class="who" data-row={entry.id} data-kind="assistant" data-conv={entry.conversationId}>{model !== "" ? model : "assistant"}</div>{/if}
		{#each blocks as block, index (index)}
			{#if block.type === "text" && block.text.trim() !== ""}
				<div class="prose">{@html renderMarkdown(block.text)}</div>
			{:else if block.type === "thinking" && block.thinking.trim() !== ""}
				<details class="fold"><summary>Thinking</summary><div class="thinking">{block.thinking}</div></details>
			{:else if block.type === "toolCall"}
				{@const result = results.get(block.id)}
				{@const resultMessage = result?.model?.[0]}
				<details class="fold tool" class:error={resultMessage?.role === "toolResult" && resultMessage.isError}>
					<summary><code>{block.name}</code><span class="args">{JSON.stringify(block.arguments).slice(0, 120)}</span></summary>
					<pre>{JSON.stringify(block.arguments, null, 2)}</pre>
					{#if resultMessage?.role === "toolResult"}<pre class="result">{textOf(resultMessage.content).slice(0, 4000)}</pre>{/if}
				</details>
			{/if}
		{/each}
		{#if message?.role === "assistant" && message.stopReason === "error"}
			<div class="error">{message.errorMessage ?? "The model returned an error."}</div>
		{/if}
		{#if hasText}{@render toolbar("assistant")}{/if}
	</div>
{:else if entry.kind === "branches.shared"}
	<!-- A station: where a shared note arrived in this branch's context. -->
	<aside class="row station" data-entry={entry.id}>
		<details>
			<summary data-row={entry.id} data-kind="shared" data-conv={entry.conversationId}>
				<span class="badge">Arrived</span>
				<span class="station-title">{shared?.title ?? "Shared context"}</span>
				{#if note}<span class="meta">{note.author === "model" ? "posted by a model" : "shared by you"}</span>{:else}<span class="meta">unshared</span>{/if}
			</summary>
			{#if note}
				<div class="note-text">{note.text}</div>
				<button class="link danger" onclick={() => unshare(note.id)}>Unshare from every branch</button>
			{/if}
		</details>
	</aside>
{:else if entry.kind === "pi.compaction"}
	<div class="row marker" data-entry={entry.id} data-row={entry.id} data-kind="compaction" data-conv={entry.conversationId}>Earlier context was compacted into a summary</div>
{:else if entry.kind === "pi.reset"}
	<div class="row marker" data-entry={entry.id} data-row={entry.id} data-kind="reset" data-conv={entry.conversationId}>Context reset</div>
{/if}

<style>
	.row {
		position: relative;
		scroll-margin: 96px;
		border-radius: 10px;
	}
	.row::before {
		/* The j/k cursor: a hairline in the lane colour beside the text. */
		content: "";
		position: absolute;
		left: -14px;
		top: 4px;
		bottom: 4px;
		width: 2px;
		border-radius: 2px;
		background: hsl(var(--h) var(--lane-s) var(--lane-l));
		opacity: 0;
		transition: opacity 0.15s;
	}
	.row.cursor::before {
		opacity: 1;
	}
	.row.focused {
		animation: flash 1.4s ease-out;
	}
	@keyframes flash {
		0% {
			background: hsl(var(--h) var(--lane-s) var(--lane-l) / 0.16);
		}
	}
	.who {
		font: 500 11px/16px var(--mono);
		letter-spacing: 0.02em;
		color: var(--text-3);
		margin-bottom: 6px;
		text-transform: lowercase;
	}
	.user {
		padding: 28px 0 6px;
	}
	.user .bubble {
		font: 500 16px/1.55 var(--sans);
		letter-spacing: -0.006em;
		color: var(--text);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		padding: 12px 16px;
		background: hsl(var(--h) var(--lane-s) var(--lane-l) / 0.045);
		border: 1px solid var(--border);
		border-radius: 12px;
	}
	.assistant {
		padding: 18px 0 6px;
	}
	.assistant.steps {
		padding: 4px 0;
	}
	.prose {
		font: 400 17.5px/1.68 var(--serif);
		color: var(--text);
		overflow-wrap: anywhere;
	}
	.prose :global(p) {
		margin: 0 0 0.8em;
	}
	.prose :global(p:last-child) {
		margin-bottom: 0;
	}
	.prose :global(h1),
	.prose :global(h2),
	.prose :global(h3) {
		font-family: var(--sans);
		font-weight: 650;
		letter-spacing: -0.015em;
		line-height: 1.3;
		margin: 1.3em 0 0.5em;
	}
	.prose :global(h1) {
		font-size: 1.3em;
	}
	.prose :global(h2) {
		font-size: 1.15em;
	}
	.prose :global(h3) {
		font-size: 1em;
	}
	.prose :global(ul),
	.prose :global(ol) {
		padding-left: 1.3em;
		margin: 0 0 0.8em;
	}
	.prose :global(li) {
		margin: 0.2em 0;
	}
	.prose :global(li::marker) {
		color: var(--text-3);
	}
	.prose :global(blockquote) {
		margin: 0 0 0.8em;
		padding-left: 1em;
		border-left: 2px solid var(--border-strong);
		color: var(--text-2);
	}
	.prose :global(code) {
		font: 0.82em var(--mono);
		background: var(--surface-2);
		padding: 0.1em 0.35em;
		border-radius: 4px;
	}
	.prose :global(pre) {
		font: 13px/1.6 var(--mono);
		background: var(--surface-2);
		border: 1px solid var(--border);
		padding: 12px 14px;
		border-radius: 10px;
		overflow-x: auto;
	}
	.prose :global(pre code) {
		background: none;
		padding: 0;
		font-size: inherit;
	}
	.prose :global(a) {
		color: hsl(var(--h) var(--lane-s) var(--lane-l));
		text-underline-offset: 3px;
	}
	.prose :global(table) {
		border-collapse: collapse;
		font: 14px var(--sans);
		display: block;
		overflow-x: auto;
	}
	.prose :global(th),
	.prose :global(td) {
		border-bottom: 1px solid var(--border);
		padding: 6px 10px;
		text-align: left;
	}
	.fold {
		margin: 6px 0;
		font: 13px var(--sans);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 6px 10px;
		background: var(--surface);
	}
	.fold.error {
		border-color: var(--danger);
	}
	.fold summary {
		cursor: pointer;
		color: var(--text-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.fold code {
		font: 12px var(--mono);
		color: var(--text);
	}
	.args {
		margin-left: 8px;
		font: 12px var(--mono);
		color: var(--text-3);
	}
	.fold pre {
		font: 12px/1.5 var(--mono);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		max-height: 320px;
		overflow: auto;
	}
	.fold .result {
		border-top: 1px solid var(--border);
		padding-top: 6px;
	}
	.thinking {
		white-space: pre-wrap;
		color: var(--text-2);
		padding-top: 6px;
	}
	.error {
		color: var(--danger);
		font: 13px var(--sans);
	}
	.tools {
		display: flex;
		gap: 2px;
		margin-top: 8px;
		opacity: 0;
		transform: translateY(-2px);
		transition:
			opacity 0.15s,
			transform 0.15s;
	}
	.row:hover .tools,
	.row:focus-within .tools,
	.row.cursor .tools {
		opacity: 1;
		transform: none;
	}
	@media (hover: none) {
		.tools {
			opacity: 0.85;
			transform: none;
		}
	}
	.tools button {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font: 500 12px var(--sans);
		color: var(--text-2);
		background: none;
		border: none;
		border-radius: 6px;
		padding: 4px 8px;
		cursor: pointer;
	}
	.tools button:hover {
		background: var(--surface-2);
		color: var(--text);
	}
	.tools svg {
		width: 13px;
		height: 13px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.station {
		margin: 18px 0 4px;
		font: 13px var(--sans);
	}
	.station details {
		border: 1px dashed var(--border-strong);
		border-radius: 10px;
		padding: 8px 12px;
		background: var(--surface);
	}
	.station summary {
		display: flex;
		align-items: baseline;
		gap: 8px;
		cursor: pointer;
		list-style: none;
		flex-wrap: wrap;
	}
	.station summary::-webkit-details-marker {
		display: none;
	}
	.badge {
		font: 600 10px/16px var(--mono);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-3);
	}
	.station-title {
		font-weight: 600;
		color: var(--text);
	}
	.meta {
		color: var(--text-3);
		font-size: 12px;
	}
	.note-text {
		white-space: pre-wrap;
		color: var(--text-2);
		margin: 8px 0;
		max-height: 260px;
		overflow: auto;
		font: 14px/1.55 var(--serif);
	}
	.link {
		background: none;
		border: none;
		padding: 0;
		font: 500 12px var(--sans);
		cursor: pointer;
	}
	.danger {
		color: var(--danger);
	}
	.marker {
		margin: 16px 0;
		text-align: center;
		font: 12px var(--mono);
		color: var(--text-3);
	}
</style>
