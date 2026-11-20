// Specs for scripts/open-tasks.js (npm run test:checks): which lines are open tasks, their groups, the rendered list.
"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { openTasks, pendingNotes, render } = require("./open-tasks.js");

const DOC = [
	"## Tasks",
	"",
	"- [x] **SP1. Done thing.** Built.",
	"- [ ] **SP7. Studio / playtest.** Keyboard and mouse first,",
	"  then gamepad. → Verify: the owner signs off.",
	"- [ ] **BL7. The vale clip.** Upload the sound.",
	"  - [ ] nested: measure the retry",
	"- [ ] **GY6. Verify**: `npm run verify`.",
	"",
	"Not a task: - [ ] in a sentence.",
].join("\n");

describe("openTasks", () => {
	it("takes unchecked list items only, with their line, id and continuation text", () => {
		const tasks = openTasks(DOC);
		assert.deepEqual(tasks.map((t) => [t.line, t.id, t.group]), [
			[4, "SP7", "studio"],
			[6, "BL7", "assets"],
			[7, "", "other"],
			[8, "GY6", "other"],
		]);
		assert.equal(tasks[0].summary, "SP7. Studio / playtest. Keyboard and mouse first, then gamepad. → Verify: the owner signs off.");
	});

	it("cuts a long task's summary", () => {
		const [t] = openTasks("- [ ] **X1. Long.** " + "word ".repeat(80));
		assert.ok(t.summary.length <= 150 && t.summary.endsWith("…"));
	});
});

describe("render", () => {
	it("groups by kind, then by doc, with totals; stable", () => {
		const docs = [
			{ doc: "A.md", tasks: openTasks(DOC) },
			{ doc: "B.md", tasks: [] },
		];
		const text = render(docs);
		assert.equal(text, render(docs));
		assert.match(text, /4 open tasks in 1 docs\./);
		assert.match(text, /## Studio checks, playtests and device checks \(1\)/);
		assert.match(text, /## Uploads, art and audio \(1\)/);
		assert.match(text, /## Everything else \(2\)/);
		assert.ok(text.includes("(`docs/A.md` line 4)"));
		assert.ok(!text.includes("B.md"));
	});
});

describe("pendingNotes", () => {
	const LOG = [
		"# Decision log",
		"",
		"- **Sword spacing (port retune).** Gameplay. Every fixture matches. Studio check and",
		"  playtest (SP7) pending.",
		"- **Graves.** Presentation only. The five PNGs uploaded; the Studio check pending. No sound.",
		"- **Trig.** The sim never calls math.sin.",
		"",
		"## Commands",
	].join("\n");

	it("keeps only the entries with a pending sentence, and only those sentences", () => {
		assert.deepEqual(pendingNotes(LOG), [
			{ title: "Sword spacing (port retune)", notes: ["Studio check and playtest (SP7) pending."] },
			{ title: "Graves", notes: ["The five PNGs uploaded; the Studio check pending."] },
		]);
	});

	it("renders them after the tasks", () => {
		const text = render([], pendingNotes(LOG));
		assert.match(text, /## Marked pending in the decision log \(2 entries\)/);
		assert.ok(text.includes("- **Graves**\n  - The five PNGs uploaded; the Studio check pending."));
	});
});
