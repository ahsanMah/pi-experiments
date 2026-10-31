<script lang="ts">
	// The focused branch as a full chat that grows out of its card. The canvas stays live beside
	// it (full screen on phones), so you can watch other branches while reading this one.
	import { tick, untrack } from "svelte";
	import { cubicOut } from "svelte/easing";
	import type { BranchInfo } from "../../../../shared/protocol.ts";
	import { branchHue } from "../../lib/layout.ts";
	import { renderMarkdown } from "../../lib/markdown.ts";
	import { textOf, type ViewEntry } from "../../lib/view.ts";
	import { useSpace } from "../lib/space.svelte.ts";
	import ChatEntry from "./ChatEntry.svelte";
	import Composer from "./Composer.svelte";
	import Icon from "./Icon.svelte";

	let { branch }: { branch: BranchInfo } = $props();
	const space = useSpace();
	const client = space.client;

	const view = $derived(client.views[branch.id]);
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
	const nodeById = $derived(new Map(client.tree.nodes.map((n) => [n.id, n])));
	const live = $derived(view?.docs["pi.live"]);
	const partial = $derived(textOf(live?.generation?.message?.content));
	const tools = $derived((live?.tools ?? []).filter((t) => t.status !== "done"));
	const forkAt = $derived(branch.parent?.at);
	const parent = $derived(space.branch(branch.parent?.conversationId ?? null));
	const children = $derived(client.tree.branches.filter((b) => b.parent?.conversationId === branch.id));

	let scroller = $state<HTMLElement>();
	let input = $state<HTMLTextAreaElement>();
	let stick = true;
	const onScroll = () => {
		if (scroller) stick = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
	};
	$effect(() => {
		void entries.length;
		void partial;
		if (stick) void tick().then(() => scroller?.scrollTo({ top: scroller.scrollHeight }));
	});
	$effect(() => {
		// A new branch (or a switch between branches) starts at the bottom, ready to type.
		void branch.id;
		untrack(() => {
			stick = true;
			void tick().then(() => {
				scroller?.scrollTo({ top: scroller.scrollHeight });
				if (matchMedia("(hover: hover)").matches) input?.focus();
			});
		});
	});

	let editing = $state(false);
	let titleDraft = $state("");

	// Grow out of the card on the canvas and shrink back into it.
	let shownId = untrack(() => branch.id);
	$effect(() => {
		shownId = branch.id;
	});
	const grow = (node: HTMLElement) => {
		const card = document.querySelector(`[data-card-id="${shownId}"]`)?.getBoundingClientRect();
		const box = node.getBoundingClientRect();
		if (card === undefined || card.width === 0 || box.width === 0 || matchMedia("(prefers-reduced-motion: reduce)").matches) {
			return { duration: 200, css: (t: number) => `opacity: ${t}` };
		}
		const sx = card.width / box.width;
		const sy = Math.min(card.height / box.height, 1);
		const dx = card.left - box.left;
		const dy = card.top - box.top;
		return {
			duration: 380,
			easing: cubicOut,
			css: (t: number, u: number) =>
				`transform-origin: 0 0; transform: translate(${dx * u}px, ${dy * u}px) scale(${sx + (1 - sx) * t}, ${sy + (1 - sy) * t}); opacity: ${0.35 + 0.65 * t}`,
		};
	};
</script>

