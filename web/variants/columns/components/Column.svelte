<script lang="ts">
	import { tick } from "svelte";
	import type { BranchInfo, SharedNote, TreeNode } from "../../../../shared/protocol.ts";
	import { branchHue } from "../../../src/lib/layout.ts";
	import { renderMarkdown } from "../../../src/lib/markdown.ts";
	import { textOf, type ConversationView, type ViewEntry } from "../../../src/lib/view.ts";
	import { entryText, formatCost, isShown } from "../lib.ts";
	import Icon from "./Icon.svelte";
	import Msg from "./Msg.svelte";

	export type DragFrom = { conversationId: number; at: number };

	type Props = {
		branch: BranchInfo;
		view: ConversationView | undefined;
		branches: readonly BranchInfo[];
		nodes: readonly TreeNode[];
		/** Notes this branch's model sees. */
		notes: readonly SharedNote[];
		models: readonly string[];
		pinned: boolean;
		comparing: boolean;
		active: boolean;
		/** Scroll to this entry (a raw entry id; the nearest shown message before it is used). */
		focusRequest: { id: number; n: number } | null;
		draft: string;
		send: (text: string, whenBusy: "followUp" | "steer") => Promise<void>;
		abort: () => void;
		fork: (at: number) => void;
		editBranch: (node: TreeNode) => void;
		share: (at?: number) => void;
		dropShare: (from: DragFrom) => void;
		addNote: () => void;
		unshare: (noteId: string) => void;
		rename: (title: string) => void;
		configure: (model: string) => void;
		close: () => void;
		togglePin: () => void;
		toggleCompare: () => void;
		/** Open (or scroll to) another branch's column, optionally at an entry. */
		reveal: (id: number, entry?: number) => void;
		activate: () => void;
	};
	let {
		branch,
		view,
		branches,
		nodes,
		notes,
		models,
		pinned,
		comparing,
		active,
		focusRequest,
		draft = $bindable(),
		send,
		abort,
		fork,
		editBranch,
		share,
		dropShare,
		addNote,
		unshare,
		rename,
		configure,
		close,
		togglePin,
		toggleCompare,
		reveal,
		activate,
	}: Props = $props();

	let scroller: HTMLElement | undefined = $state();
	let input: HTMLTextAreaElement | undefined = $state();
	let sending = $state(false);
	let expanded = $state(false);
	let flashId = $state<number | null>(null);
	let openNote = $state<string | null>(null);
	let dropping = $state(false);
	let stick = true;

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
	const nodeById = $derived(new Map(nodes.map((n) => [n.id, n])));
	const byId = $derived(new Map(branches.map((b) => [b.id, b])));
	const parent = $derived(branch.parent === undefined ? undefined : byId.get(branch.parent.conversationId));

	// Shared ancestry: everything before the fork point came from ancestor branches. It is folded
	// into a stub so three sibling columns don't repeat the same prefix.
	const inherited = $derived(entries.filter((e) => e.conversationId !== branch.id && isShown(e)));
	const own = $derived(entries.filter((e) => e.conversationId === branch.id && isShown(e)));
	const anchor = $derived(inherited.findLast((e) => e.kind === "pi.user" || e.kind === "pi.assistant"));
	const lineage = $derived([...new Set(inherited.map((e) => e.conversationId))].map((id) => byId.get(id)?.title ?? `#${id}`));
	const inheritedIds = $derived(new Set(inherited.map((e) => e.id)));

	/** Every raw entry id to the shown message at or before it: forks and focus targets may name hidden entries. */
	const shownAt = $derived.by(() => {
		const map = new Map<number, number>();
		let last: number | undefined;
		for (const entry of entries) {
			if (isShown(entry)) last = entry.id;
			if (last !== undefined) map.set(entry.id, last);
		}
		return map;
	});
	const forksAt = $derived.by(() => {
		const map = new Map<number, BranchInfo[]>();
		for (const other of branches) {
			if (other.id === branch.id || other.parent === undefined) continue;
			const at = shownAt.get(other.parent.at);
			if (at !== undefined) map.set(at, [...(map.get(at) ?? []), other]);
		}
		return map;
	});

	const live = $derived(view?.docs["pi.live"]);
	const partial = $derived(textOf(live?.generation?.message?.content));
	const runningTools = $derived((live?.tools ?? []).filter((t) => t.status !== "done"));
	const queued = $derived(view?.docs["pi.inbox"]?.items.length ?? branch.queued);
	const forkPreview = $derived(anchor === undefined ? "" : entryText(anchor).replace(/\s+/g, " ").slice(0, 70));

	const onScroll = () => {
		if (scroller === undefined) return;
		stick = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
	};
	// Stay at the bottom while streaming unless the user scrolled up.
	$effect(() => {
		void entries.length;
		void partial;
		if (stick) void tick().then(() => scroller?.scrollTo({ top: scroller.scrollHeight }));
	});
	$effect(() => {
		if (focusRequest === null) return;
		const target = shownAt.get(focusRequest.id) ?? focusRequest.id;
		if (inheritedIds.has(target)) expanded = true;
		stick = false;
		flashId = target;
		const timer = setTimeout(() => (flashId = null), 1600);
		void tick().then(() => scroller?.querySelector(`[data-entry="${target}"]`)?.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" }));
		return () => clearTimeout(timer);
	});

	export const focusComposer = () => input?.focus();

	const submit = async (whenBusy: "followUp" | "steer") => {
		const text = draft.trim();
		if (text === "" || sending) return;
		sending = true;
		try {
			await send(text, whenBusy);
			draft = "";
			stick = true;
		} finally {
			sending = false;
		}
	};

	const onKey = (event: KeyboardEvent) => {
		if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
			event.preventDefault();
			void submit(event.altKey && branch.busy ? "steer" : "followUp");
		}
	};

	let editingTitle = $state(false);
	let titleDraft = $state("");
	const commitTitle = () => {
		if (titleDraft.trim() !== "" && titleDraft !== branch.title) rename(titleDraft.trim());
		editingTitle = false;
	};

	// Drag-to-share: a message dragged from another column lands here as a share into this branch.
	const DRAG = "application/x-pi-branch";
	let depth = 0;
	const accepts = (event: DragEvent) => event.dataTransfer?.types.includes(DRAG) ?? false;
	const onDragEnter = (event: DragEvent) => {
		if (!accepts(event)) return;
		depth++;
		dropping = true;
	};
	const onDragLeave = () => {
		depth = Math.max(0, depth - 1);
		if (depth === 0) dropping = false;
	};
	const onDrop = (event: DragEvent) => {
		depth = 0;
		dropping = false;
		const raw = event.dataTransfer?.getData(DRAG);
		if (!raw) return;
		event.preventDefault();
		const from = JSON.parse(raw) as DragFrom;
		if (from.conversationId !== branch.id) dropShare(from);
	};

	const noteSource = (note: SharedNote) => {
		if (note.author === "model") return "posted by a model";
		const from = note.from === undefined ? undefined : byId.get(note.from.conversationId);
		return from === undefined ? "your note" : `from ${from.title}`;
	};
	const noteTargets = (note: SharedNote) =>
		note.to === "*" ? "every branch" : note.to.map((id) => byId.get(id)?.title ?? `#${id}`).join(", ");
