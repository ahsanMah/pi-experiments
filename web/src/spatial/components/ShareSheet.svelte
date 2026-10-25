<script lang="ts">
	// Share a branch (summary or transcript up to a point) or a note into chosen branches. The
	// result lands on the canvas as a sticky wired to its targets.
	import { untrack } from "svelte";
	import type { ShareMode } from "../../../../shared/protocol.ts";
	import { branchHue } from "../../lib/layout.ts";
	import { useSpace, type ShareRequest } from "../lib/space.svelte.ts";
	import Icon from "./Icon.svelte";

	let { request }: { request: ShareRequest } = $props();
	const space = useSpace();

	const source = $derived(space.branch(request.from?.conversationId ?? null));
	const at = $derived(request.from?.at === undefined ? undefined : space.client.tree.nodes.find((n) => n.id === request.from!.at));
	// The sheet opens per request, so its starting choices read the request once.
	let mode = $state<ShareMode>(untrack(() => request.from) === undefined ? "note" : "summary");
	let everyone = $state(false);
	let targets = $state<Set<number>>(new Set(untrack(() => request.to) ?? []));
	let title = $state("");
	let text = $state("");
	let error = $state("");
	let busy = $state(false);

	const candidates = $derived(space.client.tree.branches.filter((b) => b.id !== request.from?.conversationId));
	const ready = $derived((everyone || targets.size > 0) && (mode !== "note" || text.trim() !== "") && !busy);

	const toggle = (id: number) => {
		const next = new Set(targets);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		targets = next;
	};
	const close = () => (space.sheet = undefined);

	const go = async () => {
		busy = true;
		error = "";
		const share = { mode, to: everyone ? ("*" as const) : [...targets], title, text, ...(request.from ? { from: request.from } : {}) };
		// Summaries take a model call: close now and let the placeholder sticky show progress.
		if (mode === "summary") {
			close();
			space.share(share).catch((e: unknown) => space.notify(e instanceof Error ? e.message : String(e)));
			return;
		}
		try {
			await space.share(share);
			close();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	};

	const modes: { id: ShareMode; label: string; hint: string }[] = [
		{ id: "summary", label: "Summary", hint: "The branch's model condenses it" },
		{ id: "transcript", label: "Transcript", hint: "The branch as text, verbatim" },
		{ id: "note", label: "Note", hint: "Exactly what you write" },
	];
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && close()} />

