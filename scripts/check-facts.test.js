// Specs for scripts/facts.js (npm run test:checks): the rendered file from synthetic facts. No build needed.
"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { WATCH, localsRows, render } = require("./facts.js");

const FACTS = {
	dailyRuleset: 7,
	simButtons: 255,
	boons: 3,
	codexEntries: 12,
	analyticsCustomEvents: 4,
	analyticsCombinations: 1234,
	analyticsFunnels: 2,
	portAudioEvents: 5,
	requiredAssetIds: 6,
	requiredStringKeys: 7,
	colorRoles: 8,
	enemyArchetypeSlots: 2,
	archetypes: ["a", "b.c"],
};
const modules = (n) => Array.from({ length: n }, (_, i) => ({ file: `shared/m${i}.luau`, locals: WATCH + 1 - i }));

describe("facts.js render", () => {
	it("is stable and carries every fact", () => {
		const text = render(FACTS, modules(3));
		assert.equal(text, render(FACTS, modules(3)));
		assert.match(text, /\| `DAILY\.ruleset` \| 7 \|/);
		assert.match(text, /\| Analytics custom event names \| 4 of 100 \|/);
		assert.match(text, /\| Analytics field value combinations \| 1,234 of 8,000 \|/);
		assert.match(text, /\| 1 \| `b\.c` \|/);
		assert.ok(text.includes(`| \`out/shared/m0.luau\` | ${WATCH + 1} |`));
		assert.ok(text.endsWith("\n"));
	});

	it("changes when a fact changes (what facts:check compares)", () => {
		assert.notEqual(render(FACTS, modules(3)), render({ ...FACTS, dailyRuleset: 8 }, modules(3)));
	});

	it("lists exactly the modules at or above WATCH, and says so when there are none", () => {
		assert.deepEqual(localsRows(modules(5)).map((m) => m.locals), [WATCH + 1, WATCH]);
		assert.ok(render(FACTS, modules(5)).includes(`| \`out/shared/m1.luau\` | ${WATCH} |`));
		assert.ok(!render(FACTS, modules(5)).includes("m2.luau"));
		assert.ok(render(FACTS, []).includes("| (none) | |"));
	});
});
