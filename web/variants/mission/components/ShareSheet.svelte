<script lang="ts">
	import { untrack } from "svelte";
	import type { BranchInfo, ShareMode, TreeNode } from "../../../../shared/protocol.ts";
	import { branchHue } from "../../../src/lib/layout.ts";

	export type ShareDraft = {
		from?: { conversationId: number; at?: number };
		mode?: ShareMode;
		to?: number[] | "*";
	};

	type Props = {
		draft: ShareDraft;
		branches: readonly BranchInfo[];
		nodes: readonly TreeNode[];
		submit: (share: { mode: ShareMode; to: number[] | "*"; title: string; text: string }) => Promise<void>;
		close: () => void;
	};
	let { draft, branches, nodes, submit, close }: Props = $props();

	// The sheet opens per request, so it reads its starting values once.
	const initial = untrack(() => draft);
	let mode = $state<ShareMode>(initial.mode ?? (initial.from === undefined ? "note" : "summary"));
	let everyone = $state(initial.to === "*");
	let targets = $state<Set<number>>(new Set(Array.isArray(initial.to) ? initial.to : []));
	let title = $state("");
	let text = $state("");
	let busy = $state(false);
	let error = $state("");

	const source = $derived(branches.find((b) => b.id === draft.from?.conversationId));
	const at = $derived(draft.from?.at === undefined ? undefined : nodes.find((n) => n.id === draft.from?.at));
	const candidates = $derived(branches.filter((b) => b.id !== draft.from?.conversationId));
	const ready = $derived((everyone || targets.size > 0) && (mode !== "note" || text.trim() !== "") && !busy);

	const toggle = (id: number) => {
		everyone = false;
		const next = new Set(targets);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		targets = next;
	};

	const go = async () => {
		if (!ready) return;
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

	const MODES: { value: ShareMode; label: string; help: string }[] = [
		{ value: "summary", label: "Summary", help: "The source branch's model condenses it up to this point." },
		{ value: "transcript", label: "Transcript", help: "The branch up to this point, verbatim as text." },
		{ value: "note", label: "Note", help: "Exactly what you write below." },
	];
	const modes = $derived(draft.from === undefined ? MODES.filter((m) => m.value === "note") : MODES);
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && close()} />

<div class="scrim" role="presentation" onclick={(e) => e.target === e.currentTarget && close()}>
	<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="share-title">
		<header>
			<h2 id="share-title">Share context</h2>
			{#if source}
				<p class="from">
					from <span class="chip" style="--hue: {branchHue(source.id)}"><span class="dot"></span>{source.title}</span>
					{#if at}<span class="at">up to “{at.preview.slice(0, 48)}{at.preview.length > 48 ? "…" : ""}”</span>{:else}<span class="at">up to its latest message</span>{/if}
				</p>
			{/if}
		</header>

		<div class="seg" role="radiogroup" aria-label="What to share">
			{#each modes as m (m.value)}
				<button role="radio" aria-checked={mode === m.value} class:on={mode === m.value} onclick={() => (mode = m.value)}>{m.label}</button>
			{/each}
		</div>
		<p class="help">{MODES.find((m) => m.value === mode)?.help}</p>

		<div class="field">
			<span class="label">To</span>
			<div class="targets">
				<button class="target all" class:on={everyone} onclick={() => ((everyone = !everyone), (targets = new Set()))} aria-pressed={everyone}>
					✦ Every branch <span class="faint">incl. future</span>
				</button>
				{#each candidates as branch (branch.id)}
					<button class="target" class:on={!everyone && targets.has(branch.id)} style="--hue: {branchHue(branch.id)}" onclick={() => toggle(branch.id)} aria-pressed={targets.has(branch.id)}>
						<span class="dot"></span>{branch.title}
					</button>
				{/each}
			</div>
		</div>

		<label class="field">
			<span class="label">Title</span>
			<input bind:value={title} placeholder="Optional — shown as the note's heading" />
		</label>
		{#if mode !== "transcript"}
			<label class="field">
				<span class="label">{mode === "note" ? "Note" : "Focus"}</span>
				<textarea
					bind:value={text}
					rows="4"
					placeholder={mode === "note" ? "What should the other branches know?" : "Optional — e.g. only the decisions about durability"}
					onkeydown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && void go()}
				></textarea>
			</label>
		{/if}

		{#if error}<p class="error">{error}</p>{/if}
		<footer>
			<span class="faint">Lands in each target's system prompt from its next model request.</span>
			<span class="spacer"></span>
			<button class="btn" onclick={close}>Cancel</button>
			<button class="btn primary" onclick={go} disabled={!ready}>{busy ? (mode === "summary" ? "Summarizing…" : "Sharing…") : "Share"}</button>
		</footer>
	</div>
</div>

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 85;
		display: grid;
		place-items: center;
		padding: 16px;
		background: var(--scrim);
		backdrop-filter: blur(2px);
	}
	.sheet {
		width: min(540px, 100%);
		max-height: calc(100vh - 32px);
		overflow: auto;
		box-sizing: border-box;
		padding: 18px 20px 16px;
		border-radius: 14px;
		background: var(--raised);
		box-shadow: var(--shadow-lg);
	}
	h2 {
		margin: 0;
		font-size: 15px;
		font-weight: 650;
	}
	.from {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		margin: 6px 0 0;
		color: var(--text-2);
		font-size: 12.5px;
	}
	.at {
		color: var(--text-3);
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 1px 8px;
		border-radius: 6px;
		background: var(--sunken);
		border: 1px solid var(--line);
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
	.seg {
		display: grid;
		grid-auto-flow: column;
		grid-auto-columns: 1fr;
		gap: 2px;
		margin-top: 16px;
		padding: 2px;
		border-radius: 9px;
		background: var(--sunken);
		border: 1px solid var(--line);
	}
	.seg button {
		height: 28px;
		border: none;
		border-radius: 7px;
		background: none;
		color: var(--text-2);
		font-size: 12.5px;
		font-weight: 550;
	}
	.seg button.on {
		background: var(--raised);
		color: var(--text);
		box-shadow: var(--shadow), 0 0 0 1px var(--line);
	}
	.help {
		margin: 6px 2px 0;
		font-size: 12px;
		color: var(--text-3);
	}
	.field {
		display: block;
		margin-top: 14px;
	}
	.label {
		display: block;
		margin-bottom: 6px;
		font-size: 11.5px;
		font-weight: 600;
		color: var(--text-2);
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
		height: 28px;
		padding: 0 10px;
		border-radius: 7px;
		border: 1px solid var(--line-strong);
		background: var(--raised);
		font-size: 12.5px;
	}
	.target:hover {
		background: var(--hover);
	}
	.target.on {
		border-color: var(--accent);
		background: var(--accent-soft);
		color: var(--text);
		box-shadow: 0 0 0 1px var(--accent) inset;
	}
	.faint {
		color: var(--text-3);
		font-size: 11.5px;
	}
	input,
	textarea {
		display: block;
		width: 100%;
		box-sizing: border-box;
		padding: 8px 10px;
		border: 1px solid var(--line-strong);
		border-radius: 8px;
		background: var(--bg);
		font-size: 13px;
		resize: vertical;
	}
	input:focus,
	textarea:focus {
		outline: none;
		border-color: var(--accent-line);
		box-shadow: 0 0 0 3px var(--accent-soft);
	}
	.error {
		color: var(--err);
		font-size: 12.5px;
	}
	footer {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 18px;
	}
	.spacer {
		flex: 1;
	}
	@media (max-width: 600px) {
		footer .faint {
			display: none;
		}
	}
</style>
