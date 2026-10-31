<script lang="ts" module>
	import type { ShareMode } from "../../../../shared/protocol.ts";

	export type ShareRequest = {
		/** Source branch and point, for summary and transcript. */
		from?: { conversationId: number; at?: number };
		/** Targets chosen up front: a drop onto a column, or the tray's "+ note". */
		to?: number[];
	};
	export type ShareChoice = { mode: ShareMode; to: number[] | "*"; title: string; text: string };
</script>

<script lang="ts">
	import { untrack } from "svelte";
	import type { BranchInfo } from "../../../../shared/protocol.ts";
	import { branchHue } from "../../../src/lib/layout.ts";
	import type { Ordered } from "../lib.ts";
	import Icon from "./Icon.svelte";

	type Props = {
		request: ShareRequest;
		ordered: readonly Ordered[];
		/** Preview of the message the share is taken up to. */
		upTo: string;
		submit: (share: ShareChoice) => Promise<void>;
		close: () => void;
	};
	let { request, ordered, upTo, submit, close }: Props = $props();

	// The sheet opens per request, so its initial choices read the request once.
	const initial = untrack(() => request);
	let mode = $state<ShareMode>(initial.from === undefined ? "note" : "summary");
	let everyone = $state(false);
	let targets = $state<Set<number>>(new Set(initial.to ?? []));
	let title = $state("");
	let text = $state("");
	let busy = $state(false);
	let error = $state("");

	const source = $derived(ordered.find((o) => o.branch.id === request.from?.conversationId)?.branch);
	const candidates = $derived(ordered.filter((o) => o.branch.id !== request.from?.conversationId));
	const ready = $derived((everyone || targets.size > 0) && (mode !== "note" || text.trim() !== "") && !busy);
	const modes: { id: ShareMode; label: string; hint: string }[] = [
		{ id: "summary", label: "Summary", hint: "A model condenses the branch up to here" },
		{ id: "transcript", label: "Transcript", hint: "The branch up to here, verbatim" },
		{ id: "note", label: "Note", hint: "Exactly what you write" },
	];

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
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && close()} />

<div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && close()}>
	<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="share-title">
		<div class="head">
			<Icon name="share" size={18} />
			<h2 id="share-title">Share context</h2>
			<button class="icon" onclick={close} aria-label="Close"><Icon name="close" /></button>
		</div>
		{#if source}
			<div class="source" style="--hue: {branchHue(source.id)}">
				<span class="dot"></span>
				<span><strong>{source.title}</strong>{#if upTo}{" "}<span class="upto">up to “{upTo}”</span>{/if}</span>
			</div>
		{/if}

		<div class="label">What the other branches get</div>
		<div class="modes" role="radiogroup" aria-label="What to share">
			{#each modes as m (m.id)}
				{#if m.id === "note" || request.from !== undefined}
					<label class="mode" class:on={mode === m.id}>
						<input type="radio" bind:group={mode} value={m.id} />
						<strong>{m.label}</strong>
						<span>{m.hint}</span>
					</label>
				{/if}
			{/each}
		</div>

		<div class="label">Into</div>
		<div class="targets">
			<button class="target all" class:on={everyone} onclick={() => (everyone = !everyone)} aria-pressed={everyone}>Every branch <span>incl. future ones</span></button>
			{#each candidates as { branch } (branch.id)}
				<button
					class="target"
					class:on={everyone || targets.has(branch.id)}
					disabled={everyone}
					style="--hue: {branchHue(branch.id)}"
					onclick={() => toggle(branch.id)}
					aria-pressed={targets.has(branch.id)}
				>
					<span class="dot"></span>{branch.title}
				</button>
			{/each}
		</div>

		<label class="field">
			<span>Title</span>
			<input bind:value={title} placeholder="Optional" />
		</label>
		{#if mode !== "transcript"}
			<label class="field">
				<span>{mode === "note" ? "Note" : "Focus (optional)"}</span>
				<textarea bind:value={text} rows="4" placeholder={mode === "note" ? "What should the other branches know?" : "e.g. only the decisions about durability"}></textarea>
			</label>
		{/if}

		{#if error}<p class="error">{error}</p>{/if}
		<div class="actions">
			<span class="hint">Lands in each target's system prompt from its next model request.</span>
			<button onclick={close}>Cancel</button>
			<button class="primary" onclick={go} disabled={!ready}>{busy ? (mode === "summary" ? "Summarizing…" : "Sharing…") : "Share"}</button>
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
		background: rgb(10 10 8 / 0.38);
		backdrop-filter: blur(3px);
	}
	.sheet {
		width: min(540px, 100%);
		max-height: calc(100vh - 32px);
		overflow: auto;
		box-sizing: border-box;
		padding: 16px 18px 14px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 16px;
		box-shadow: var(--shadow-lift);
	}
	.head {
		display: flex;
		align-items: center;
		gap: 8px;
		color: var(--accent);
	}
	h2 {
		flex: 1;
		margin: 0;
		font-size: 16px;
		color: var(--text);
	}
	.source {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 10px 0 2px;
		padding: 8px 10px;
		border-radius: 10px;
		background: var(--surface-2);
		font-size: 13px;
		border-left: 3px solid var(--c);
	}
	.upto {
		color: var(--text-muted);
	}
	.label {
		margin: 14px 0 6px;
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-faint);
	}
	.modes {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: 6px;
	}
	.mode {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 8px 10px;
		border: 1px solid var(--border);
		border-radius: 10px;
		cursor: pointer;
		font-size: 13px;
	}
	.mode span {
		font-size: 11.5px;
		color: var(--text-muted);
	}
	.mode.on {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.mode input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}
	.mode:has(input:focus-visible) {
		outline: 2px solid var(--accent);
	}
	.targets {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.target {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12.5px;
		border-radius: 999px;
		padding: 3px 11px 3px 9px;
	}
	.target.on {
		border-color: var(--c, var(--accent));
		background: var(--c-soft, var(--accent-soft));
	}
	.target.all span {
		color: var(--text-muted);
		font-size: 11px;
	}
	.target:disabled {
		opacity: 0.6;
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--c);
		flex: none;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-top: 12px;
		font-size: 12px;
		color: var(--text-muted);
	}
	.field input,
	.field textarea {
		padding: 7px 10px;
		border-radius: 9px;
		border: 1px solid var(--border-strong);
		background: var(--surface-2);
		color: var(--text);
		font-size: 13.5px;
		resize: vertical;
	}
	.error {
		color: var(--danger);
		font-size: 13px;
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 14px;
	}
	.hint {
		flex: 1;
		font-size: 11.5px;
		color: var(--text-faint);
	}
</style>
