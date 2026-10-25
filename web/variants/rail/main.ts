import { mount } from "svelte";
import App from "./App.svelte";
import { BranchesClient, type SocketLike } from "../../src/lib/client.svelte.ts";
import "./app.css";

// `--mode demo` runs the branches server inside the page instead of connecting to one.
const demo = import.meta.env.MODE === "demo";
const open = demo
	? (await import("../../src/demo.ts")).startDemo()
	: () => new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`) as unknown as SocketLike;

mount(App, { target: document.getElementById("app")!, props: { client: new BranchesClient(open), demo } });
