<script lang="ts">
	import { tick, untrack } from "svelte";
	import type { BranchInfo, TreeNode } from "../../../../shared/protocol.ts";
	import { branchHue } from "../../../src/lib/layout.ts";
	import { renderMarkdown } from "../../../src/lib/markdown.ts";
	import { textOf, type ConversationView, type ViewEntry } from "../../../src/lib/view.ts";
	import { money, STATUS_LABEL, type Status } from "../lib.ts";
	import Entry from "./Entry.svelte";
	import StatusIcon from "./StatusIcon.svelte";

	type Props = {
		branch: BranchInfo;
		status: Status;
		view: ConversationView | undefined;
		nodes: readonly TreeNode[];
		models: readonly string[];
		crumbs: readonly BranchInfo[];
		forks: readonly BranchInfo[];
		focusId: number | null;
		/** Bumped by the parent to put the caret in the composer. */
		focusComposer: number;
		draft: string;
		send: (text: string, whenBusy: "followUp" | "steer") => Promise<void>;
		abort: () => void;
		fork: (at: number) => void;
		editBranch: (node: TreeNode) => void;
		share: (at?: number) => void;
		rename: (title: string) => void;
		configure: (model: string) => void;
		open: (id: number, entry?: number) => void;
		close: () => void;
	};
	let { branch, status, view, nodes, models, crumbs, forks, focusId, focusComposer, draft = $bindable(), send, abort, fork, editBranch, share, rename, configure, open, close }: Props = $props();

	let scroller: HTMLElement | undefined = $state();
	let input: HTMLTextAreaElement | undefined = $state();
	let sending = $state(false);
	let showInherited = $state(false);
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
	// Inherited context folds away so a fork reads as its own conversation; the fork point stays visible.
	const inherited = $derived(entries.filter((e) => e.conversationId !== branch.id && nodeById.has(e.id)));
	const collapsed = $derived(!showInherited && !(focusId !== null && inherited.some((e) => e.id === focusId)) && inherited.length > 1);
	const keep = $derived(inherited[inherited.length - 1]?.id);
	const visible = $derived(
		entries.filter((e) => e.kind !== "pi.tool-result" && !(collapsed && e.conversationId !== branch.id && e.id !== keep)),
	);
	const live = $derived(view?.docs["pi.live"]);
	const partial = $derived(textOf(live?.generation?.message?.content));
	const tools = $derived((live?.tools ?? []).filter((t) => t.status !== "done"));
	// pi-durable's inbox items carry `mode`; writes are internal and not shown as queued inputs.
	type Queued = { id: number; mode?: string; content?: unknown };
	const queue = $derived(((view?.docs["pi.inbox"]?.items ?? []) as Queued[]).filter((item) => item.mode !== "write"));
	const forkNode = $derived(branch.parent === undefined ? undefined : nodeById.get(branch.parent.at));
	const parent = $derived(crumbs.length > 1 ? crumbs[crumbs.length - 2] : undefined);

	// Stay at the bottom while streaming unless the user scrolled up.
	const onScroll = () => {
		if (scroller === undefined) return;
		stick = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
	};
	$effect(() => {
		void visible.length;
		void partial;
		void tools.length;
		if (stick && focusId === null) void tick().then(() => scroller?.scrollTo({ top: scroller.scrollHeight }));
	});
	$effect(() => {
		if (focusId === null) return;
		const id = focusId;
		void tick().then(() => scroller?.querySelector(`[data-entry="${id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
	});
	$effect(() => {
		if (focusComposer > 0) void tick().then(() => input?.focus());
	});
	$effect(() => {
		void branch.id;
		untrack(() => {
			showInherited = false;
			stick = true;
		});
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

	const onKey = (event: KeyboardEvent) => {
		if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
			event.preventDefault();
			void submit(event.altKey && branch.busy ? "steer" : "followUp");
		} else if (event.key === "Escape") {
			// Hand the keyboard back to the board.
			input?.blur();
		}
	};

	let editingTitle = $state(false);
	let titleDraft = $state("");
	const queuedText = (content: unknown) => (typeof content === "string" ? content : Array.isArray(content) ? textOf(content as never) : "…");
</script>

<section class="focus" style="--hue: {branchHue(branch.id)}" aria-label="Branch {branch.title}">
	<header>
		<nav class="crumbs" aria-label="Path">
			<button class="back btn ghost sm" onclick={close} aria-label="Back to the board">‹ Board</button>
			{#if crumbs.length <= 1}<span class="root-label">Root thread</span><span class="sep">›</span>{/if}
			{#each crumbs as crumb, i (crumb.id)}
				{#if i > 0}<span class="sep">›</span>{/if}
				<button class="crumb" class:current={crumb.id === branch.id} style="--hue: {branchHue(crumb.id)}" onclick={() => open(crumb.id)}>
					<span class="dot"></span>{crumb.title}
				</button>
			{/each}
			<span class="spacer"></span>
			<button class="close btn ghost sm" onclick={close} title="Close (Esc)" aria-label="Close">✕</button>
		</nav>

		<div class="title-row">
			<StatusIcon {status} size={16} />
			{#if editingTitle}
				<!-- svelte-ignore a11y_autofocus -->
				<input
					class="title-input"
					bind:value={titleDraft}
					autofocus
					onkeydown={(e) => {
						if (e.key === "Enter") {
							if (titleDraft.trim() !== "") rename(titleDraft.trim());
							editingTitle = false;
						} else if (e.key === "Escape") editingTitle = false;
					}}
					onblur={() => (editingTitle = false)}
				/>
			{:else}
				<button class="title" title="Rename (r)" onclick={() => ((titleDraft = branch.title), (editingTitle = true))}>{branch.title}</button>
			{/if}
			<span class="status {status}">{STATUS_LABEL[status]}</span>
			<span class="spacer"></span>
			<div class="actions">
				<button class="btn sm" disabled={branch.tip === null} onclick={() => branch.tip !== null && fork(branch.tip)} title="Branch from the latest message (b)">⑂ Branch</button>
				<button class="btn sm" onclick={() => share()} title="Share this branch with others (s)">⇄ Share</button>
			</div>
		</div>

		<div class="meta">
			<label class="model" title="Model for this branch">
				<span class="sr">Model</span>
				<select value={branch.model ?? ""} onchange={(e) => configure(e.currentTarget.value)}>
					{#if branch.model && !models.includes(branch.model)}<option value={branch.model}>{branch.model}</option>{/if}
					{#each models as model (model)}<option value={model}>{model}</option>{/each}
				</select>
			</label>
			{#if branch.sharedIn > 0}<span class="chip" title="Shared notes in this branch's system prompt">⇄ {branch.sharedIn} note{branch.sharedIn === 1 ? "" : "s"}</span>{/if}
			{#if branch.costUsd > 0}<span class="chip mono">{money(branch.costUsd)}</span>{/if}
			{#if parent && forkNode}
				<button class="chip link" onclick={() => open(parent.id, forkNode.id)} title="Open the fork point in {parent.title}">
					⑂ at “{forkNode.preview.slice(0, 30)}{forkNode.preview.length > 30 ? "…" : ""}”
				</button>
			{/if}
			{#if forks.length > 0}<span class="forks-label">forks</span>{/if}
			{#each forks as child (child.id)}
				<button class="chip link fork" style="--hue: {branchHue(child.id)}" onclick={() => open(child.id)} title="A branch of this one">
					<span class="dot"></span>{child.title}{#if child.busy}<span class="live-dot"></span>{/if}
				</button>
			{/each}
		</div>
	</header>

	<div class="scroller" bind:this={scroller} onscroll={onScroll}>
		<div class="transcript">
			{#if entries.length === 0 && !branch.busy}
				<div class="empty">
					<p><strong>Nothing here yet.</strong></p>
					<p>Send a first message below. Branch from any message later; the original keeps running while you supervise both from the board.</p>
				</div>
			{/if}
			{#if collapsed}
				<button class="inherited-toggle" onclick={() => (showInherited = true)}>
					<span>▸ {inherited.length - 1} earlier message{inherited.length === 2 ? "" : "s"} inherited from {parent?.title ?? "the parent"}</span>
				</button>
			{/if}
			{#each visible as entry (entry.id)}
				{@const node = nodeById.get(entry.id)}
				<Entry
					{entry}
					{results}
					inherited={entry.conversationId !== branch.id}
					focused={entry.id === focusId}
					actions={node !== undefined}
					branch={() => fork(entry.id)}
					editBranch={node?.role === "user" && node.before !== undefined ? () => editBranch(node) : undefined}
					share={() => share(entry.id)}
				/>
				{#if branch.parent !== undefined && entry.id === branch.parent.at}
					<div class="fork-line"><span>⑂ “{branch.title}” branches here</span></div>
				{/if}
			{/each}
			{#if branch.busy}
				<div class="live">
					<div class="live-head"><span class="mono">{branch.model ?? "model"}</span><span class="working">working</span></div>
					{#each tools as tool (tool.callId)}
						<div class="tool"><span class="mono">⚙ {tool.name}</span> <span class="faint">{tool.status}…</span>{#if tool.output}<pre>{tool.output.slice(-1200)}</pre>{/if}</div>
					{/each}
					{#if partial !== ""}
						<div class="markdown streaming">{@html renderMarkdown(partial)}</div>
					{:else if tools.length === 0}
						<div class="dots"><span></span><span></span><span></span></div>
					{/if}
					{#if live?.generation?.retry}<div class="retry">Retrying: {live.generation.retry.error}</div>{/if}
				</div>
			{/if}
		</div>
	</div>

	<footer>
		{#if queue.length > 0}
			<ol class="queue" aria-label="Queued inputs">
				{#each queue as item (item.id)}
					<li><span class="tag" class:steer={item.mode === "steer"}>{item.mode === "steer" ? "steer" : "queued"}</span><span class="q-text">{queuedText(item.content)}</span></li>
				{/each}
			</ol>
		{/if}
		<div class="composer" class:busy={branch.busy}>
			<textarea
				bind:this={input}
				bind:value={draft}
				onkeydown={onKey}
				rows="1"
				placeholder={branch.busy ? "Running — Enter queues a follow-up, Alt+Enter steers it now" : `Message ${branch.title}`}
			></textarea>
			<div class="composer-bar">
				<span class="hints">
					{#if branch.busy}<kbd>↵</kbd> queue <kbd>⌥↵</kbd> steer{:else}<kbd>↵</kbd> send <kbd>⇧↵</kbd> newline{/if}
					<kbd>esc</kbd> board
				</span>
				<span class="spacer"></span>
				{#if branch.busy}
					<button class="btn sm danger" onclick={abort} title="Abort the running work (x)">■ Stop</button>
					<button class="btn sm" onclick={() => submit("steer")} disabled={draft.trim() === ""} title="Join the running work after the current tool round">Steer</button>
					<button class="btn sm primary" onclick={() => submit("followUp")} disabled={draft.trim() === ""}>Queue{queue.length > 0 ? ` · ${queue.length}` : ""}</button>
				{:else}
					<button class="btn sm primary" onclick={() => submit("followUp")} disabled={draft.trim() === "" || sending}>Send</button>
				{/if}
			</div>
		</div>
	</footer>
</section>

<style>
	.focus {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-width: 0;
		background: var(--panel);
	}
	header {
		padding: 10px 18px 12px;
		border-bottom: 1px solid var(--line);
	}
	.crumbs {
		display: flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
		font-size: 12px;
		color: var(--text-3);
		overflow-x: auto;
		scrollbar-width: none;
	}
	.back {
		display: none;
	}
	.crumb {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		flex: none;
		max-width: 200px;
		height: 22px;
		padding: 0 7px;
		border: none;
		border-radius: 6px;
		background: none;
		color: var(--text-2);
		font-size: 12px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.crumb:hover {
		background: var(--hover);
		color: var(--text);
	}
	.crumb.current {
		color: var(--text);
		font-weight: 550;
	}
	.dot {
		flex: none;
		width: 7px;
		height: 7px;
		border-radius: 2px;
		background: hsl(var(--hue) 62% 55%);
	}
	.sep {
		flex: none;
		color: var(--text-3);
	}
	.root-label {
		flex: none;
		padding-left: 2px;
		color: var(--text-3);
	}
	.forks-label {
		margin-left: 6px;
		color: var(--text-3);
		font-size: 11.5px;
	}
	.spacer {
		flex: 1;
	}
	.title-row {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-top: 8px;
		min-width: 0;
	}
	.title,
	.title-input {
		min-width: 0;
		font-size: 17px;
		font-weight: 650;
		letter-spacing: -0.01em;
	}
	.title {
		padding: 0;
		border: none;
		background: none;
		color: var(--text);
		cursor: text;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.title-input {
		flex: 1;
		padding: 2px 6px;
		border: 1px solid var(--accent-line);
		border-radius: 6px;
		background: var(--bg);
	}
	.status {
		flex: none;
		padding: 1px 8px;
		border-radius: 999px;
		font-size: 11px;
		font-weight: 600;
		background: var(--sunken);
		color: var(--text-2);
	}
	.status.running {
		background: var(--run-soft);
		color: var(--run);
	}
	.status.done {
		background: var(--ok-soft);
		color: var(--ok);
	}
	.status.errored {
		background: var(--err-soft);
		color: var(--err);
	}
	.actions {
		display: flex;
		gap: 6px;
		flex: none;
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		margin-top: 10px;
	}
	.model select {
		height: 24px;
		max-width: 220px;
		padding: 0 24px 0 8px;
		border: 1px solid var(--line-strong);
		border-radius: 6px;
		background: var(--raised) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M5 6.5l3 3 3-3' fill='none' stroke='%23888' stroke-width='1.6' stroke-linecap='round'/%3E%3C/svg%3E") right 5px center / 14px no-repeat;
		font: 11.5px var(--mono);
		appearance: none;
		cursor: pointer;
	}
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		height: 24px;
		padding: 0 8px;
		border-radius: 6px;
		border: 1px solid var(--line);
		background: var(--sunken);
		color: var(--text-2);
		font-size: 11.5px;
		white-space: nowrap;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		box-sizing: border-box;
	}
	.chip.link:hover {
		color: var(--text);
		border-color: var(--line-strong);
	}
	.live-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--run);
		animation: pulse-ring 1.2s ease-out infinite;
	}
	.scroller {
		flex: 1;
		overflow-y: auto;
	}
	.transcript {
		max-width: 760px;
		margin: 0 auto;
		padding: 8px 18px 28px;
	}
	.empty {
		margin: 18vh auto 0;
		max-width: 360px;
		text-align: center;
		color: var(--text-2);
	}
	.empty p {
		margin: 4px 0;
	}
	.inherited-toggle {
		display: block;
		width: 100%;
		margin: 12px 0 4px;
		padding: 7px 10px;
		border: 1px dashed var(--line-strong);
		border-radius: 8px;
		background: none;
		color: var(--text-2);
		font-size: 12px;
		text-align: left;
	}
	.inherited-toggle:hover {
		background: var(--hover);
		color: var(--text);
	}
	.fork-line {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: 16px 0 6px;
		color: hsl(var(--hue) 55% 50%);
		font-size: 11.5px;
		font-weight: 550;
	}
	.fork-line::before,
	.fork-line::after {
		content: "";
		flex: 1;
		border-top: 1.5px solid hsl(var(--hue) 60% 55% / 0.5);
	}
	.live {
		margin-top: 4px;
		padding: 10px 12px;
		border-radius: 10px;
		border: 1px solid color-mix(in srgb, var(--run) 25%, transparent);
		background: linear-gradient(var(--run-soft), transparent 70%);
	}
	.live-head {
		display: flex;
		gap: 8px;
		align-items: center;
		font-size: 11px;
		color: hsl(var(--hue) 50% 48%);
		font-weight: 600;
	}
	.working {
		color: var(--run);
		font-weight: 500;
	}
	.streaming {
		font-size: 13.5px;
		line-height: 1.6;
	}
	.streaming :global(p) {
		margin: 0.35em 0;
	}
	.streaming :global(> :last-child)::after {
		content: "";
		display: inline-block;
		width: 7px;
		height: 14px;
		margin-left: 2px;
		vertical-align: -2px;
		background: var(--run);
		animation: blink 1s steps(1) infinite;
	}
	.tool {
		margin: 6px 0;
		font-size: 12px;
		color: var(--run);
	}
	.tool pre {
		margin: 4px 0 0;
		max-height: 140px;
		overflow: auto;
		padding: 6px 8px;
		border-radius: 6px;
		background: var(--sunken);
		color: var(--text-2);
		font: 11px/1.45 var(--mono);
		white-space: pre-wrap;
	}
	.faint {
		color: var(--text-3);
	}
	.retry {
		font-size: 12px;
		color: var(--warn);
	}
	.dots {
		display: flex;
		gap: 4px;
		padding: 8px 0 2px;
	}
	.dots span {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--run);
		animation: blink 1.1s infinite;
	}
	.dots span:nth-child(2) {
		animation-delay: 0.18s;
	}
	.dots span:nth-child(3) {
		animation-delay: 0.36s;
	}
	footer {
		padding: 10px 18px 14px;
		border-top: 1px solid var(--line);
		background: var(--panel);
	}
	.queue {
		list-style: none;
		margin: 0 auto 8px;
		padding: 0;
		max-width: 760px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.queue li {
		display: flex;
		gap: 8px;
		align-items: center;
		font-size: 12px;
		color: var(--text-2);
		min-width: 0;
	}
	.tag {
		flex: none;
		padding: 0 6px;
		border-radius: 4px;
		background: var(--warn-soft);
		color: var(--warn);
		font: 600 10.5px/18px var(--mono);
		text-transform: uppercase;
	}
	.tag.steer {
		background: var(--run-soft);
		color: var(--run);
	}
	.q-text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.composer {
		max-width: 760px;
		margin: 0 auto;
		border: 1px solid var(--line-strong);
		border-radius: 12px;
		background: var(--raised);
		box-shadow: var(--shadow);
		transition: border-color 0.12s, box-shadow 0.12s;
	}
	.composer:focus-within {
		border-color: var(--accent-line);
		box-shadow: 0 0 0 3px var(--accent-soft);
	}
	.composer.busy:focus-within {
		border-color: color-mix(in srgb, var(--run) 50%, transparent);
		box-shadow: 0 0 0 3px var(--run-soft);
	}
	textarea {
		display: block;
		width: 100%;
		box-sizing: border-box;
		min-height: 46px;
		max-height: 220px;
		field-sizing: content;
		padding: 12px 14px 4px;
		border: none;
		border-radius: 12px 12px 0 0;
		background: none;
		resize: none;
		font-size: 13.5px;
		outline: none;
	}
	textarea::placeholder {
		color: var(--text-3);
	}
	.composer-bar {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 8px 8px 14px;
	}
	.hints {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 11px;
		color: var(--text-3);
		white-space: nowrap;
		overflow: hidden;
	}
	.hints kbd:not(:first-child) {
		margin-left: 6px;
	}
	@media (max-width: 760px) {
		header {
			padding: 8px 14px 10px;
		}
		.back {
			display: inline-flex;
			flex: none;
		}
		.close {
			display: none;
		}
		.transcript {
			padding: 6px 14px 20px;
		}
		footer {
			padding: 8px 12px max(12px, env(safe-area-inset-bottom, 0px));
		}
		.hints {
			display: none;
		}
		.title,
		.title-input {
			font-size: 16px;
		}
		/* The status icon already says it; the title gets the room. */
		.status {
			display: none;
		}
		.actions .btn {
			padding: 0 7px;
		}
	}
</style>
