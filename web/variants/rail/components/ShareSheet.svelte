<script lang="ts">
	import { untrack } from "svelte";
	import type { BranchInfo, ShareMode } from "../../../../shared/protocol.ts";
	import { branchHue } from "../../../src/lib/layout.ts";

	export type ShareRequest = { from?: { conversationId: number; at?: number }; preview?: string };

	type Props = {
		request: ShareRequest;
		branches: readonly BranchInfo[];
		submit: (share: { mode: ShareMode; to: number[] | "*"; title: string; text: string }) => Promise<void>;
		close: () => void;
	};
	let { request, branches, submit, close }: Props = $props();

	const source = $derived(branches.find((b) => b.id === request.from?.conversationId));
	// The sheet is opened per request, so its initial mode reads the request once.
	let mode = $state<ShareMode>(untrack(() => request.from) === undefined ? "note" : "summary");
	let everyone = $state(false);
	let targets = $state<Set<number>>(new Set());
	let title = $state("");
	let text = $state("");
	let busy = $state(false);
	let error = $state("");
	let textarea: HTMLTextAreaElement | undefined = $state();

	const candidates = $derived(branches.filter((b) => b.id !== request.from?.conversationId));
	const ready = $derived((everyone || targets.size > 0) && (mode !== "note" || text.trim() !== "") && !busy);
	const modes = $derived<{ id: ShareMode; label: string; hint: string }[]>([
		...(request.from !== undefined
			? [
					{ id: "summary" as const, label: "Summary", hint: "A model condenses the branch up to here" },
					{ id: "transcript" as const, label: "Transcript", hint: "The branch up to here, as text" },
				]
			: []),
		{ id: "note", label: "Note", hint: "Exactly what you write" },
	]);

	const toggle = (id: number) => {
		const next = new Set(targets);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		targets = next;
	};

	const go = async () => {
		busy = true;
		error = "";
		try {
			await submit({ mode, to: everyone ? "*" : [...targets], title, text });
			close();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	};
	$effect(() => {
		if (mode === "note") textarea?.focus();
	});
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && close()} />

