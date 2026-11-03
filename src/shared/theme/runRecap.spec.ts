// Roblox port (docs/RUN_RECAP.md RR3 / CM3): the run-over recap's and the co-op moments' strings are in the contract's
// list and every bundled pack fills them with well-formed templates. contract.ts names the keys inline (its compiled
// Luau sits near the 200-locals limit), so these specs are what keeps runRecap.ts and contract.ts in step.
import { describe, expect, it } from "@rbxts/jest-globals";
import { REQUIRED_STRING_KEYS } from "./contract";
import { THEME_PACKS } from "./packs";
import { PLACEHOLDER_MANIFEST } from "./packs/placeholder";
import { RECAP_STRING_KEYS, TEAM_MOMENT_STRING_KEYS } from "./runRecap";
import { placeholders, templateProblem } from "./strings";
import { deepClone, sortedKeys, type Obj } from "./util";
import { validateManifest } from "./validate";

function tail(list: ReadonlyArray<string>, n: number): string[] {
	const out = new Array<string>();
	for (let i = list.size() - n; i < list.size(); i++) out.push(list[i]);
	return out;
}

/** Every key's English and its sorted placeholder names. */
const ENGLISH: ReadonlyArray<[string, string, string[]]> = [
	["run.recap.near.boss", "{boss} had {pct}% left", ["boss", "pct"]],
	["run.recap.near.score", "{gap} short of your best", ["gap"]],
	["run.recap.near.recordFloor", "One more floor for a new deepest", []],
	["run.recap.near.stairs", "{tiles} tiles from floor {next}", ["next", "tiles"]],
	["run.recap.near.fullClear", "{rooms} rooms from a full clear", ["rooms"]],
	["run.recap.near.fullClearOne", "1 room from a full clear", []],
	["run.recap.near.nextBoss", "1 floor from {boss}", ["boss"]],
	["run.recap.hl.bossNoHit", "Boss felled · no hits", []],
	["run.recap.hl.bosses", "Bosses felled", []],
	["run.recap.hl.combo", "Best combo", []],
	["run.recap.hl.perfect", "PERFECT rooms", []],
	["run.recap.hl.teamPerfect", "TEAM PERFECT rooms", []],
	["run.recap.hl.ofTotal", "{n} of {total}", ["n", "total"]],
	["run.recap.hl.teamStreak", "Best team streak", []],
	["run.recap.hl.duos", "Duos", []],
	["run.recap.hl.evolved", "Evolved", []],
	["run.recap.hl.parries", "Parries", []],
	["run.recap.hl.syncParries", "Sync parries", []],
	["run.recap.hl.sweeps", "Sweeps", []],
	["run.recap.hl.grazes", "Grazes", []],
	["run.recap.hl.jackpots", "Jackpots", []],
	["run.recap.hl.speed", "Speed bonus", []],
	["run.recap.hl.kills", "Kills", []],
	["run.recap.hl.rooms", "Rooms cleared", []],
	["run.recap.team", "Team", []],
	["run.recap.you", "You", []],
	["run.recap.details", "Details", []],
	["run.recap.detailsHide", "Highlights", []],
	["room.clear.teamPerfect", "TEAM PERFECT", []],
	["room.clear.teamStreak", "TEAM PERFECT x{n}", ["n"]],
	["fx.parry.sync", "SYNC!", []],
	["fx.parry.syncCount", "SYNC x{n}", ["n"]],
];

function sortedPlaceholders(text: string): string[] {
	const p = placeholders(text);
	p.sort();
	return p;
}

describe("run recap and co-op moments: contract", () => {
	it("requires the recap strings and the co-op moment strings (written out in REQUIRED_STRING_KEYS, in order)", () => {
		const all = [...RECAP_STRING_KEYS, ...TEAM_MOMENT_STRING_KEYS];
		expect(all).toEqual(ENGLISH.map(([k]) => k));
		expect(RECAP_STRING_KEYS.size()).toBe(28);
		expect(TEAM_MOMENT_STRING_KEYS.size()).toBe(4);
		expect(tail(REQUIRED_STRING_KEYS, all.size())).toEqual(all);
		expect(new Set(REQUIRED_STRING_KEYS).size()).toBe(REQUIRED_STRING_KEYS.size());
	});
});

describe("run recap and co-op moments: packs", () => {
	it("the placeholder's English, exactly as the plan words it (upper-case where shown: code never upper-cases)", () => {
		const s = PLACEHOLDER_MANIFEST.strings;
		for (const [k, text] of ENGLISH) expect([k, s[k]]).toEqual([k, text]);
	});

	it("every bundled pack fills every key with a well-formed template using the plan's placeholders", () => {
		for (const id of sortedKeys(THEME_PACKS)) {
			const strings = THEME_PACKS[id].strings;
			for (const [k, , vars] of ENGLISH) {
				const text = strings[k];
				expect([id, k, typeIs(text, "string")]).toEqual([id, k, true]);
				expect([id, k, templateProblem(text as string)]).toEqual([id, k, undefined]);
				expect([id, k, sortedPlaceholders(text as string)]).toEqual([id, k, vars]);
			}
		}
	});

	it("a pack missing one of them fails validation", () => {
		for (const k of ["run.recap.near.stairs", "room.clear.teamPerfect", "fx.parry.syncCount"]) {
			const m = deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;
			(m.strings as Obj)[k] = undefined;
			expect([k, validateManifest(m).some((e) => e.find(`"${k}"`, 1, true)[0] !== undefined)]).toEqual([k, true]);
		}
	});
});
