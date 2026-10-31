// Folds a demo build into one self-contained HTML file, for hosting as a single page.
// Run: npm run build:demo   (web/dist-demo), or with a build directory and page name as arguments
// (VARIANT=<name> npm run build:variant).
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const dir = resolve(process.argv[2] ?? join(import.meta.dirname, "../web/dist-demo"));
const name = process.argv[3] ?? "pi-branches-demo";
const assets = join(dir, "assets");
const files = readdirSync(assets);
const js = files.filter((file) => file.endsWith(".js"));
const css = files.filter((file) => file.endsWith(".css"));
if (js.length !== 1) throw new Error(`expected one script in the demo build, found ${js.join(", ")}`);

// `</script` inside the bundle would end the inline script early.
const script = readFileSync(join(assets, js[0]!), "utf8")
	.replace(/<\/script/gi, "<\\/script")
	// Libraries use a literal U+FFFD (for example marked's entity decoding); escape it so hosts don't take it for corruption.
	.replace(/\uFFFD/g, "\\uFFFD");
const styles = css.map((file) => readFileSync(join(assets, file), "utf8")).join("\n");
const html = readFileSync(join(dir, "index.html"), "utf8")
	.replace(/\s*<script type="module"[^>]*><\/script>/, "")
	.replace(/\s*<link rel="(stylesheet|modulepreload)"[^>]*>/g, "")
	.replace("</head>", () => `<style>\n${styles}\n</style>\n</head>`)
	.replace("</body>", () => `<script type="module">\n${script}\n</script>\n</body>`);
writeFileSync(join(dir, `${name}.html`), html);
console.log(`wrote ${relative(process.cwd(), join(dir, `${name}.html`))} (${Math.round(html.length / 1024)} KB)`);

// The same page without the document skeleton, for hosts that wrap the content in their own.
const title = /<title>[^<]*<\/title>/.exec(html)![0];
const body = `${title}\n<style>\n${styles}\n</style>\n<div id="app"></div>\n<script type="module">\n${script}\n</script>\n`;
writeFileSync(join(dir, `${name}.content.html`), body);