<div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && close()}>
	<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="share-title">
		<header>
			<h2 id="share-title">Share context</h2>
			{#if source}
				<p class="from" style="--h: {branchHue(source.id)}"><i></i>From <strong>{source.title}</strong>{request.from?.at !== undefined ? ", up to the selected message" : ""}</p>
			{:else}
				<p class="from">A note that lands in the system prompt of the branches you pick.</p>
			{/if}
		</header>

		{#if modes.length > 1}
			<div class="segmented" role="radiogroup" aria-label="What to share">
				{#each modes as option (option.id)}
					<button role="radio" aria-checked={mode === option.id} class:on={mode === option.id} onclick={() => (mode = option.id)}>{option.label}</button>
				{/each}
			</div>
			<p class="hint">{modes.find((m) => m.id === mode)?.hint}</p>
		{/if}

		<div class="section-label">Deliver to</div>
		<div class="targets">
			<button class="target all" class:on={everyone} onclick={() => (everyone = !everyone)} aria-pressed={everyone}>
				<span class="check"></span>Every branch, including future ones
			</button>
			{#each candidates as branch (branch.id)}
				<button
					class="target"
					class:on={everyone || targets.has(branch.id)}
					disabled={everyone}
					style="--h: {branchHue(branch.id)}"
					onclick={() => toggle(branch.id)}
					aria-pressed={everyone || targets.has(branch.id)}
				>
					<i></i>{branch.title}
				</button>
			{/each}
		</div>

		<label class="field">
			<span>Title</span>
			<input bind:value={title} placeholder="Optional" />
		</label>
		{#if mode !== "transcript"}
			<label class="field">
				<span>{mode === "note" ? "Note" : "Focus"}</span>
				<textarea bind:this={textarea} bind:value={text} rows="4" placeholder={mode === "note" ? "What should the other branches know?" : "Optional, e.g. only the API decisions"}></textarea>
			</label>
		{/if}

		{#if error}<p class="error">{error}</p>{/if}
		<footer>
			<button class="plain" onclick={close}>Cancel</button>
			<button class="go" onclick={go} disabled={!ready}>{busy ? (mode === "summary" ? "Summarizing…" : "Sharing…") : "Share"}</button>
		</footer>
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
		animation: fade 0.15s ease-out;
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
	@keyframes rise {
		from {
			transform: translateY(12px);
			opacity: 0;
		}
	}
	.sheet {
		width: min(520px, 100%);
		max-height: calc(100dvh - 32px);
		overflow: auto;
		box-sizing: border-box;
		background: var(--surface);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: 18px;
		padding: 22px 22px 18px;
		box-shadow: var(--shadow-xl);
		font: 14px var(--sans);
		animation: rise 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
	}
	h2 {
		margin: 0;
		font: 650 19px var(--sans);
		letter-spacing: -0.015em;
	}
	.from {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 6px 0 16px;
		color: var(--text-2);
		font-size: 13px;
	}
	.from i {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: hsl(var(--h) var(--lane-s) var(--lane-l));
		flex: none;
	}
	.segmented {
		display: flex;
		padding: 3px;
		gap: 2px;
		background: var(--surface-2);
		border-radius: 10px;
	}
	.segmented button {
		flex: 1;
		border: none;
		background: none;
		padding: 6px 0;
		border-radius: 8px;
		font: 500 13px var(--sans);
		color: var(--text-2);
		cursor: pointer;
	}
	.segmented button.on {
		background: var(--surface);
		color: var(--text);
		box-shadow: var(--shadow-xs);
	}
	.hint {
		margin: 8px 2px 16px;
		font-size: 12px;
		color: var(--text-3);
	}
	.section-label,
	.field span {
		display: block;
		font: 600 11px var(--mono);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-3);
		margin-bottom: 8px;
	}
	.targets {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: 16px;
	}
	.target {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		padding: 5px 11px;
		border-radius: 999px;
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text-2);
		font: 500 13px var(--sans);
		cursor: pointer;
	}
	.target:disabled {
		cursor: default;
	}
	.target i {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: hsl(var(--h) var(--lane-s) var(--lane-l));
	}
	.target.on {
		color: var(--text);
		border-color: hsl(var(--h, 0) var(--lane-s) var(--lane-l) / 0.6);
		background: hsl(var(--h, 0) var(--lane-s) var(--lane-l) / 0.1);
	}
	.target.all {
		width: 100%;
		justify-content: flex-start;
	}
	.target.all.on {
		border-color: var(--text-2);
		background: var(--surface-2);
	}
	.check {
		width: 14px;
		height: 14px;
		border-radius: 4px;
		border: 1.5px solid var(--border-strong);
		box-sizing: border-box;
	}
	.target.all.on .check {
		background: var(--text);
		border-color: var(--text);
		box-shadow: inset 0 0 0 2px var(--surface);
	}
	.field {
		display: block;
		margin-bottom: 14px;
	}
	.field input,
	.field textarea {
		display: block;
		width: 100%;
		box-sizing: border-box;
		font: 14px/1.5 var(--sans);
		padding: 8px 12px;
		border-radius: 10px;
		border: 1px solid var(--border);
		background: var(--bg);
		color: var(--text);
		resize: vertical;
	}
	.field input:focus,
	.field textarea:focus {
		outline: none;
		border-color: var(--border-strong);
		box-shadow: 0 0 0 3px var(--ring);
	}
	.error {
		color: var(--danger);
		font-size: 13px;
	}
	footer {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}
	footer button {
		font: 500 14px var(--sans);
		padding: 8px 16px;
		border-radius: 10px;
		cursor: pointer;
		border: 1px solid transparent;
	}
	.plain {
		background: none;
		color: var(--text-2);
	}
	.plain:hover {
		color: var(--text);
	}
	.go {
		background: var(--text);
		color: var(--bg);
	}
	.go:disabled {
		opacity: 0.35;
		cursor: default;
	}
</style>
