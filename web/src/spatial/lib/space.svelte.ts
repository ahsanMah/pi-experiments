// Workspace state shared by the canvas, its cards and the focus panel through Svelte context,
// so card components read live data directly and the flow's node list only changes with layout.
import { getContext, setContext } from "svelte";
import type { ShareMode, SharedNote, TreeNode } from "../../../../shared/protocol.ts";
import type { BranchesClient } from "../../lib/client.svelte.ts";
import type { Point } from "./geometry.ts";

export type DraftSticky = { id: string; title: string; text: string; x: number; y: number };
/** A share waiting for the server (summaries take a model call); drawn as a placeholder sticky. */
export type PendingShare = { id: string; mode: ShareMode; from?: number; title: string };
export type ShareRequest = { from?: { conversationId: number; at?: number }; to?: number[] };

/** What the canvas exposes to the rest of the app; set by the board once it is mounted. */
export type Camera = {
	reveal: (conversationId: number, options?: { zoom?: boolean }) => void;
	fit: () => void;
	zoomBy: (factor: number) => void;
	zoomTo: (zoom: number) => void;
	center: () => Point;
};

const KEY = Symbol("space");
const POSITIONS = "spatial.positions";

// Positions are a per-viewer convenience; storage may be unavailable (private windows, sandboxes).
const load = (): Record<string, Point> => {
	try {
		return JSON.parse(localStorage.getItem(POSITIONS) ?? "{}") as Record<string, Point>;
	} catch {
		return {};
	}
};

export class Space {
	readonly client: BranchesClient;
	/** Branch open in the focus panel. */
	focusId = $state<number | null>(null);
	/** Card the keyboard is on, highlighted on the canvas. */
	currentId = $state<number | null>(null);
	composer = $state<Record<number, string>>({});
	stickies = $state<DraftSticky[]>([]);
	pending = $state<PendingShare[]>([]);
	/** Branches created in this tab a moment ago, so their card and edge animate in. */
	fresh = $state<number[]>([]);
	/** Card under a dragged sticky or connector, to show where a drop lands. */
	dropTarget = $state<number | null>(null);
	/** Note whose connectors are emphasized. */
	hotNote = $state<string | null>(null);
	sheet = $state<ShareRequest | undefined>();
	noteOpen = $state<string | null>(null);
	positions = $state<Record<string, Point>>(load());
	notices = $state<string[]>([]);
	/** Screen width the focus panel covers on the right, so the camera centers cards beside it. */
	inset = $state(0);
	/** Canvas zoom, mirrored from the board for the toolbar. */
	zoom = $state(1);
	camera: Camera | undefined;
	#nextDraft = 0;

	constructor(client: BranchesClient) {
		this.client = client;
	}

	branch(id: number | null) {
		return id === null ? undefined : this.client.tree.branches.find((b) => b.id === id);
	}

	notify(message: string) {
		this.notices = [...this.notices.slice(-3), message];
		setTimeout(() => (this.notices = this.notices.filter((n) => n !== message)), 4200);
	}

