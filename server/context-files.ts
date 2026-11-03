// Project instructions (AGENTS.md, CLAUDE.md) in every branch's system prompt, as pi does it.
//
// Files are found by the coding agent's own loadProjectContextFiles: the global file in pi's
// agent directory, then one per directory from the filesystem root down to the working
// directory (AGENTS.override.md, AGENTS.md, then CLAUDE.md; the first that exists wins). Like
// pi, they are read once at startup and rendered in pi's format.
import { parse } from "node:path";
import { defineExtension, section } from "@earendil-works/pi-durable";

export type ContextFile = { readonly path: string; readonly content: string };

/** Section key; the web client's context breakdown splits it per file. */
export const PROJECT_CONTEXT_SECTION = "project-context";

/** The same text pi's system prompt builder gives its project context. */
export const renderProjectContext = (files: readonly ContextFile[]): string =>
	[
		"Project-specific instructions and guidelines:",
		...files.map(({ path, content }) => `<project_instructions path="${path}">\n${content}\n</project_instructions>`),
	].join("\n\n");

export const createProjectContextExtension = (files: readonly ContextFile[]) => {
	const text = files.length === 0 ? undefined : renderProjectContext(files);
	return defineExtension({
		name: "project-context",
		sections: [section(PROJECT_CONTEXT_SECTION, () => text)],
	});
};

/** Load with the coding agent's logic; `agentDir` undefined skips the global file. */
export const loadContextFiles = async (cwd: string, agentDir: string | undefined): Promise<ContextFile[]> => {
	const { loadProjectContextFiles } = await import("@earendil-works/pi-coding-agent");
	// Without an agent directory, point it at the filesystem root: the root is first in the walk anyway, so a
	// file there keeps its place and is loaded once.
	return loadProjectContextFiles({ cwd, agentDir: agentDir ?? parse(cwd).root });
};

/** Section key for the skills list. */
export const SKILLS_SECTION = "skills";

/**
 * Skills as pi lists them: name, description and SKILL.md location, for the model to read with
 * the read tool when a task matches. Like pi, the list is offered only when a read tool exists.
 */
export const createSkillsExtension = (text: string | undefined) =>
	defineExtension({ name: "skills", sections: [section(SKILLS_SECTION, () => text)] });

/**
 * Load skills with the coding agent's own resource loader, which resolves settings, packages and the
 * default skill folders exactly as pi does; nothing but skills is loaded, so no extension code runs.
 * Without `agentDir` (the pi setup is off) only the project's `.pi/skills` is read.
 * Returns pi's prompt text, or undefined when there are none.
 */
export const loadSkillsPrompt = async (
	cwd: string,
	agentDir: string | undefined,
	warn: (message: string) => void,
): Promise<{ text: string | undefined; names: string[] }> => {
	const pi = await import("@earendil-works/pi-coding-agent");
	let result: { skills: Parameters<typeof pi.formatSkillsForPrompt>[0]; diagnostics: { message: string; path?: string }[] };
	if (agentDir !== undefined) {
		const loader = new pi.DefaultResourceLoader({
			cwd,
			agentDir,
			noExtensions: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
		});
		await loader.reload();
		result = loader.getSkills();
	} else {
		result = pi.loadSkills({ cwd, agentDir: cwd, skillPaths: [`${cwd}/.pi/skills`], includeDefaults: false });
	}
	for (const diagnostic of result.diagnostics) warn(`skills: ${diagnostic.message}${diagnostic.path ? ` (${diagnostic.path})` : ""}`);
	const text = pi.formatSkillsForPrompt(result.skills, "read").trim();
	return {
		text: text === "" ? undefined : text,
		names: result.skills.filter((skill) => !skill.disableModelInvocation).map((skill) => skill.name),
	};
};
