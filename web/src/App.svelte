<script lang="ts">
	import { SvelteFlowProvider } from "@xyflow/svelte";
	import type { ShareMode, TreeNode } from "../../shared/protocol.ts";
	import Canvas from "./components/Canvas.svelte";
	import Chat from "./components/Chat.svelte";
	import ShareDialog, { type ShareRequest } from "./components/ShareDialog.svelte";
	import Sidebar from "./components/Sidebar.svelte";
	import type { BranchesClient } from "./lib/client.svelte.ts";

	let { client, demo = false }: { client: BranchesClient; demo?: boolean } = $props();

	const fromHash = () => {
		const match = /b=(\d+)/.exec(location.hash);
		return match ? Number(match[1]) : undefined;
	};
	let activeId = $state<number | undefined>(fromHash());
	let focusId = $state<number | null>(null);
	let drafts = $state<Record<number, string>>({});
	let shareRequest = $state<ShareRequest | undefined>();
	type OverviewMode = "side" | "full" | "hidden";
	// Layout preferences are per-viewer conveniences; storage may be unavailable (private windows, sandboxes).
	const stored = (key: string): string | null => {
		try {
			return localStorage.getItem(key);
		} catch {
			return null;
		}
	};
	let overview = $state<OverviewMode>((stored("overview") as OverviewMode | null) ?? "side");
	let panelWidth = $state(Number(stored("panelWidth") ?? 460));
	// Follow an explicit data-theme on the root (set by a host page), else the system setting.
	const query = matchMedia("(prefers-color-scheme: dark)");
	const readTheme = () => {
		const explicit = document.documentElement.dataset.theme;
		return explicit === "dark" || (explicit !== "light" && query.matches);
	};
	let dark = $state(readTheme());
	$effect(() => {
		const update = () => (dark = readTheme());
		query.addEventListener("change", update);
		const observer = new MutationObserver(update);
		observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
		return () => {
			query.removeEventListener("change", update);
			observer.disconnect();
		};
	});
	$effect(() => {
		try {
			localStorage.setItem("overview", overview);
			localStorage.setItem("panelWidth", String(panelWidth));
		} catch {}
	});

	// Default to the first branch; keep the URL pointing at the open one.
	$effect(() => {
		if (activeId === undefined || !client.tree.branches.some((b) => b.id === activeId)) {
			const first = client.tree.branches[0];
			if (first !== undefined) activeId = first.id;
		}
	});
	$effect(() => {
		try {
			if (activeId !== undefined) history.replaceState(null, "", `#b=${activeId}`);
		} catch {
			// Sandboxed frames may refuse URL changes; the open branch just isn't kept in the URL.
		}
		client.watch(activeId === undefined ? [] : [activeId]);
	});

	const active = $derived(client.tree.branches.find((b) => b.id === activeId));

	const open = (id: number, entry: number | null = null) => {
		activeId = id;
		focusId = entry;
	};

	const openNode = (node: TreeNode) => {
		// A node is visible in every branch that inherits it; stay in the current branch when it does.
		const view = activeId === undefined ? undefined : client.views[activeId];
		const inActive = view?.entries.some((e) => e.id === node.id) ?? false;
		open(inActive && activeId !== undefined ? activeId : node.conversationId, node.id);
	};

	const fork = async (conversationId: number, at: number, draft = "") => {
		const { conversationId: id } = await client.request<{ conversationId: number }>({ t: "fork", conversationId, at });
		drafts[id] = draft;
		open(id);
	};

	const branchAfter = (node: TreeNode) => void fork(node.conversationId, node.id);
	const editBranch = (node: TreeNode) => {
		if (node.before === undefined) return;
		void fork(node.conversationId, node.before, node.preview.endsWith("…") ? "" : node.preview);
	};
	const shareFrom = (conversationId: number, at?: number) => {
		shareRequest = { from: { conversationId, ...(at !== undefined ? { at } : {}) } };
	};

	const send = async (text: string, whenBusy: "followUp" | "steer") => {
		if (activeId === undefined) return;
		focusId = null;
		await client.request({ t: "send", conversationId: activeId, text, whenBusy });
	};

	const share = async (share: { mode: ShareMode; to: number[] | "*"; title: string; text: string }) => {
		await client.request({
			t: "share",
			mode: share.mode,
			to: share.to,
			...(shareRequest?.from !== undefined ? { from: shareRequest.from } : {}),
			...(share.title.trim() !== "" ? { title: share.title } : {}),
			...(share.text.trim() !== "" ? { text: share.text } : {}),
		});
	};

	const onKey = (event: KeyboardEvent) => {
		if (event.altKey && event.key.toLowerCase() === "o") {
			event.preventDefault();
			overview = overview === "side" ? "full" : overview === "full" ? "hidden" : "side";
		}
	};

	let dragging = false;
	const startDrag = (event: PointerEvent) => {
		dragging = true;
		(event.target as HTMLElement).setPointerCapture(event.pointerId);
	};
	const drag = (event: PointerEvent) => {
		if (dragging) panelWidth = Math.min(Math.max(innerWidth - event.clientX, 280), innerWidth - 420);
	};