</script>

{#snippet message(entry: ViewEntry, isInherited: boolean)}
	{@const node = nodeById.get(entry.id)}
	<Msg
		{entry}
		{results}
		inherited={isInherited}
		focused={entry.id === flashId}
		forks={forksAt.get(entry.id) ?? []}
		columnModel={branch.model}
		actions={node !== undefined}
		branch={() => fork(entry.id)}
		editBranch={node?.role === "user" && node.before !== undefined ? () => editBranch(node) : undefined}
		share={() => share(entry.id)}
		{reveal}
		drag={{ conversationId: branch.id, at: entry.id }}
	/>
{/snippet}

<section
	class="column"
	class:pinned
	class:active
	class:comparing
	class:dropping
	style="--hue: {branchHue(branch.id)}"
	data-column={branch.id}
	aria-label="Branch {branch.title}"
	onfocusin={activate}
	onpointerdown={activate}
	ondragenter={onDragEnter}
	ondragleave={onDragLeave}
	ondragover={(e) => accepts(e) && e.preventDefault()}
	ondrop={onDrop}
>
	<header>
		<div class="title-row">
			<span class="dot" class:busy={branch.busy} title={branch.busy ? "Working" : "Idle"}></span>
			{#if editingTitle}
				<!-- svelte-ignore a11y_autofocus -->
				<input
					class="title-input"
					bind:value={titleDraft}
					autofocus
					onkeydown={(e) => {
						if (e.key === "Enter") commitTitle();
						else if (e.key === "Escape") editingTitle = false;
					}}
					onblur={commitTitle}
				/>
			{:else}
				<button class="title" title="Rename" onclick={() => ((titleDraft = branch.title), (editingTitle = true))}>{branch.title}</button>
			{/if}
			{#if branch.busy}<span class="working">working{queued > 0 ? ` · ${queued} queued` : ""}</span>{/if}
			<span class="spacer"></span>
			<button class="icon" class:on={comparing} onclick={toggleCompare} title="Pick for compare" aria-pressed={comparing}><Icon name="compare" /></button>
			<button class="icon" onclick={() => branch.tip !== null && fork(branch.tip)} disabled={branch.tip === null} title="New column from the end of this one"><Icon name="branch" /></button>
			<button class="icon pin" class:on={pinned} onclick={togglePin} title={pinned ? "Unpin" : "Pin to the left edge"} aria-pressed={pinned}><Icon name="pin" /></button>
			<button class="icon" onclick={close} title="Close column (the branch keeps running)"><Icon name="close" /></button>
		</div>
		<div class="meta-row">
			{#if parent && branch.parent}
				{@const at = branch.parent.at}
				<button class="crumb" style="--hue: {branchHue(parent.id)}" onclick={() => reveal(parent.id, at)} title="Show the fork point in “{parent.title}”">
					<span class="crumb-dot"></span><span class="crumb-from">{parent.title}</span>
					{#if forkPreview}<span class="crumb-at">@ {forkPreview}</span>{/if}
				</button>
			{:else}
				<span class="root-tag">root thread</span>
			{/if}
			<span class="spacer"></span>
			{#if formatCost(branch.costUsd)}<span class="cost">{formatCost(branch.costUsd)}</span>{/if}
			<select class="model" value={branch.model ?? ""} onchange={(e) => configure(e.currentTarget.value)} title="Model for this branch">
				{#if branch.model && !models.includes(branch.model)}<option value={branch.model}>{branch.model}</option>{/if}
				{#each models as model (model)}<option value={model}>{model}</option>{/each}
			</select>
		</div>
	</header>

	<div class="tray" aria-label="Shared context this branch's model sees">
		<span class="tray-label" title="Shared notes in this branch's system prompt"><Icon name="tray" size={13} />Context</span>
		{#each notes as note (note.id)}
			{@const fromHue = note.from === undefined ? undefined : branchHue(note.from.conversationId)}
			<button
				class="chip"
				class:open={openNote === note.id}
				style={fromHue === undefined ? undefined : `--hue: ${fromHue}`}
				onclick={() => (openNote = openNote === note.id ? null : note.id)}
				title="{note.title} — {noteSource(note)}"
			>
				<span class="chip-dot"></span>{note.title}{#if note.to === "*"}<span class="all">all</span>{/if}
			</button>
		{/each}
		<button class="chip add" onclick={addNote} title="Write a note into this branch's context"><Icon name="plus" size={12} />note</button>
	</div>
	{#if openNote !== null}
		{@const note = notes.find((n) => n.id === openNote)}
		{#if note}
			<div class="note-card">
				<div class="note-head">
					<strong>{note.title}</strong>
					<span class="note-meta">{noteSource(note)} → {noteTargets(note)}</span>
				</div>
				<div class="note-text">{note.text}</div>
				<div class="note-actions">
					<button class="danger" onclick={() => {
							// Read the id before closing the card: `note` follows openNote.
							const id = note.id;
							openNote = null;
							unshare(id);
						}} title="Removes it from every branch it was shared to">Unshare</button>
					<button onclick={() => (openNote = null)}>Done</button>
				</div>
			</div>
		{/if}
	{/if}

	<div class="scroller" bind:this={scroller} onscroll={onScroll}>
		<div class="messages">
			{#if view === undefined}
				<div class="skeleton"><span></span><span></span><span></span></div>
			{:else}
				{#if inherited.length > 0}
					{#if expanded}
						<button class="stub open" onclick={() => (expanded = false)}>
							<Icon name="up" size={14} /> Hide {inherited.length} earlier message{inherited.length === 1 ? "" : "s"} from {lineage.join(" › ")}
						</button>
						<div class="ancestry">
							{#each inherited as entry (entry.id)}{@render message(entry, true)}{/each}
						</div>
					{:else}
						<button class="stub" onclick={() => (expanded = true)} title="Show the shared history before the fork point">
							<Icon name="down" size={14} />
							{inherited.length - (anchor ? 1 : 0) > 0
								? `${inherited.length - (anchor ? 1 : 0)} earlier message${inherited.length - (anchor ? 1 : 0) === 1 ? "" : "s"} from ${lineage.join(" › ")}`
								: `Forked from ${lineage.join(" › ")}`}
						</button>
						{#if anchor}<div class="ancestry anchor">{@render message(anchor, true)}</div>{/if}
					{/if}
					<div class="fork-line"><span>{branch.title} starts here</span></div>
				{/if}
				{#if entries.length === 0 && !branch.busy}
					<p class="empty">An empty thread. Ask something below; branch from any message to explore beside it.</p>
				{:else if own.length === 0 && !branch.busy}
					<p class="empty">Nothing here yet. This column continues from the message above.</p>
				{/if}
				{#each own as entry (entry.id)}{@render message(entry, false)}{/each}
				{#if branch.busy}
					<div class="live">
						{#if partial !== ""}<div class="markdown">{@html renderMarkdown(partial)}</div>{/if}
						{#each runningTools as tool (tool.callId)}
							<div class="tool-running"><code>{tool.name}</code> running…{#if tool.output}<pre>{tool.output.slice(-1200)}</pre>{/if}</div>
						{/each}
						{#if live?.generation?.retry}<div class="retry">Retrying: {live.generation.retry.error}</div>{/if}
						<div class="typing"><span></span><span></span><span></span></div>
					</div>
				{/if}
			{/if}
		</div>
	</div>

	<footer>
		<div class="composer" class:busy={branch.busy}>
			<textarea
				bind:this={input}
				bind:value={draft}
				onkeydown={onKey}
				rows="1"
				placeholder={branch.busy ? "Enter queues · Alt+Enter steers" : `Message ${branch.title}`}
				aria-label="Message {branch.title}"
			></textarea>
			<div class="buttons">
				{#if branch.busy}
					<button class="soft" onclick={() => submit("steer")} disabled={draft.trim() === ""} title="Join the running work after the current tool round (Alt+Enter)">
						<Icon name="steer" size={14} />Steer
					</button>
					<button class="soft" onclick={() => submit("followUp")} disabled={draft.trim() === ""} title="Run after the current work (Enter)">Queue</button>
					<button class="stop" onclick={abort} title="Stop the running work"><Icon name="stop" size={12} />Stop</button>
				{:else}
					<button class="send" onclick={() => submit("followUp")} disabled={draft.trim() === "" || sending} title="Send (Enter)" aria-label="Send">
						<Icon name="send" size={16} />
					</button>
				{/if}
			</div>
		</div>
	</footer>

	{#if dropping}
		<div class="drop">
			<Icon name="share" size={22} />
			<strong>Share into {branch.title}</strong>
			<span>Drop to choose summary, transcript or note</span>
		</div>
	{/if}
</section>

<style>
	.column {
		position: relative;
		display: flex;
		flex-direction: column;
		flex: none;
		width: var(--col-w);
		height: 100%;
		min-height: 0;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 14px;
		box-shadow: var(--shadow);
		overflow: hidden;
		scroll-snap-align: start;
		scroll-margin-left: var(--strip-pad);
		transition:
			box-shadow 0.2s,
			border-color 0.2s;
	}
	.column::before {
		/* The branch's color as a rule along the top edge. */
		content: "";
		position: absolute;
		inset: 0 0 auto;
		height: 3px;
		background: var(--c);
		z-index: 1;
	}
	.column.active {
		border-color: var(--border-strong);
		box-shadow: var(--shadow-lift);
	}
	.column.pinned {
		box-shadow: var(--shadow-lift);
	}
	.column.comparing {
		border-color: var(--accent);
		box-shadow:
			0 0 0 2px var(--accent-soft),
			var(--shadow);
	}
	header {
		padding: 10px 10px 8px 14px;
		background: var(--surface);
		border-bottom: 1px solid var(--border);
	}
	.title-row,
	.meta-row {
		display: flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
	}
	.meta-row {
		margin-top: 4px;
		gap: 8px;
		min-height: 24px;
	}
	.title {
		font-weight: 650;
		font-size: 15px;
		letter-spacing: -0.01em;
		background: none;
		border: none;
		padding: 0 2px;
		cursor: text;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}
	.title-input {
		font-weight: 650;
		font-size: 15px;
		min-width: 0;
		flex: 1;
		padding: 0 4px;
		border: 1px solid var(--accent);
		border-radius: 6px;
		background: var(--surface);
	}
	.dot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		flex: none;
		margin-right: 4px;
		background: var(--c);
		box-shadow: 0 0 0 3px var(--c-soft);
	}
	.dot.busy {
		animation: pulse 1s ease-in-out infinite;
	}
	.working {
		font: 11px var(--mono);
		color: var(--c);
		white-space: nowrap;
		margin-left: 4px;
	}
	.spacer {
		flex: 1;
	}
	.crumb {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		min-width: 0;
		max-width: 100%;
		padding: 1px 8px 1px 6px;
		font-size: 12px;
		border-radius: 6px;
		border: 1px solid transparent;
		background: var(--surface-sunk);
		color: var(--text-muted);
		white-space: nowrap;
	}
	.crumb:hover:not(:disabled) {
		border-color: var(--c);
		color: var(--text);
	}
	.crumb-dot {
		width: 6px;
		height: 6px;
		border-radius: 2px;
		background: var(--c);
		flex: none;
	}
	.crumb-from {
		font-weight: 600;
		flex: none;
	}
	.crumb-at {
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--text-faint);
	}
	.root-tag {
		font-size: 12px;
		color: var(--text-faint);
	}
	.cost {
		font: 11px var(--mono);
		color: var(--text-muted);
	}
	.model {
		flex: none;
		max-width: 46%;
		font: 11.5px var(--mono);
		padding: 2px 6px;
		border-radius: 6px;
		background: var(--surface-2);
		color: var(--text-muted);
	}
	.tray {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 4px;
		padding: 6px 12px;
		background: var(--surface-2);
		border-bottom: 1px solid var(--border);
	}
	.tray-label {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-faint);
		margin-right: 4px;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 11.5px;
		padding: 1px 8px;
		border-radius: 999px;
		background: var(--surface);
		max-width: 200px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.chip.open {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.chip-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--c, var(--text-faint));
		flex: none;
	}
	.all {
		font-size: 10px;
		color: var(--text-faint);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.chip.add {
		border-style: dashed;
		color: var(--text-muted);
		background: transparent;
		gap: 2px;
	}
	.note-card {
		margin: 8px 10px 0;
		padding: 10px 12px;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--surface-2);
		font-size: 12.5px;
		box-shadow: var(--shadow);
	}
	.note-head {
		display: flex;
		flex-direction: column;
	}
	.note-meta {
		font-size: 11px;
		color: var(--text-muted);
	}
	.note-text {
		white-space: pre-wrap;
		max-height: 160px;
		overflow: auto;
		margin: 6px 0;
		color: var(--text);
	}
	.note-actions {
		display: flex;
		justify-content: flex-end;
		gap: 6px;
	}
	.note-actions button {
		font-size: 12px;
		padding: 2px 10px;
	}
	.scroller {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
	}
	.messages {
		padding: 10px 16px 20px;
	}
	.stub {
		display: flex;
		text-align: left;
		align-items: center;
		gap: 6px;
		width: 100%;
		margin-top: 4px;
		padding: 6px 10px;
		font-size: 12px;
		color: var(--text-muted);
		background: transparent;
		border: 1px dashed var(--border-strong);
		border-radius: 8px;
	}
	.stub:hover:not(:disabled) {
		color: var(--text);
		background: var(--surface-2);
	}
	.ancestry {
		padding-left: 10px;
		border-left: 2px solid var(--border);
		margin-left: 2px;
	}
	.anchor {
		max-height: 160px;
		overflow: hidden;
		mask-image: linear-gradient(to bottom, transparent 0, black 36px);
		-webkit-mask-image: linear-gradient(to bottom, transparent 0, black 36px);
	}
	.fork-line {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 14px 0 6px;
		color: var(--c);
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.fork-line::before,
	.fork-line::after {
		content: "";
		flex: 1;
		height: 1px;
		background: linear-gradient(to right, transparent, var(--c-soft) 20%, var(--c) 50%, var(--c-soft) 80%, transparent);
	}
	.fork-line::before {
		flex: 0 0 18px;
		background: var(--c);
	}
	.empty {
		color: var(--text-faint);
		text-align: center;
		font-size: 13px;
		margin: 32px 12px;
	}
	.skeleton {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding-top: 12px;
	}
	.skeleton span {
		height: 12px;
		border-radius: 6px;
		background: var(--surface-sunk);
		animation: pulse 1.4s ease-in-out infinite;
	}
	.skeleton span:nth-child(2) {
		width: 70%;
	}
	.skeleton span:nth-child(3) {
		width: 45%;
	}
	.live {
		margin: 14px 0;
		padding: 0 2px;
		overflow-wrap: anywhere;
	}
	.tool-running,
	.retry {
		font-size: 12.5px;
		color: var(--text-muted);
	}
	.tool-running pre {
		font: 11.5px var(--mono);
		max-height: 140px;
		overflow: auto;
		background: var(--surface-sunk);
		padding: 6px;
		border-radius: 6px;
	}
	.typing {
		display: flex;
		gap: 4px;
		padding: 8px 2px;
	}
	.typing span {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--c);
		animation: pulse 1s infinite;
	}
	.typing span:nth-child(2) {
		animation-delay: 0.2s;
	}
	.typing span:nth-child(3) {
		animation-delay: 0.4s;
	}
	footer {
		padding: 8px 10px 10px;
		border-top: 1px solid var(--border);
		background: var(--surface);
	}
	.composer {
		display: flex;
		align-items: flex-end;
		gap: 6px;
		padding: 6px 6px 6px 12px;
		border: 1px solid var(--border-strong);
		border-radius: 12px;
		background: var(--surface-2);
		transition: border-color 0.15s;
	}
	.composer:focus-within {
		border-color: var(--c);
		box-shadow: 0 0 0 3px var(--c-soft);
	}
	textarea {
		flex: 1;
		min-width: 0;
		resize: none;
		border: none;
		outline: none;
		background: transparent;
		padding: 5px 0;
		field-sizing: content;
		min-height: 22px;
		max-height: 180px;
		line-height: 1.45;
	}
	textarea::placeholder {
		color: var(--text-faint);
	}
	.buttons {
		display: flex;
		gap: 4px;
		align-items: center;
	}
	.buttons button {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 12px;
		padding: 4px 9px;
		border-radius: 8px;
	}
	.send {
		width: 32px;
		height: 32px;
		justify-content: center;
		padding: 0 !important;
		background: var(--c);
		border-color: var(--c);
		color: var(--surface);
	}
	.send:hover:not(:disabled) {
		border-color: var(--c);
		filter: brightness(1.08);
	}
	.send:disabled {
		background: var(--surface-sunk);
		border-color: var(--border);
		color: var(--text-faint);
		opacity: 1;
	}
	.soft {
		background: var(--surface);
	}
	.stop {
		color: var(--danger);
		border-color: var(--danger-soft);
		background: var(--danger-soft);
	}
	.stop:hover:not(:disabled) {
		border-color: var(--danger);
	}
	@media (max-width: 760px) {
		.pin {
			display: none;
		}
		/* No Alt key on a phone: the busy buttons get their own row under the text. */
		.composer.busy {
			flex-wrap: wrap;
		}
		.composer.busy textarea {
			flex-basis: 100%;
		}
		.composer.busy .buttons {
			margin-left: auto;
		}
	}
	.drop {
		position: absolute;
		inset: 6px;
		z-index: 5;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 6px;
		border: 2px dashed var(--c);
		border-radius: 12px;
		background: color-mix(in srgb, var(--surface) 82%, transparent);
		backdrop-filter: blur(2px);
		color: var(--c);
		pointer-events: none;
	}
	.drop span {
		font-size: 12px;
		color: var(--text-muted);
	}
</style>
