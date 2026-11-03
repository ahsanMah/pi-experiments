// HTTP + WebSocket entry point. Serves the built web client from web/dist and the
// branches protocol on /ws. Every client (web canvas, terminal) talks to this one
// process, which owns the SQLite storage.
//
// Models come from your pi coding agent setup: ~/.pi/agent/auth.json (API keys and /login
// subscriptions), models.json (custom providers), and settings.json (default model and
// thinking level), through the coding agent's own ModelRuntime. Environment API keys work
// too. Set PI_BRANCHES_PI_CONFIG=0 to ignore the pi setup and use environment keys only.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Models } from "@earendil-works/pi-ai/models";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type { AgentChange } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { WebSocketServer, type WebSocket } from "ws";
import type { ClientMessage, ServerMessage } from "../shared/protocol.ts";
import { BranchesApp } from "./app.ts";
import { connect } from "./connection.ts";
import { createProjectContextExtension, createSkillsExtension, loadContextFiles, loadSkillsPrompt } from "./context-files.ts";
import { echoProvider } from "./echo.ts";

const port = Number(process.env.PORT ?? 8787);
// No authentication, so only local clients by default.
const host = process.env.HOST ?? "127.0.0.1";
const database = process.env.PI_BRANCHES_DB ?? "./branches.sqlite";
const cwd = process.env.PI_BRANCHES_CWD;
const usePiConfig = process.env.PI_BRANCHES_PI_CONFIG !== "0";
const useContextFiles = process.env.PI_BRANCHES_CONTEXT_FILES !== "0";
const useSkills = process.env.PI_BRANCHES_SKILLS !== "0";
const webRoot = resolve(import.meta.dirname, "../web/dist");
const context = BACKGROUND_CONTEXT;

type ModelSetup = { models: Models; model: string; thinkingLevel?: AgentChange["thinkingLevel"]; source: string };

const loadModels = async (): Promise<ModelSetup> => {
	const echo = echoProvider({ tokensPerSecond: 40, hint: "Set PI_MODEL, or a default model in pi, to get real answers." }).provider;
	if (usePiConfig) {
		const { ModelRuntime, SettingsManager, getAgentDir } = await import("@earendil-works/pi-coding-agent");
		const models = await ModelRuntime.create();
		models.registerNativeProvider(echo);
		const settings = SettingsManager.create(process.cwd());
		const provider = settings.getDefaultProvider();
		const modelId = settings.getDefaultModel();
		const fromSettings = provider !== undefined && modelId !== undefined ? `${provider}/${modelId}` : undefined;
		const thinkingLevel = settings.getDefaultThinkingLevel() as AgentChange["thinkingLevel"] | undefined;
		return {
			models,
			model: process.env.PI_MODEL ?? fromSettings ?? "faux/echo",
			...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
			source: `pi settings in ${getAgentDir()}`,
		};
	}
	const models = builtinModels();
	models.setProvider(echo);
	return { models, model: process.env.PI_MODEL ?? "faux/echo", source: "environment API keys" };
};

const setup = await loadModels();

// AGENTS.md / CLAUDE.md from pi's agent directory and the working directory's ancestors, like pi.
const agentDir = usePiConfig ? (await import("@earendil-works/pi-coding-agent")).getAgentDir() : undefined;
const contextFiles = useContextFiles ? await loadContextFiles(resolve(cwd ?? process.cwd()), agentDir) : [];
// Skills, like pi, only when the model has a read tool to load them with: the coding tools.
const skills =
	useSkills && cwd !== undefined
		? await loadSkillsPrompt(resolve(cwd), agentDir, (message) => console.warn(message))
		: { text: undefined, names: [] };
const extensions = [
	...(cwd !== undefined ? [CodingTools] : []),
	createProjectContextExtension(contextFiles),
	createSkillsExtension(skills.text),
];
const app = await BranchesApp.open(
	{
		storage: await openNodeSqliteStorage(database),
		models: setup.models,
		model: setup.model,
		...(setup.thinkingLevel !== undefined ? { thinkingLevel: setup.thinkingLevel } : {}),
		extensions,
		...(cwd !== undefined ? { env: ({ cwd: agentCwd }) => new NodeExecutionEnv({ cwd: agentCwd ?? cwd }) } : {}),
	},
	context,
);

const MIME: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript",
	".css": "text/css",
	".svg": "image/svg+xml",
	".json": "application/json",
};

const server = createServer((request, response) => {
	const url = new URL(request.url ?? "/", "http://localhost");
	let file = join(webRoot, url.pathname === "/" ? "index.html" : url.pathname);
	if (!file.startsWith(webRoot) || !existsSync(file) || statSync(file).isDirectory()) file = join(webRoot, "index.html");
	if (!existsSync(file)) {
		response.writeHead(404, { "content-type": "text/plain" });
		response.end("Web client not built. Run `npm run build`, or `npm run web` for the dev server.\n");
		return;
	}
	response.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
	createReadStream(file).pipe(response);
});

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (socket: WebSocket) => {
	const connection = connect(
		app,
		(message: ServerMessage) => {
			if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
		},
		context,
	);
	socket.on("message", (raw) => {
		let message: ClientMessage;
		try {
			message = JSON.parse(String(raw)) as ClientMessage;
		} catch {
			socket.send(JSON.stringify({ t: "error", message: "Malformed message" } satisfies ServerMessage));
			return;
		}
		void connection.receive(message);
	});
	socket.on("close", () => connection.close());
});

server.listen(port, host, () => {
	for (const file of contextFiles) console.log(`context file ${file.path}`);
	if (skills.names.length > 0) console.log(`skills: ${skills.names.join(", ")}`);
	console.log(`pi-branches on http://${host}:${port} (model ${setup.model} from ${setup.source}, storage ${database})`);
});

const shutdown = async () => {
	wss.close();
	server.close();
	await app.close(context);
	process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