	#guard = async <T>(work: Promise<T>): Promise<T | undefined> => {
		try {
			return await work;
		} catch (error) {
			this.notify(error instanceof Error ? error.message : String(error));
			return undefined;
		}
	};

	place(key: string, point: Point) {
		this.positions = { ...this.positions, [key]: { x: Math.round(point.x), y: Math.round(point.y) } };
		this.#save();
	}

	tidy() {
		this.positions = {};
		this.#save();
	}

	#save() {
		try {
			localStorage.setItem(POSITIONS, JSON.stringify(this.positions));
		} catch {}
	}

	focus(id: number | null) {
		this.focusId = id;
		if (id !== null) {
			this.currentId = id;
			// After the panel has claimed its width, so the card centers in what is left.
			setTimeout(() => this.camera?.reveal(id), 0);
		}
	}

	async send(conversationId: number, text: string, whenBusy: "followUp" | "steer") {
		await this.client.request({ t: "send", conversationId, text, whenBusy });
	}

	abort(conversationId: number) {
		void this.#guard(this.client.request({ t: "abort", conversationId }));
	}

	async fork(conversationId: number, at: number, draft = "") {
		const result = await this.#guard(this.client.request<{ conversationId: number }>({ t: "fork", conversationId, at }));
		if (result === undefined) return;
		const id = result.conversationId;
		this.composer[id] = draft;
		this.fresh = [...this.fresh, id];
		setTimeout(() => (this.fresh = this.fresh.filter((f) => f !== id)), 1600);
		this.currentId = id;
		// Keep reading in the panel if it is open; otherwise just bring the new card into view.
		if (this.focusId !== null) this.focusId = id;
		// The card exists once the next tree arrives.
		setTimeout(() => this.camera?.reveal(id), 120);
		return id;
	}

	async editBranch(node: TreeNode) {
		if (node.before === undefined) return;
		// Tree previews are cut short; ask for the message itself.
		const result = await this.#guard(this.client.request<{ text: string }>({ t: "text", conversationId: node.conversationId, entryId: node.id }));
		if (result !== undefined) await this.fork(node.conversationId, node.before, result.text);
	}

	async newRoot() {
		const result = await this.#guard(this.client.request<{ conversationId: number }>({ t: "new" }));
		if (result === undefined) return;
		this.fresh = [...this.fresh, result.conversationId];
		this.currentId = result.conversationId;
		setTimeout(() => this.camera?.reveal(result.conversationId), 120);
	}

	rename(conversationId: number, title: string) {
		if (title.trim() !== "") void this.#guard(this.client.request({ t: "rename", conversationId, title: title.trim() }));
	}

	configure(conversationId: number, model: string) {
		void this.#guard(this.client.request({ t: "configure", conversationId, model }));
	}

	/** Share from the sheet; summaries show as a placeholder sticky until the model is done. */
	async share(request: { mode: ShareMode; to: number[] | "*"; from?: { conversationId: number; at?: number }; title: string; text: string }) {
		const pending: PendingShare = {
			id: `p${++this.#nextDraft}`,
			mode: request.mode,
			...(request.from ? { from: request.from.conversationId } : {}),
			title: request.title.trim() || (request.mode === "summary" ? "Summarizing…" : "Sharing…"),
		};
		this.pending = [...this.pending, pending];
		try {
			await this.client.request({
				t: "share",
				mode: request.mode,
				to: request.to,
				...(request.from ? { from: request.from } : {}),
				...(request.title.trim() !== "" ? { title: request.title.trim() } : {}),
				...(request.text.trim() !== "" ? { text: request.text } : {}),
			});
		} finally {
			this.pending = this.pending.filter((p) => p.id !== pending.id);
		}
	}

	unshare(noteId: string) {
		void this.#guard(this.client.request({ t: "unshare", noteId }));
	}

	/**
	 * Change who sees a note. The protocol has no update, so this shares the same note to the new
	 * targets and then removes the old one; the sticky keeps its place on the canvas.
	 */
	async retarget(note: SharedNote, to: number[] | "*") {
		if (to !== "*" && to.length === 0) {
			this.unshare(note.id);
			return;
		}
		const result = await this.#guard(
			this.client.request<{ noteId: string }>({
				t: "share",
				mode: "note",
				to,
				...(note.from ? { from: note.from } : {}),
				title: note.title,
				text: note.text,
			}),
		);
		if (result === undefined) return;
		const kept = this.positions[`n${note.id}`];
		if (kept) this.place(`n${result.noteId}`, kept);
		if (this.noteOpen === note.id) this.noteOpen = result.noteId;
		await this.#guard(this.client.request({ t: "unshare", noteId: note.id }));
	}

	/** Add one branch to a note's audience: what dropping a sticky on a card does. */
	async shareNoteWith(note: SharedNote, conversationId: number) {
		if (note.to === "*" || note.to.includes(conversationId)) {
			this.notify(`“${note.title}” already reaches ${note.to === "*" ? "every branch" : "that branch"}.`);
			return;
		}
		await this.retarget(note, [...note.to, conversationId]);
		this.notify(`Shared “${note.title}” with ${this.branch(conversationId)?.title ?? "the branch"}.`);
	}

	newSticky(at: Point) {
		const sticky: DraftSticky = { id: `d${++this.#nextDraft}`, title: "", text: "", x: at.x - 114, y: at.y - 82 };
		this.stickies = [...this.stickies, sticky];
		return sticky.id;
	}

	updateSticky(id: string, patch: Partial<DraftSticky>) {
		this.stickies = this.stickies.map((s) => (s.id === id ? { ...s, ...patch } : s));
	}

	dropSticky(id: string) {
		this.stickies = this.stickies.filter((s) => s.id !== id);
	}

	/** Send a draft sticky to branches; the shared sticky stays where the draft was, or joins the lane. */
	async publishSticky(id: string, to: number[] | "*", keepPlace = true) {
		const sticky = this.stickies.find((s) => s.id === id);
		if (sticky === undefined) return;
		if (sticky.text.trim() === "") {
			this.notify("Write something on the sticky first.");
			return;
		}
		const result = await this.#guard(
			this.client.request<{ noteId: string }>({
				t: "share",
				mode: "note",
				to,
				text: sticky.text,
				...(sticky.title.trim() !== "" ? { title: sticky.title.trim() } : {}),
			}),
		);
		if (result === undefined) return;
		if (keepPlace) this.place(`n${result.noteId}`, { x: sticky.x, y: sticky.y });
		this.dropSticky(id);
		const target = to === "*" ? "every branch" : to.map((t) => this.branch(t)?.title ?? `#${t}`).join(", ");
		this.notify(`Shared with ${target}.`);
	}
}

export const setSpace = (space: Space) => setContext(KEY, space);
export const useSpace = () => getContext<Space>(KEY);
