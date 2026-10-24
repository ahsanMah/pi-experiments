<script lang="ts">
	import type { BranchInfo, ShareMode } from "../../../shared/protocol.ts";
	import { untrack } from "svelte";
	import { branchHue } from "../lib/layout.ts";

	export type ShareRequest = { from?: { conversationId: number; at?: number } };

	type Props = {
		request: ShareRequest;
		branches: readonly BranchInfo[];
		submit: (share: { mode: ShareMode; to: number[] | "*"; title: string; text: string }) => Promise<void>;
		close: () => void;
	};
	let { request, branches, submit, close }: Props = $props();

	const source = $derived(branches.find((b) => b.id === request.from?.conversationId));
	// The dialog is opened per request, so its initial mode reads the request once.
	let mode = $state<ShareMode>(untrack(() => request.from) === undefined ? "note" : "summary");
	let everyone = $state(false);
	let targets = $state<Set<number>>(new Set());
	let title = $state("");
	let text = $state("");
	let busy = $state(false);
	let error = $state("");

	const candidates = $derived(branches.filter((b) => b.id !== request.from?.conversationId));
	const ready = $derived((everyone || targets.size > 0) && (mode !== "note" || text.trim() !== "") && !busy);

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
	<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="share-title">
		<h2 id="share-title">Share context</h2>
		{#if source}
			<p class="muted">From <strong>{source.title}</strong>{request.from?.at !== undefined ? " up to the selected message" : ""}.</p>
		{/if}

		<fieldset>
			<legend>What</legend>
			{#if request.from !== undefined}
				<label><input type="radio" bind:group={mode} value="summary" /> Summary <span class="muted">— a model condenses the branch</span></label>
				<label><input type="radio" bind:group={mode} value="transcript" /> Transcript <span class="muted">— the branch as text</span></label>
			{/if}
			<label><input type="radio" bind:group={mode} value="note" /> Note <span class="muted">— exactly what you write</span></label>
		</fieldset>

		<fieldset>
			<legend>To</legend>
			<label><input type="checkbox" bind:checked={everyone} /> Every branch, including future ones</label>
			{#if !everyone}
				<div class="targets">
					{#each candidates as branch (branch.id)}
						<label style="--hue: {branchHue(branch.id)}">
							<input type="checkbox" checked={targets.has(branch.id)} onchange={() => toggle(branch.id)} />
							<span class="dot"></span>{branch.title}
						</label>
					{/each}
					{#if candidates.length === 0}<p class="muted">No other branches yet. Branch first, or share with every branch.</p>{/if}
				</div>
			{/if}
		</fieldset>

		<label class="block">Title <input bind:value={title} placeholder="Optional" /></label>
		<label class="block">
			{mode === "note" ? "Note" : mode === "summary" ? "Focus (optional)" : "Transcript"}
			{#if mode !== "transcript"}
				<textarea bind:value={text} rows="5" placeholder={mode === "note" ? "What should the other branches know?" : "e.g. only the API decisions"}></textarea>
			{/if}
		</label>

		{#if error}<p class="error">{error}</p>{/if}
		<div class="row">
			<button onclick={close}>Cancel</button>
			<button class="primary" onclick={go} disabled={!ready}>{busy ? (mode === "summary" ? "Summarizing…" : "Sharing…") : "Share"}</button>
		</div>
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgb(0 0 0 / 0.35);
		display: grid;
		place-items: center;
		z-index: 50;
		padding: 16px;
	}
	.dialog {
		width: min(520px, 100%);
		max-height: 90vh;
		overflow: auto;
		background: var(--surface);
		color: var(--text);
		border-radius: 14px;
		padding: 18px 20px;
		box-shadow: 0 20px 50px rgb(0 0 0 / 0.25);
	}
	h2 {
		margin: 0 0 6px;
		font-size: 17px;
	}
	fieldset {
		border: 1px solid var(--border);
		border-radius: 10px;
		margin: 10px 0;
		padding: 8px 12px;
	}
	legend {
		font-size: 12px;
		color: var(--text-muted);
	}
	fieldset label {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 4px 0;
	}
	.targets {
		max-height: 180px;
		overflow: auto;
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: hsl(var(--hue) 60% 55%);
	}
	.block {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin: 10px 0;
		font-size: 13px;
	}
	.block input,
	.block textarea {
		font: inherit;
		padding: 6px 10px;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--bg);
		color: var(--text);
	}
	.muted {
		color: var(--text-muted);
		font-size: 12px;
	}
	.error {
		color: var(--danger);
	}
	.row {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}
</style>
