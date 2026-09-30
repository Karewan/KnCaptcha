/**
 * Copies the base style to dist/kncaptcha.css, and a minified copy to dist/kncaptcha.min.css
 */
import { readFileSync, writeFileSync } from "node:fs";

const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
const minified = css
	.replace(/\/\*[\s\S]*?\*\//g, "")
	.replace(/\s+/g, " ")
	.replace(/\s*([{}:;,>])\s*/g, "$1")
	.replace(/;}/g, "}")
	.trim();

writeFileSync(new URL("../dist/kncaptcha.css", import.meta.url), css);
writeFileSync(
	new URL("../dist/kncaptcha.min.css", import.meta.url),
	`/* KnCaptcha - MIT license */\n${minified}\n`,
);
