// An offline stand-in model built on pi-ai's faux provider: it streams a short reply saying
// what it was asked and what context it can see, so branching and sharing can be tried
// without a key. It also answers summary requests with the branch's questions, and calls
// the branch tools when asked to "list branches", "post a note", or "suggest a branch".
import { fauxAssistantMessage, fauxProvider, fauxToolCall, type FauxResponseStep } from "@earendil-works/pi-ai/providers/faux";
import { textOf } from "./tree.ts";

export type EchoOptions = {
	/** Provider id; the model id is always `echo`. */
	readonly provider?: string;
	/** Streaming speed; 0 answers at once. */
	readonly tokensPerSecond?: number;
	/** Closing hint appended to every reply. */
	readonly hint?: string;
};

/** The branch tool a message asks for, by plain phrases, with arguments drawn from the message. */
const toolFor = (asked: string): { name: string; args: Record<string, string> } | undefined => {
	const topic = asked.replace(/\b(please|can you|could you)\b/gi, "").trim().slice(0, 120);
	if (/\blist (the )?branches\b/i.test(asked)) return { name: "list_branches", args: {} };
	if (/\bsuggest (a )?branch\b/i.test(asked)) {
		const about = /\babout (.+)$/i.exec(asked)?.[1]?.trim() ?? "a side question";
		return {
			name: "suggest_branch",
			args: {
				title: about.length > 40 ? `${about.slice(0, 39)}…` : about,
				prompt: `Let's look into ${about} on its own.`,
				reason: `You asked to explore ${about} separately from this thread.`,
			},
		};
	}
	if (/\bpost (a )?note\b/i.test(asked)) {
		const text = /:\s*(.+)$/s.exec(asked)?.[1]?.trim() ?? topic;
		return { name: "post_note", args: { title: text.split(/[.!?]/)[0]!.slice(0, 60), text } };
	}
	return undefined;
};

export const echoProvider = (options: EchoOptions = {}) => {
	const faux = fauxProvider({
		provider: options.provider ?? "faux",
		models: [{ id: "echo" }],
		...(options.tokensPerSecond ? { tokensPerSecond: options.tokensPerSecond } : {}),
	});
	const step: FauxResponseStep = (context) => {
		faux.appendResponses([step]);
		const messages = context.messages;
		const last = [...messages].reverse().find((message) => message.role === "user");
		const asked = last === undefined ? "" : textOf(last.content as never);

		// After a tool call, report what the tool said.
		const final = messages.at(-1);
		if (final?.role === "toolResult") {
			const result = textOf(final.content as never);
			return fauxAssistantMessage(`(offline echo model) The ${final.toolName} tool replied:\n\n${result}`);
		}

		// A summary request from a share: list the branch's questions.
		const branch = /<branch>\n([\s\S]*)\n<\/branch>/.exec(asked);
		if (branch !== undefined && branch !== null) {
			const questions = branch[1]!
				.split("\n")
				.filter((line) => line.startsWith("User: "))
				.map((line) => `- Asked: ${line.slice(6, 160)}`);
			return fauxAssistantMessage(
				questions.length > 0 ? `This branch so far:\n${questions.join("\n")}` : "This branch has no questions yet.",
			);
		}

		// Branch tools on request; summaries above never call them, whatever the transcript says.
		const call = toolFor(asked);
		if (call !== undefined) {
			return fauxAssistantMessage(fauxToolCall(call.name, call.args), { stopReason: "toolUse" });
		}

		// Shared notes render as "### title" blocks in the shared-context section. System messages carry
		// only changed sections, so the newest one that mentions it holds its current text.
		const section = [...messages]
			.reverse()
			.map((message) => (message.role === "system" ? JSON.stringify(message) : ""))
			.find((json) => json.includes("shared-context"));
		const notes = ((section ?? "").replace(/\\n/g, "\n").match(/(^|\n)### /g) ?? []).length;
		const turns = messages.filter((message) => message.role === "user").length;
		return fauxAssistantMessage(
			`(offline echo model) You asked: "${asked.slice(0, 200)}". ` +
				`This branch's context holds ${turns} user message${turns === 1 ? "" : "s"}` +
				(notes > 0 ? ` and ${notes} note${notes === 1 ? "" : "s"} shared from other branches.` : ".") +
				(options.hint ? ` ${options.hint}` : ""),
		);
	};
	faux.setResponses([step]);
	return faux;
};