<aside class="panel" style="--hue: {branchHue(branch.id)}" transition:grow aria-label="Branch {branch.title}">
	<header>
		<button class="icon back" onclick={() => space.focus(null)} title="Back to the canvas (Esc)" aria-label="Back to the canvas"><Icon name="back" size={18} /></button>
		<span class="dot" class:busy={branch.busy}></span>
		<div class="heading">
			{#if editing}
				<!-- svelte-ignore a11y_autofocus -->
				<input
					class="title-input"
					bind:value={titleDraft}
					autofocus
					onkeydown={(e) => {
						if (e.key === "Enter") {
							space.rename(branch.id, titleDraft);
							editing = false;
						} else if (e.key === "Escape") {
							e.stopPropagation();
							editing = false;
						}
					}}
					onblur={() => (editing = false)}
					aria-label="Branch title"
				/>
			{:else}
				<button class="title" title="Rename" onclick={() => ((titleDraft = branch.title), (editing = true))}>{branch.title}</button>
			{/if}
			<div class="sub">
				{#if parent}
					<button class="link" onclick={() => space.focus(parent.id)}><Icon name="branch" size={11} />from {parent.title}</button>
				{:else}
					<span>root thread</span>
				{/if}
				{#if children.length > 0}<span>· {children.length} branch{children.length === 1 ? "" : "es"} off it</span>{/if}
				{#if branch.costUsd > 0}<span>· ${branch.costUsd.toFixed(4)}</span>{/if}
			</div>
		</div>
		{#if branch.sharedIn > 0}<span class="chip shared" title="Shared notes this branch's model sees"><Icon name="sticky" size={12} />{branch.sharedIn}</span>{/if}
		<select value={branch.model ?? client.defaultModel} onchange={(e) => space.configure(branch.id, e.currentTarget.value)} title="Model for this branch" aria-label="Model">
			{#if branch.model && !client.models.includes(branch.model)}<option value={branch.model}>{branch.model}</option>{/if}
			{#each client.models as model (model)}<option value={model}>{model}</option>{/each}
		</select>
		<button class="icon" onclick={() => branch.tip !== null && space.fork(branch.id, branch.tip)} disabled={branch.tip === null} title="Branch from the latest message (B)" aria-label="Branch from the latest message"><Icon name="branch" /></button>
		<button class="icon" onclick={() => (space.sheet = { from: { conversationId: branch.id } })} title="Share this branch…" aria-label="Share this branch"><Icon name="share" /></button>
		<button class="icon close" onclick={() => space.focus(null)} title="Close (Esc)" aria-label="Close"><Icon name="close" /></button>
	</header>

	<div class="scroller" bind:this={scroller} onscroll={onScroll}>
		<div class="messages">
			{#if view === undefined}
				<div class="loading"><span></span><span></span><span></span></div>
			{:else if entries.length === 0 && !branch.busy}
				<p class="empty">An empty thread. Say something below; branch from any message later to explore a side question while this one keeps going.</p>
			{/if}
			{#each entries as entry (entry.id)}
				{@const node = nodeById.get(entry.id)}
				<ChatEntry
					{entry}
					{results}
					{node}
					inherited={entry.conversationId !== branch.id}
					branch={() => space.fork(branch.id, entry.id)}
					editBranch={node?.role === "user" && node.before !== undefined ? () => space.editBranch(node) : undefined}
					share={() => (space.sheet = { from: { conversationId: branch.id, at: entry.id } })}
				/>
				{#if forkAt !== undefined && entry.id === forkAt}
					<div class="fork-line"><span><Icon name="branch" size={12} />“{branch.title}” branches off here</span></div>
				{/if}
			{/each}
			{#if branch.busy}
				<div class="live">
					{#if partial !== ""}<div class="markdown">{@html renderMarkdown(partial)}</div>{/if}
					{#each tools as tool (tool.callId)}
						<div class="tool"><code>{tool.name}</code> running…{#if tool.output}<pre>{tool.output.slice(-1500)}</pre>{/if}</div>
					{/each}
					{#if live?.generation?.retry}<div class="retry">Retrying: {live.generation.retry.error}</div>{/if}
					<div class="typing"><span></span><span></span><span></span></div>
				</div>
			{/if}
		</div>
	</div>

	<footer>
		<Composer
			{branch}
			bind:value={() => space.composer[branch.id] ?? "", (v) => (space.composer[branch.id] = v)}
			bind:input
			send={(text, whenBusy) => ((stick = true), space.send(branch.id, text, whenBusy))}
			abort={() => space.abort(branch.id)}
		/>
		<div class="hint">Enter {branch.busy ? "queues" : "sends"} · Shift+Enter new line{branch.busy ? " · Alt+Enter steers" : ""}</div>
	</footer>
</aside>

<style>
	.panel {
		--hue-ink: hsl(var(--hue) 62% 52%);
		--hue-soft: hsl(var(--hue) 70% 50% / 0.13);
		position: absolute;
		top: 12px;
		right: 12px;
		bottom: 12px;
		width: min(700px, calc(100% - 420px));
		display: flex;
		flex-direction: column;
		background: var(--panel);
		border: 1px solid var(--card-line);
		border-radius: 22px;
		box-shadow: var(--shadow-panel);
		overflow: hidden;
		z-index: 20;
	}
	.panel::before {
		content: "";
		position: absolute;
		inset: 0 0 auto;
		height: 4px;
		background: var(--hue-ink);
	}
	header {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 14px 12px 12px 14px;
		border-bottom: 1px solid var(--line);
	}
	.dot {
		width: 11px;
		height: 11px;
		border-radius: 50%;
		background: var(--hue-ink);
		flex: none;
	}
	.dot.busy {
		animation: beat 1.1s ease-in-out infinite;
	}
	@keyframes beat {
		50% {
			box-shadow: 0 0 0 7px hsl(var(--hue) 70% 55% / 0);
		}
		0% {
			box-shadow: 0 0 0 0 hsl(var(--hue) 70% 55% / 0.55);
		}
	}
	.heading {
		flex: 1;
		min-width: 0;
	}
	.title,
	.title-input {
		display: block;
		max-width: 100%;
		font: inherit;
		font-size: 17px;
		font-weight: 680;
		letter-spacing: -0.015em;
		color: var(--ink);
		background: none;
		border: none;
		padding: 0;
		text-align: left;
		cursor: text;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.title-input {
		width: 100%;
		border-bottom: 2px solid var(--hue-ink);
		outline: none;
	}
	.sub {
		display: flex;
		gap: 5px;
		font-size: 12px;
		color: var(--ink-faint);
		white-space: nowrap;
		overflow: hidden;
	}
	.link {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		border: none;
		background: none;
		padding: 0;
		font: inherit;
		color: hsl(var(--hue) 50% var(--hue-text-l));
		cursor: pointer;
	}
	.link:hover {
		text-decoration: underline;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 12px;
		padding: 2px 8px;
		border-radius: 999px;
		flex: none;
	}
	.chip.shared {
		background: var(--sticky-soft);
		color: var(--sticky-ink);
	}
	select {
		max-width: 170px;
		height: 32px;
		padding: 0 8px;
		border-radius: 10px;
		border: 1px solid var(--line);
		background: var(--field);
		color: var(--ink);
		font: inherit;
		font-size: 12.5px;
		font-family: var(--mono);
	}
	.icon {
		display: grid;
		place-items: center;
		width: 34px;
		height: 34px;
		flex: none;
		border-radius: 10px;
		border: none;
		background: none;
		color: var(--ink-soft);
		cursor: pointer;
	}
	.icon:hover:not(:disabled) {
		background: var(--chip);
		color: var(--ink);
	}
	.icon:disabled {
		opacity: 0.4;
	}
	.back {
		display: none;
	}
	.scroller {
		flex: 1;
		overflow-y: auto;
		overscroll-behavior: contain;
	}
	.messages {
		max-width: 660px;
		margin: 0 auto;
		padding: 8px 24px 24px;
		font-size: 14.5px;
		line-height: 1.6;
	}
	.empty {
		color: var(--ink-soft);
		text-align: center;
		margin: 18vh auto 0;
		max-width: 360px;
	}
	.loading,
	.typing {
		display: flex;
		gap: 5px;
		padding: 10px 2px;
	}
	.loading {
		justify-content: center;
		margin-top: 20vh;
	}
	.loading span,
	.typing span {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--hue-ink);
		animation: blink 1s infinite;
	}
	.loading span:nth-child(2),
	.typing span:nth-child(2) {
		animation-delay: 0.2s;
	}
	.loading span:nth-child(3),
	.typing span:nth-child(3) {
		animation-delay: 0.4s;
	}
	@keyframes blink {
		50% {
			opacity: 0.2;
		}
	}
	.fork-line {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: 22px 0;
		color: var(--hue-ink);
		font-size: 12px;
		font-weight: 600;
	}
	.fork-line span {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 3px 10px;
		border-radius: 999px;
		background: var(--hue-soft);
	}
	.fork-line::before,
	.fork-line::after {
		content: "";
		flex: 1;
		border-top: 1.5px dashed currentColor;
		opacity: 0.5;
	}
	.live .markdown :global(p) {
		margin: 0.45em 0;
	}
	.tool,
	.retry {
		font-size: 13px;
		color: var(--ink-soft);
	}
	.tool pre {
		font-size: 12px;
		max-height: 160px;
		overflow: auto;
		background: var(--well);
		padding: 6px 8px;
		border-radius: 8px;
	}
	footer {
		padding: 10px 16px 12px;
		border-top: 1px solid var(--line);
		background: var(--panel);
	}
	footer > :global(.composer) {
		max-width: 660px;
		margin: 0 auto;
	}
	.hint {
		max-width: 660px;
		margin: 6px auto 0;
		font-size: 11px;
		color: var(--ink-faint);
		padding-left: 4px;
	}
	@media (max-width: 1100px) {
		.panel {
			width: min(620px, calc(100% - 300px));
		}
	}
	@media (max-width: 760px) {
		.panel {
			inset: 0;
			width: auto;
			border-radius: 0;
			border: none;
		}
		.back {
			display: grid;
			margin-left: -4px;
		}
		.close,
		.chip.shared {
			display: none;
		}
		select {
			max-width: 104px;
		}
		header {
			padding: 12px max(10px, env(safe-area-inset-right)) 10px max(8px, env(safe-area-inset-left));
			gap: 4px;
		}
		.messages {
			padding: 8px 16px 20px;
		}
		footer {
			padding: 8px 12px max(10px, env(safe-area-inset-bottom));
		}
		.hint {
			display: none;
		}
	}
</style>
