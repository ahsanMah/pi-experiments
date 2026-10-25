<script lang="ts">
	import { tick, untrack } from "svelte";
	import type { BranchInfo, BranchSuggestion, SharedNote, TreeNode } from "../../../shared/protocol.ts";
	import { forkOptions, indexForks } from "../lib/forks.ts";
	import { branchHue } from "../lib/layout.ts";
	import { renderMarkdown } from "../lib/markdown.ts";
	import { textOf, type ConversationView, type ViewEntry } from "../lib/view.ts";
	import Message from "./Message.svelte";
	import NoteCard from "./NoteCard.svelte";
	import SuggestionCard from "./SuggestionCard.svelte";
	import Switcher from "./Switcher.svelte";

	type Props = {
		branch: BranchInfo;
		view: ConversationView | undefined;
		nodes: readonly TreeNode[];
		notes: readonly SharedNote[];
		branches: readonly BranchInfo[];
		openBranch: (id: number, entry: number | null) => void;
		unshare: (noteId: string) => void;
		suggestions: readonly BranchSuggestion[];
		accept: (id: string) => Promise<void>;
		dismiss: (id: string) => void;
		models: readonly string[];
		focusId: number | null;
		/** Where a fork switcher was on screen when it opened this branch, to put it back there. */
		anchor: { at: number; top: number } | null;
		/** Open a sibling branch from the switcher at `at`, which was `top` px down the window. */
		switchAt: (branchId: number, at: number, top: number) => void;
		draft: string;
		send: (text: string, whenBusy: "followUp" | "steer") => Promise<void>;
		abort: () => void;
		branchAfter: (entryId: number) => void;
		editBranch: (node: TreeNode) => void;
		share: (entryId: number) => void;
		rename: (title: string) => void;
		configure: (model: string) => void;
	};
	let { branch, view, nodes, notes, branches, openBranch, unshare, suggestions, accept, dismiss, models, focusId, anchor, switchAt, draft = $bindable(), send, abort, branchAfter, editBranch, share, rename, configure }: Props = $props();

	let scroller: HTMLElement | undefined = $state();
	let input: HTMLTextAreaElement | undefined = $state();
	let sending = $state(false);
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
	const live = $derived(view?.docs["pi.live"]);
	const partial = $derived(textOf(live?.generation?.message?.content));
	const runningTools = $derived((live?.tools ?? []).filter((t) => t.status !== "done"));
	const queued = $derived(view?.docs["pi.inbox"]?.items.length ?? 0);
	// Fork points along this branch: an inline switcher to the other ways to continue there.
	const forkIndex = $derived(indexForks(nodes, branches));
	const path = $derived(new Set(entries.map((e) => e.id)));
	const forks = $derived(
		new Map(entries.map((e) => [e.id, forkOptions(forkIndex, branches, e.id, branch.id, path)] as const).filter(([, options]) => options.length > 0)),
	);
	/** The switcher anchor still to apply once this branch's view arrives. */
	let pending = untrack(() => anchor);
	/** Room after the last message, so a shorter branch can still put the switcher back in place. */
	let slack = $state(0);

	// Stay at the bottom while streaming unless the user scrolled up.
	const onScroll = () => {
		if (scroller === undefined) return;
		stick = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
	};
	$effect(() => {
		void entries.length;
		void partial;
		if (stick && focusId === null && pending === null) void tick().then(() => scroller?.scrollTo({ top: scroller.scrollHeight }));
	});
	$effect(() => {
		const target = pending;
		if (target === null || view === undefined) return;
		pending = null;
		// Before the await, so the follow-the-bottom effect for this same update stays out of it.
		stick = false;
		void (async () => {
			await tick();
			const chip = scroller?.querySelector(`[data-fork="${target.at}"]`);
			if (chip === null || chip === undefined || scroller === undefined) return;
			const top = scroller.scrollTop + chip.getBoundingClientRect().top - target.top;
			const max = scroller.scrollHeight - scroller.clientHeight;
			if (top > max) {
				slack = top - max;
				await tick();
			}
			scroller.scrollTo({ top, behavior: "instant" });
		})();
	});
	$effect(() => {
		if (focusId === null) return;
		const id = focusId;
		void tick().then(() => scroller?.querySelector(`[data-entry="${id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
	});
	$effect(() => {
		void branch.id;
		void tick().then(() => input?.focus());
	});

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

	const pick = (branchId: number, at: number) => {
		const chip = scroller?.querySelector(`[data-fork="${at}"]`);
		switchAt(branchId, at, chip?.getBoundingClientRect().top ?? 0);
	};
	/** [ and ] (Alt+[ / Alt+] while typing) step through the branches at the fork nearest mid-screen. */
	const cycleFork = (event: KeyboardEvent) => {
		if (event.metaKey || event.ctrlKey || (event.code !== "BracketLeft" && event.code !== "BracketRight")) return;
		const typing = (event.target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable]") != null;
		if (typing && !event.altKey) return;
		if (scroller === undefined || forks.size === 0) return;
		const middle = scroller.getBoundingClientRect().top + scroller.clientHeight / 2;
		let best: number | undefined;
		let distance = Infinity;
		for (const at of forks.keys()) {
			const chip = scroller.querySelector(`[data-fork="${at}"]`);
			const d = chip === null ? Infinity : Math.abs(chip.getBoundingClientRect().top - middle);
			if (d < distance) [best, distance] = [at, d];
		}
		const options = best === undefined ? undefined : forks.get(best);
		if (best === undefined || options === undefined) return;
		event.preventDefault();
		const current = Math.max(0, options.findIndex((o) => o.current));
		const delta = event.code === "BracketLeft" ? -1 : 1;
		pick(options[(current + delta + options.length) % options.length]!.branch.id, best);
	};

	const onKey = (event: KeyboardEvent) => {
		if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
			event.preventDefault();
			void submit(event.altKey && branch.busy ? "steer" : "followUp");
		}
	};

	// The notes this branch's model sees, as the server renders them into its system prompt.
	const seen = $derived(notes.filter((note) => note.to === "*" || note.to.includes(branch.id)));
	let showNotes = $state(false);

	let editingTitle = $state(false);
	let titleDraft = $state("");
</script>

<svelte:window onkeydown={cycleFork} />

<section class="chat" style="--hue: {branchHue(branch.id)}">
	<header>
		<span class="dot" class:busy={branch.busy}></span>
		{#if editingTitle}
			<!-- svelte-ignore a11y_autofocus -->
			<input
				class="title-input"
				bind:value={titleDraft}
				autofocus
				onkeydown={(e) => {
					if (e.key === "Enter") {
						rename(titleDraft);
						editingTitle = false;
					} else if (e.key === "Escape") editingTitle = false;
				}}
				onblur={() => (editingTitle = false)}
			/>
		{:else}
			<button class="title" title="Rename" onclick={() => ((titleDraft = branch.title), (editingTitle = true))}>{branch.title}</button>
		{/if}
		{#if branch.parent}<span class="muted">forked from {branches.find((b) => b.id === branch.parent?.conversationId)?.title ?? "another branch"}</span>{/if}
		<span class="spacer"></span>
		{#if seen.length > 0}
			<button class="pill" aria-expanded={showNotes} onclick={() => (showNotes = !showNotes)} title="Show the shared notes this branch's model sees">
				⇄ {seen.length} shared
			</button>
		{/if}
		{#if branch.costUsd > 0}<span class="muted">${branch.costUsd.toFixed(4)}</span>{/if}
		<select value={branch.model ?? ""} onchange={(e) => configure(e.currentTarget.value)} title="Model for this branch">
			{#if branch.model && !models.includes(branch.model)}<option value={branch.model}>{branch.model}</option>{/if}
			{#each models as model (model)}<option value={model}>{model}</option>{/each}
		</select>
	</header>

	{#if showNotes && seen.length > 0}
		<div class="notes-panel">
			<p class="notes-intro">This branch's model sees these notes in its system prompt, from its next reply on.</p>
			{#each seen as note (note.id)}
				<details open={seen.length === 1}>
					<summary>{note.title}</summary>
					<NoteCard {note} {branches} {openBranch} {unshare} />
				</details>
			{/each}
		</div>
	{/if}

	<div class="scroller" bind:this={scroller} onscroll={onScroll}>
		<div class="messages">
			{#if entries.length === 0 && !branch.busy}
				<p class="empty">Start the conversation below. Branch from any message to explore a side question while this one keeps going.</p>
			{/if}
			{#each entries as entry (entry.id)}
				{@const node = nodeById.get(entry.id)}
				{@const inherited = entry.conversationId !== branch.id}
				<Message
					{entry}
					{results}
					{inherited}
					focused={entry.id === focusId}
					actions={node !== undefined}
					branch={() => branchAfter(entry.id)}
					editBranch={node?.role === "user" && node.before !== undefined ? () => editBranch(node) : undefined}
					share={() => share(entry.id)}
					{notes}
					{branches}
					{openBranch}
				/>
				{#if forks.has(entry.id)}
					<Switcher at={entry.id} options={forks.get(entry.id)!} {pick} />
				{/if}
			{/each}
			{#each suggestions.filter((s) => s.conversationId === branch.id) as suggestion (suggestion.id)}
				<div class="suggested"><SuggestionCard {suggestion} {branches} {accept} {dismiss} /></div>
			{/each}
			{#if branch.busy}
				<div class="live">
					{#if partial !== ""}
						<div class="markdown">{@html renderMarkdown(partial)}</div>
					{/if}
					{#each runningTools as tool (tool.callId)}
						<div class="tool-running"><code>{tool.name}</code> running…{#if tool.output}<pre>{tool.output.slice(-1500)}</pre>{/if}</div>
					{/each}
					{#if live?.generation?.retry}<div class="muted">Retrying: {live.generation.retry.error}</div>{/if}
					<div class="typing"><span></span><span></span><span></span></div>
				</div>
			{/if}
			{#if slack > 0}<div style="height: {slack}px" aria-hidden="true"></div>{/if}
		</div>
	</div>

	<footer>
		<textarea
			bind:this={input}
			bind:value={draft}
			onkeydown={onKey}
			rows="2"
			placeholder={branch.busy ? "Working… Enter queues a follow-up, Alt+Enter steers" : `Message “${branch.title}”`}
		></textarea>
		<div class="buttons">
			{#if branch.busy}
				<button onclick={() => submit("steer")} disabled={draft.trim() === ""} title="Join the running work after the current tool round">Steer</button>
				<button onclick={() => submit("followUp")} disabled={draft.trim() === ""}>Queue{queued > 0 ? ` (${queued})` : ""}</button>
				<button class="danger" onclick={abort}>Stop</button>
			{:else}
				<button class="primary" onclick={() => submit("followUp")} disabled={draft.trim() === "" || sending}>Send</button>
			{/if}
		</div>
	</footer>
</section>

<style>
	.chat {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-width: 0;
		background: var(--bg);
	}
	header {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 16px;
		border-bottom: 1px solid var(--border);
		border-top: 3px solid hsl(var(--hue) 60% 55%);
		min-height: 28px;
	}
	.title {
		font-weight: 600;
		font-size: 15px;
		background: none;
		border: none;
		padding: 0;
		color: var(--text);
		cursor: text;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.title-input {
		font-weight: 600;
		font-size: 15px;
	}
	.dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		flex: none;
		background: hsl(var(--hue) 60% 55%);
	}
	.dot.busy {
		animation: pulse 1s ease-in-out infinite;
	}
	@keyframes pulse {
		50% {
			opacity: 0.25;
		}
	}
	.spacer {
		flex: 1;
	}
	.muted {
		color: var(--text-muted);
		font-size: 12px;
		white-space: nowrap;
	}
	.pill {
		font-size: 12px;
		padding: 1px 10px;
		border: 1px solid transparent;
		border-radius: 999px;
		background: var(--accent-soft);
		white-space: nowrap;
	}
	.pill[aria-expanded="true"] {
		border-color: var(--accent);
	}
	.notes-panel {
		display: flex;
		flex-direction: column;
		gap: 8px;
		max-height: 45%;
		overflow-y: auto;
		padding: 10px 16px;
		border-bottom: 1px solid var(--border);
		background: var(--surface-muted);
	}
	.notes-intro {
		margin: 0;
		font-size: 12px;
		color: var(--text-muted);
	}
	.notes-panel details {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 6px 12px;
	}
	.notes-panel summary {
		cursor: pointer;
		font-weight: 600;
		font-size: 13px;
	}
	.notes-panel details[open] summary {
		margin-bottom: 6px;
	}
	select {
		max-width: 220px;
	}
	.scroller {
		flex: 1;
		overflow-y: auto;
	}
	.messages {
		max-width: 780px;
		margin: 0 auto;
		padding: 16px 20px 24px;
	}
	.empty {
		color: var(--text-muted);
		text-align: center;
		margin-top: 20vh;
	}
	.suggested {
		margin: 12px 0;
	}
	.live .markdown :global(p) {
		margin: 0.4em 0;
	}
	.tool-running {
		font-size: 13px;
		color: var(--text-muted);
	}
	.tool-running pre {
		font-size: 12px;
		max-height: 160px;
		overflow: auto;
		background: var(--surface-muted);
		padding: 6px;
		border-radius: 6px;
	}
	.typing {
		display: flex;
		gap: 4px;
		padding: 6px 4px;
	}
	.typing span {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--text-muted);
		animation: pulse 1s infinite;
	}
	.typing span:nth-child(2) {
		animation-delay: 0.2s;
	}
	.typing span:nth-child(3) {
		animation-delay: 0.4s;
	}
	footer {
		display: flex;
		gap: 8px;
		padding: 12px 16px;
		border-top: 1px solid var(--border);
		max-width: 820px;
		width: 100%;
		margin: 0 auto;
		box-sizing: border-box;
	}
	textarea {
		flex: 1;
		resize: none;
		font: inherit;
		padding: 8px 12px;
		border-radius: 12px;
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text);
	}
	.buttons {
		display: flex;
		flex-direction: column;
		gap: 4px;
		justify-content: flex-end;
	}
</style>
