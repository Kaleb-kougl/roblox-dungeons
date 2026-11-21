// Specs for scripts/doc-links.js (npm run test:checks): which `docs/NAME.md` mentions become links.
"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { linkDocMentions } = require("./doc-links.js");

const urlOf = (name) => (name === "MISSING" ? undefined : `../documents/${name}.html`);
const link = (text) => linkDocMentions(text, urlOf);

describe("linkDocMentions", () => {
	it("links a mention in running text, in brackets and at either end", () => {
		assert.equal(
			link("See docs/WALL_SLIDE.md WS4."),
			"See [docs/WALL_SLIDE.md](../documents/WALL_SLIDE.html) WS4.",
		);
		assert.equal(link("(docs/FEEL.md JD3)"), "([docs/FEEL.md](../documents/FEEL.html) JD3)");
		assert.equal(link("docs/NEW_ENEMIES_2.md"), "[docs/NEW_ENEMIES_2.md](../documents/NEW_ENEMIES_2.html)");
		assert.equal(
			link("docs/ART.md and docs/UI_ART.md."),
			"[docs/ART.md](../documents/ART.html) and [docs/UI_ART.md](../documents/UI_ART.html).",
		);
	});

	it("leaves a doc without a page as it is", () => {
		assert.equal(
			link("docs/MISSING.md and docs/ART.md"),
			"docs/MISSING.md and [docs/ART.md](../documents/ART.html)",
		);
	});

	it("leaves code alone: inline spans and fenced blocks", () => {
		assert.equal(link("run `cat docs/ART.md` now"), "run `cat docs/ART.md` now");
		const fenced = "```\ncat docs/ART.md\n```";
		assert.equal(link(`${fenced}\ndocs/ART.md`), `${fenced}\n[docs/ART.md](../documents/ART.html)`);
	});

	it("leaves an existing link and a longer path alone", () => {
		assert.equal(link("[the art doc](docs/ART.md)"), "[the art doc](docs/ART.md)");
		assert.equal(link("[docs/ART.md](ART.md)"), "[docs/ART.md](ART.md)");
		assert.equal(link("worktrees/x/docs/ART.md"), "worktrees/x/docs/ART.md");
		assert.equal(link("docs/ART.md.bak docs/art.md docs/ART.mdx"), "docs/ART.md.bak docs/art.md docs/ART.mdx");
	});
});
