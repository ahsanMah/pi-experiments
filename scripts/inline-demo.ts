// Folds the demo build (web/dist-demo) into one self-contained HTML file, for hosting as a single page.
// Run: npm run build:demo
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dirname, "../web/dist-demo");
const assets = join(dir, "assets");
const files = readdirSync(assets);
const js = files.filter((file) => file.endsWith(".js"));
const css = files.filter((file) => file.endsWith(".css"));
if (js.length !== 1) throw new Error(`expected one script in the demo build, found ${js.join(", ")}`);

// `</script` inside the bundle would end the inline script early.
const script = readFileSync(join(assets, js[0]!), "utf8").replace(/<\/script/gi, "<\\/script");
const styles = css.map((file) => readFileSync(join(assets, file), "utf8")).join("\n");
const html = readFileSync(join(dir, "index.html"), "utf8")
	.replace(/\s*<script type="module"[^>]*><\/script>/, "")
	.replace(/\s*<link rel="(stylesheet|modulepreload)"[^>]*>/g, "")
	.replace("</head>", () => `<style>\n${styles}\n</style>\n</head>`)
	.replace("</body>", () => `<script type="module">\n${script}\n</script>\n</body>`);
writeFileSync(join(dir, "pi-branches-demo.html"), html);
console.log(`wrote web/dist-demo/pi-branches-demo.html (${Math.round(html.length / 1024)} KB)`);

// The same page without the document skeleton, for hosts that wrap the content in their own.
const title = /<title>[^<]*<\/title>/.exec(html)![0];
const body = `${title}\n<style>\n${styles}\n</style>\n<div id="app"></div>\n<script type="module">\n${script}\n</script>\n`;
writeFileSync(join(dir, "pi-branches-demo.content.html"), body);
