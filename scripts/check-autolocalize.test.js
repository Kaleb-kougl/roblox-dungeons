// Specs for scripts/check-autolocalize.js (npm run test:checks): bare root GUIs, JSX roots without
// AutoLocalize={false}, upper() in UI code, comments and strings ignored, the allow comment. Synthetic sources only.
"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { checkSource } = require("./check-autolocalize.js");

const whys = (rel, src) => checkSource(rel, src).map((h) => `${h.line}:${h.why.split(":")[0]}`);

describe("bare root GUIs", () => {
	it("flags new Instance of each root class outside the helper, with its line", () => {
		const src = [
			'const a = new Instance("ScreenGui");',
			"const b = new Instance('SurfaceGui');",
			'const c = new Instance( "BillboardGui" );',
			'const d = new Instance("Frame");',
		].join("\n");
		assert.deepEqual(whys("client/controllers/fx/X.ts", src), [
			"1:bare ScreenGui",
			"2:bare SurfaceGui",
			"3:bare BillboardGui",
		]);
	});

	it("allows the helper module, comments, strings and the allow comment", () => {
		assert.deepEqual(whys("client/ui/gui.ts", 'const g = new Instance("ScreenGui");'), []);
		const src = [
			'// new Instance("ScreenGui")',
			'/* new Instance("SurfaceGui") */',
			'const s = "new Instance(\\"BillboardGui\\")";',
			'const g = new Instance("ScreenGui"); // check-autolocalize: allow (test)',
			"// check-autolocalize: allow (next line)",
			'const h = new Instance("ScreenGui");',
		].join("\n");
		assert.deepEqual(whys("client/a.ts", src), []);
	});

	it("checks shared and server code too", () => {
		assert.equal(checkSource("server/services/S.ts", 'new Instance("BillboardGui")').length, 1);
	});
});

describe("JSX roots", () => {
	it("needs AutoLocalize={false} in the opening tag", () => {
		const src = [
			"export function A() {",
			"	return (",
			"		<screengui",
			'			key="KV_A"',
			"			ResetOnSpawn={false}",
			"			DisplayOrder={a > b ? 1 : 2}",
			"			Event={{ Changed: () => undefined }}",
			"		>",
			"			<frame />",
			"		</screengui>",
			"	);",
			"}",
		].join("\n");
		assert.deepEqual(whys("client/ui/A.tsx", src), ["3:<screengui> without AutoLocalize={false}"]);
		const fixed = src.replace("ResetOnSpawn={false}", "ResetOnSpawn={false}\n\t\t\tAutoLocalize={false}");
		assert.deepEqual(whys("client/ui/A.tsx", fixed), []);
	});

	it("rejects AutoLocalize={true}, checks surfacegui / billboardgui, ignores other tags and .ts files", () => {
		assert.equal(checkSource("client/ui/A.tsx", "<surfacegui AutoLocalize={true} />").length, 1);
		assert.equal(checkSource("client/ui/A.tsx", "<billboardgui Size={s}></billboardgui>").length, 1);
		assert.equal(checkSource("client/ui/A.tsx", "<billboardgui AutoLocalize={false} />").length, 0);
		assert.equal(checkSource("client/ui/A.tsx", "<screenguiX />").length, 0);
		assert.equal(checkSource("client/ui/A.tsx", "<frame /> // <screengui").length, 0);
		assert.equal(checkSource("client/ui/a.ts", "const t = a<screengui>(b);").length, 0);
	});

	it("honours the allow comment on the tag's line", () => {
		const src = "{/* check-autolocalize: allow (test) */}\n<screengui />";
		assert.equal(checkSource("client/ui/A.tsx", src).length, 0);
	});
});

describe("upper()", () => {
	it("flags .upper( and string.upper( in client and shared/view", () => {
		const src = 'const a = str("x").upper();\nconst b = string.upper(name);';
		assert.deepEqual(whys("client/ui/hud/X.tsx", src), [
			"1:upper() on text (Luau's upper is ASCII only)",
			"2:upper() on text (Luau's upper is ASCII only)",
		]);
		assert.equal(checkSource("shared/view/hud/x.ts", "s.upper()").length, 1);
	});

	it("ignores other folders, comments, strings, lower() and the allow comment", () => {
		assert.equal(checkSource("shared/sim/x.ts", "s.upper()").length, 0);
		assert.equal(checkSource("server/x.ts", "s.upper()").length, 0);
		assert.equal(checkSource("client/x.ts", '// s.upper()\nconst t = "a.upper()";\ns.lower();').length, 0);
		assert.equal(checkSource("client/x.ts", "s.upper(); // check-autolocalize: allow (key code)").length, 0);
	});
});