</script>

<svelte:window onkeydown={onKey} />

{#if demo}
	<div class="demo-banner">
		Demo: the branches server runs inside this page with an offline echo model, and nothing is saved.
		<a href="https://github.com/ahsanMah/pi-experiments" target="_blank" rel="noreferrer noopener">Run it with real models</a>
	</div>
{/if}

<div class="app" class:full={overview === "full"} class:hidden={overview === "hidden"} style="--panel: {panelWidth}px">
	<div class="sidebar">
		<Sidebar
			tree={client.tree}
			{activeId}
			select={(id) => open(id)}
			create={async () => {
				const { conversationId } = await client.request<{ conversationId: number }>({ t: "new" });
				open(conversationId);
			}}
			forkTip={() => active && active.tip !== null && fork(active.id, active.tip)}
			newNote={() => (shareRequest = {})}
			unshare={(noteId) => void client.request({ t: "unshare", noteId })}
		/>
	</div>

	<main class="main">
		{#if client.tree.branches.length > 1}
			<label class="mobile-branches">
				<span>Branch</span>
				<select id="mobile-branch" value={activeId} onchange={(e) => open(Number(e.currentTarget.value))}>
					{#each client.tree.branches as branch (branch.id)}
						<option value={branch.id}>{branch.busy ? "● " : ""}{branch.title}</option>
					{/each}
				</select>
			</label>
		{/if}
		{#if active}
			{#key active.id}
				<Chat
					branch={active}
					view={client.views[active.id]}
					nodes={client.tree.nodes}
					models={client.models}
					{focusId}
					bind:draft={() => drafts[active.id] ?? "", (value) => (drafts[active.id] = value)}
					{send}
					abort={() => void client.request({ t: "abort", conversationId: active.id })}
					branchAfter={(at) => void fork(active.id, at)}
					{editBranch}
					share={(at) => shareFrom(active.id, at)}
					rename={(title) => void client.request({ t: "rename", conversationId: active.id, title })}
					configure={(model) => void client.request({ t: "configure", conversationId: active.id, model })}
				/>
			{/key}
		{:else}
			<div class="connecting">{client.connected ? "Loading…" : "Connecting to the branches server…"}</div>
		{/if}
	</main>

	{#if overview !== "hidden"}
		<div class="resizer" role="separator" aria-orientation="vertical" onpointerdown={startDrag} onpointermove={drag} onpointerup={() => (dragging = false)}></div>
	{/if}
	<section class="overview" aria-label="Branch overview">
		<div class="overview-bar">
			<strong>Overview</strong>
			<span class="muted">{client.tree.branches.length} branches · {client.tree.nodes.length} messages</span>
			<span class="spacer"></span>
			<button onclick={() => (overview = overview === "full" ? "side" : "full")} title="Alt+O cycles side, full, hidden">{overview === "full" ? "Side" : "Full"}</button>
			<button onclick={() => (overview = "hidden")}>Hide</button>
		</div>
		{#if overview !== "hidden"}
			<div class="flow">
				<SvelteFlowProvider>
					<Canvas
						tree={client.tree}
						{activeId}
						{focusId}
						{dark}
						open={(node) => {
							openNode(node);
							if (overview === "full") overview = "side";
						}}
						branch={branchAfter}
						{editBranch}
						share={(node) => shareFrom(node.conversationId, node.id)}
					/>
				</SvelteFlowProvider>
			</div>
		{/if}
	</section>

	{#if overview === "hidden"}
		<button class="show-overview" onclick={() => (overview = "side")} title="Alt+O">Overview</button>
	{/if}
</div>

{#if shareRequest}
	<ShareDialog request={shareRequest} branches={client.tree.branches} submit={share} close={() => (shareRequest = undefined)} />
{/if}

{#if client.errors.length > 0}
	<div class="toasts">
		{#each client.errors as error, index (index)}
			<button class="toast" onclick={() => client.dismissError(index)}>{error}</button>
		{/each}
	</div>
{/if}

<style>
	.app {
		display: grid;
		grid-template-columns: 240px minmax(0, 1fr) 6px var(--panel);
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}
	.main {
		display: flex;
		flex-direction: column;
	}
	.main > :global(.chat) {
		flex: 1;
		min-height: 0;
	}
	.mobile-branches {
		display: none;
	}
	.demo-banner {
		height: 34px;
		box-sizing: border-box;
		padding: 7px 16px;
		font-size: 13px;
		background: var(--accent-soft);
		border-bottom: 1px solid var(--border);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.demo-banner a {
		color: var(--accent);
		margin-left: 6px;
	}
	.app.hidden {
		grid-template-columns: 240px minmax(0, 1fr) 0 0;
	}
	.app.full {
		grid-template-columns: 240px 0 0 minmax(0, 1fr);
	}
	.sidebar,
	.main {
		min-height: 0;
		overflow: hidden;
	}
	.resizer {
		cursor: col-resize;
		background: var(--border);
		opacity: 0.5;
	}
	.resizer:hover {
		opacity: 1;
	}
	.overview {
		display: flex;
		flex-direction: column;
		min-width: 0;
		background: var(--surface-muted);
	}
	.app.hidden .overview {
		display: none;
	}
	.overview-bar {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 12px;
		border-bottom: 1px solid var(--border);
	}
	.overview-bar button {
		font-size: 12px;
		padding: 2px 8px;
	}
	.flow {
		flex: 1;
		min-height: 0;
	}
	.spacer {
		flex: 1;
	}
	.muted {
		color: var(--text-muted);
		font-size: 12px;
	}
	.connecting {
		display: grid;
		place-items: center;
		height: 100%;
		color: var(--text-muted);
	}
	.show-overview {
		position: fixed;
		top: 10px;
		right: 12px;
	}
	.toasts {
		position: fixed;
		bottom: 16px;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		gap: 6px;
		z-index: 60;
	}
	.toast {
		background: var(--danger);
		color: white;
		border: none;
		border-radius: 8px;
		padding: 8px 14px;
	}
	@media (max-width: 900px) {
		.app {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: minmax(0, 1fr) 40vh;
		}
		.sidebar,
		.resizer {
			display: none;
		}
		.mobile-branches {
			display: flex;
			align-items: center;
			gap: 8px;
			padding: 8px max(16px, env(safe-area-inset-left, 0px));
			border-bottom: 1px solid var(--border);
			font-size: 12px;
			color: var(--text-muted);
		}
		.mobile-branches select {
			flex: 1;
			min-width: 0;
		}
		.app.full {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: 0 minmax(0, 1fr);
		}
		.app.hidden {
			grid-template-rows: minmax(0, 1fr) 0;
		}
	}
</style>