<div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && close()}>
	<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="share-title">
		<div class="head">
			<span class="badge"><Icon name="sticky" size={16} /></span>
			<div>
				<h2 id="share-title">Share context</h2>
				{#if source}
					<p class="from" style="--hue: {branchHue(source.id)}">
						<i></i>from <strong>{source.title}</strong>{#if at} up to “{at.preview.slice(0, 60)}{at.preview.length > 60 ? "…" : ""}”{/if}
					</p>
				{:else}
					<p class="from">A sticky note the chosen branches' models will see.</p>
				{/if}
			</div>
			<button class="x" onclick={close} aria-label="Close"><Icon name="close" /></button>
		</div>

		<div class="modes" role="radiogroup" aria-label="What to share">
			{#each modes.filter((m) => request.from !== undefined || m.id === "note") as m (m.id)}
				<button role="radio" aria-checked={mode === m.id} class:on={mode === m.id} onclick={() => (mode = m.id)}>
					<strong>{m.label}</strong><span>{m.hint}</span>
				</button>
			{/each}
		</div>

		<div class="section-label">Into</div>
		<div class="targets">
			<button class="target all" class:on={everyone} onclick={() => (everyone = !everyone)} aria-pressed={everyone}>
				<Icon name="globe" size={13} />Every branch, now and later
			</button>
			{#if !everyone}
				{#each candidates as branch (branch.id)}
					<button class="target" class:on={targets.has(branch.id)} style="--hue: {branchHue(branch.id)}" onclick={() => toggle(branch.id)} aria-pressed={targets.has(branch.id)}>
						<i></i>{branch.title}
					</button>
				{/each}
			{/if}
		</div>
		{#if !everyone && candidates.length === 0}<p class="muted">No other branches yet: branch first, or share with every branch.</p>{/if}

		<input bind:value={title} placeholder={mode === "note" ? "Title (optional)" : `Title (default: ${mode === "summary" ? "Summary" : "Transcript"} of “${source?.title ?? ""}”)`} aria-label="Title" />
		{#if mode !== "transcript"}
			<textarea bind:value={text} rows="4" placeholder={mode === "note" ? "What should the other branches know?" : "Focus for the summary (optional), e.g. only the API decisions"} aria-label={mode === "note" ? "Note" : "Summary focus"}></textarea>
		{/if}

		{#if error}<p class="error">{error}</p>{/if}
		<div class="foot">
			<span class="muted">Lands as a sticky, and in each target's system prompt from its next request.</span>
			<button class="primary" onclick={go} disabled={!ready}>{busy ? "Sharing…" : "Share"}</button>
		</div>
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 50;
		display: grid;
		place-items: center;
		padding: 16px;
		background: var(--scrim);
		backdrop-filter: blur(3px);
		animation: fade 0.18s ease-out;
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
	.sheet {
		width: min(540px, 100%);
		max-height: calc(100vh - 32px);
		overflow: auto;
		box-sizing: border-box;
		padding: 18px 20px 16px;
		border-radius: 20px;
		background: var(--panel);
		color: var(--ink);
		border: 1px solid var(--card-line);
		box-shadow: var(--shadow-panel);
		animation: rise 0.25s cubic-bezier(0.2, 0.9, 0.3, 1.1);
	}
	@keyframes rise {
		from {
			transform: translateY(14px) scale(0.98);
			opacity: 0;
		}
	}
	.head {
		display: flex;
		gap: 12px;
		align-items: flex-start;
	}
	.head > div {
		flex: 1;
		min-width: 0;
	}
	.badge {
		display: grid;
		place-items: center;
		width: 36px;
		height: 36px;
		border-radius: 10px;
		background: var(--sticky);
		color: var(--sticky-ink);
		flex: none;
		transform: rotate(-4deg);
	}
	h2 {
		margin: 0;
		font-size: 17px;
		letter-spacing: -0.01em;
	}
	.from {
		margin: 2px 0 0;
		font-size: 12.5px;
		color: var(--ink-soft);
		overflow-wrap: anywhere;
	}
	.from i {
		display: inline-block;
		width: 8px;
		height: 8px;
		margin-right: 6px;
		border-radius: 50%;
		background: hsl(var(--hue, 40) 62% 52%);
	}
	.x {
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		border: none;
		border-radius: 9px;
		background: none;
		color: var(--ink-soft);
		cursor: pointer;
	}
	.x:hover {
		background: var(--chip);
	}
	.modes {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
		gap: 8px;
		margin: 16px 0 14px;
	}
	.modes button {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
		padding: 10px 12px;
		border-radius: 12px;
		border: 1.5px solid var(--line);
		background: var(--field);
		color: var(--ink);
		text-align: left;
		cursor: pointer;
		font: inherit;
	}
	.modes button span {
		font-size: 11.5px;
		color: var(--ink-faint);
		line-height: 1.3;
	}
	.modes button.on {
		border-color: var(--ink);
		background: var(--panel);
		box-shadow: 0 0 0 3px var(--accent-ring);
	}
	.section-label {
		font-size: 11px;
		font-weight: 650;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--ink-faint);
		margin-bottom: 6px;
	}
	.targets {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: 14px;
	}
	.target {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 30px;
		padding: 0 12px;
		border-radius: 999px;
		border: 1.5px solid var(--line);
		background: var(--field);
		color: var(--ink-soft);
		font: inherit;
		font-size: 13px;
		cursor: pointer;
	}
	.target i {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: hsl(var(--hue) 62% 52%);
	}
	.target.on {
		color: var(--ink);
		border-color: hsl(var(--hue, 220) 62% 52%);
		background: hsl(var(--hue, 220) 70% 50% / 0.12);
	}
	.target.all.on {
		border-color: var(--sticky-ink);
		background: var(--sticky-soft);
		color: var(--sticky-ink);
	}
	input,
	textarea {
		display: block;
		box-sizing: border-box;
		width: 100%;
		margin-bottom: 8px;
		padding: 9px 12px;
		border-radius: 12px;
		border: 1px solid var(--line);
		background: var(--field);
		color: var(--ink);
		font: inherit;
		font-size: 14px;
		resize: vertical;
	}
	input:focus,
	textarea:focus {
		outline: none;
		border-color: var(--accent);
		box-shadow: 0 0 0 3px var(--accent-ring);
	}
	.foot {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-top: 6px;
	}
	.foot .muted {
		flex: 1;
	}
	.muted {
		font-size: 12px;
		color: var(--ink-faint);
	}
	.error {
		color: var(--danger);
		font-size: 13px;
	}
	.primary {
		height: 36px;
		padding: 0 18px;
		border-radius: 11px;
		border: none;
		background: var(--ink);
		color: var(--paper);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}
	.primary:disabled {
		opacity: 0.4;
		cursor: default;
	}
</style>
