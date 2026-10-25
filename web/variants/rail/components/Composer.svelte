<script lang="ts">
	import { tick } from "svelte";
	import type { BranchInfo } from "../../../../shared/protocol.ts";
	import { branchHue } from "../../../src/lib/layout.ts";

	type Props = {
		branch: BranchInfo;
		models: readonly string[];
		draft: string;
		queued: number;
		send: (text: string, whenBusy: "followUp" | "steer") => Promise<void>;
		abort: () => void;
		configure: (model: string) => void;
	};
	let { branch, models, draft = $bindable(), queued, send, abort, configure }: Props = $props();

	let input: HTMLTextAreaElement | undefined = $state();
	let sending = $state(false);
	const empty = $derived(draft.trim() === "");

	// Grow with the text up to a third of the screen, then scroll.
	const fit = () => {
		if (input === undefined) return;
		input.style.height = "auto";
		input.style.height = `${Math.min(input.scrollHeight, innerHeight / 3)}px`;
	};
	$effect(() => {
		void draft;
		void tick().then(fit);
	});

	const submit = async (whenBusy: "followUp" | "steer") => {
		const text = draft.trim();
		if (text === "" || sending) return;
		sending = true;
		try {
			await send(text, whenBusy);
			draft = "";
		} finally {
			sending = false;
		}
	};

	const onKey = (event: KeyboardEvent) => {
		if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
			event.preventDefault();
			void submit(event.altKey && branch.busy ? "steer" : "followUp");
		} else if (event.key === "Escape") {
			input?.blur();
		}
	};
	const shortModel = (model: string) => model.split("/").at(-1) ?? model;
</script>

<div class="composer" style="--h: {branchHue(branch.id)}" class:busy={branch.busy}>
	<div class="card">
		<textarea
			id="composer"
			bind:this={input}
			bind:value={draft}
			onkeydown={onKey}
			rows="1"
			aria-label="Message"
			placeholder={branch.busy ? "Working… Enter queues a follow-up, Alt+Enter steers" : `Continue “${branch.title}”`}
		></textarea>
		<div class="bar">
			<label class="model" title="Model for this branch">
				<i></i>
				<span class="model-name">{shortModel(branch.model ?? "model")}</span>
				<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 4l3 3 3-3" /></svg>
				<select value={branch.model ?? ""} onchange={(e) => configure(e.currentTarget.value)} aria-label="Model for this branch">
					{#if branch.model && !models.includes(branch.model)}<option value={branch.model}>{branch.model}</option>{/if}
					{#each models as model (model)}<option value={model}>{model}</option>{/each}
				</select>
			</label>
			{#if branch.busy}
				<span class="status"><span class="spinner"></span>working{queued > 0 ? ` · ${queued} queued` : ""}</span>
			{:else}
				<span class="hint"><kbd>↵</kbd> send <kbd>⇧↵</kbd> newline</span>
			{/if}
			<span class="spacer"></span>
			{#if branch.busy}
				<button class="ghost" onclick={() => submit("steer")} disabled={empty} title="Join the running work after the current tool round (Alt+Enter)">Steer</button>
				<button class="ghost" onclick={() => submit("followUp")} disabled={empty} title="Run after the current work (Enter)">Queue</button>
				<button class="stop" onclick={abort} title="Stop the running work (x)"><span></span>Stop</button>
			{:else}
				<button class="send" onclick={() => submit("followUp")} disabled={empty || sending} aria-label="Send">
					<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" /></svg>
				</button>
			{/if}
		</div>
	</div>
</div>

<style>
	.composer {
		padding: 0 28px 18px;
		max-width: var(--measure);
		margin: 0 auto 0 var(--col-left);
		width: 100%;
		box-sizing: content-box;
	}
	.card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 16px;
		box-shadow: var(--shadow-lg);
		padding: 12px 12px 8px 16px;
		transition:
			border-color 0.15s,
			box-shadow 0.15s;
	}
	.card:focus-within {
		border-color: hsl(var(--h) var(--lane-s) var(--lane-l) / 0.6);
		box-shadow:
			var(--shadow-lg),
			0 0 0 3px hsl(var(--h) var(--lane-s) var(--lane-l) / 0.14);
	}
	textarea {
		display: block;
		width: 100%;
		box-sizing: border-box;
		resize: none;
		border: none;
		outline: none;
		background: none;
		color: var(--text);
		font: 400 16px/1.5 var(--sans);
		padding: 2px 0 8px;
		min-height: 30px;
	}
	textarea::placeholder {
		color: var(--text-3);
	}
	.bar {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}
	.model {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		max-width: 46%;
		padding: 4px 9px;
		border-radius: 999px;
		background: var(--surface-2);
		font: 500 12px var(--mono);
		color: var(--text-2);
		cursor: pointer;
	}
	.model:hover {
		color: var(--text);
	}
	.model i {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		flex: none;
		background: hsl(var(--h) var(--lane-s) var(--lane-l));
	}
	.model-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.model svg {
		width: 9px;
		height: 9px;
		flex: none;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
	}
	/* The native select sits invisibly on top: the platform picker, with the pill's look. */
	.model select {
		position: absolute;
		inset: 0;
		opacity: 0;
		cursor: pointer;
		width: 100%;
	}
	.hint,
	.status {
		font: 12px var(--sans);
		color: var(--text-3);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}
	kbd {
		font: 11px var(--mono);
		padding: 0 4px;
		border: 1px solid var(--border);
		border-radius: 4px;
		margin: 0 2px 0 6px;
	}
	.status {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--text-2);
	}
	.spinner {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		border: 1.5px solid hsl(var(--h) var(--lane-s) var(--lane-l) / 0.3);
		border-top-color: hsl(var(--h) var(--lane-s) var(--lane-l));
		animation: spin 0.8s linear infinite;
		flex: none;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.spacer {
		flex: 1;
	}
	button {
		font: 500 13px var(--sans);
		border-radius: 999px;
		cursor: pointer;
		border: 1px solid transparent;
		flex: none;
	}
	button:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.send {
		width: 32px;
		height: 32px;
		display: grid;
		place-items: center;
		padding: 0;
		background: hsl(var(--h) var(--lane-s) var(--lane-l));
		color: white;
	}
	.send svg {
		width: 16px;
		height: 16px;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.ghost {
		background: none;
		color: var(--text-2);
		padding: 5px 10px;
		border-color: var(--border);
	}
	.ghost:hover:not(:disabled) {
		color: var(--text);
		border-color: var(--border-strong);
	}
	.stop {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 5px 12px;
		background: var(--text);
		color: var(--bg);
	}
	.stop span {
		width: 8px;
		height: 8px;
		border-radius: 2px;
		background: currentColor;
	}
	@media (max-width: 640px) {
		.composer {
			padding: 0 10px 10px;
		}
		.hint {
			display: none;
		}
		.model {
			max-width: 38%;
		}
	}
</style>
