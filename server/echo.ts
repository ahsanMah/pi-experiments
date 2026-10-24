// An offline stand-in model built on pi-ai's faux provider: it streams a short reply saying
// what it was asked and what context it can see, so branching and sharing can be tried
// without a key. It also answers summary requests with the branch's questions.
import { fauxAssistantMessage, fauxProvider, type FauxResponseStep } from "@earendil-works/pi-ai/providers/faux";
import { textOf } from "./tree.ts";

export type EchoOptions = {
	/** Provider id; the model id is always `echo`. */
	readonly provider?: string;
	/** Streaming speed; 0 answers at once. */
	readonly tokensPerSecond?: number;
	/** Closing hint appended to every reply. */
	readonly hint?: string;
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
