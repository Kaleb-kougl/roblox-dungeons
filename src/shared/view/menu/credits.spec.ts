import { describe, expect, it } from "@rbxts/jest-globals";
import {
	CREDITS,
	CREDIT_SECTIONS,
	CREDIT_STRINGS,
	MAIN_MENU_PATH,
	creditLines,
	creditStringKeys,
	menuNavReduce,
	menuStringKeys,
	type MenuNav,
} from "shared/view/menu";

describe("credits (main menu > Credits)", () => {
	it("credits the CC BY kit with its author, source, licence address and the change note", () => {
		const kit = CREDITS.find((c) => c.work === "Dungeon Essential Kit");
		expect(kit).toBeDefined();
		expect(kit!.author).toBe("Rakshaan (Sketchfab)");
		expect(kit!.license!.find("creativecommons.org/licenses/by/4.0", 1, true)[0] !== undefined).toBe(true);
		expect(kit!.modified).toBe(true);
		// the MIT code keeps its copyright notice
		const forge = CREDITS.find((c) => c.section === "code");
		expect(forge!.license!.find("Copyright", 1, true)[0] !== undefined).toBe(true);
	});

	it("lists every section with works, in order, each label once, then its works' lines", () => {
		const lines = creditLines();
		const sections = lines.filter((l) => l.kind === "section").map((l) => (l.kind === "section" ? l.key : ""));
		expect(sections).toEqual(CREDIT_SECTIONS.map((s) => CREDIT_STRINGS.section[s]));
		expect(lines[0].kind).toBe("section");
		expect(lines.filter((l) => l.kind === "work").size()).toBe(CREDITS.size());
		expect(lines.filter((l) => l.kind === "modified").size()).toBe(
			CREDITS.filter((c) => c.modified === true).size(),
		);
		// a section without works shows no label
		const one = creditLines([{ section: "audio", work: "W", author: "A" }]);
		expect(one).toEqual([
			{ kind: "section", key: CREDIT_STRINGS.section.audio },
			{ kind: "work", work: "W", author: "A" },
		]);
	});

	it("asks only for menu string keys (checked against the placeholder pack in hud.spec.ts)", () => {
		const keys = menuStringKeys();
		for (const k of creditStringKeys()) expect([k, keys.includes(k)]).toEqual([k, true]);
	});

	it("opens over the main menu, and Back returns to it", () => {
		const main: MenuNav = menuNavReduce({ screen: "none", stack: [] }, { kind: "reset", path: MAIN_MENU_PATH });
		const credits = menuNavReduce(main, { kind: "open", screen: "credits" });
		expect(credits).toEqual({ screen: "credits", stack: ["main"] });
		expect(menuNavReduce(credits, { kind: "back" })).toEqual(main);
	});
});
