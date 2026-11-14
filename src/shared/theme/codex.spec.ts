// Roblox port (claude/codex-plan.md CX5): the Codex's theme keys. Its strings are REQUIRED_STRING_KEYS' last ones before
// docs/SECRET_ROOMS.md SR10's (one spread of codex.ts CODEX_STRING_KEYS), every bundled pack has them, their placeholders
// format; its one sound is PORT_AUDIO_EVENTS' last before the secret rooms' three, required, sfx, SILENT in every bundled
// pack (vale has no clip for it yet) with no SFX_FALLBACK (CXD12); the plain-string copies of the Codex's tabs, groups and
// characters agree with shared/codex and shared/characters, and every codex-only description the catalog names exists.
import { describe, expect, it } from "@rbxts/jest-globals";
import { SILVER_AUDIO_IDS, SILVER_ROLES, SILVER_STRING_KEYS } from "./silver";
import { CHARACTERS } from "shared/characters";
import { CODEX_GROUPS, CODEX_TABS, CODEX_TAB_GROUPS, codexDescKeys } from "shared/codex";
import { SFX_FALLBACK } from "shared/view/audio";
import {
	CODEX_AUDIO_IDS,
	CODEX_KIND_OF_GROUP,
	CODEX_NEW_SOUND,
	CODEX_REQUIRES_CHARACTERS,
	CODEX_STRING_KEYS,
	CODEX_SUBHEADER_GROUPS,
	CODEX_TAB_NAMES,
	codexGroupNameKey,
	codexKindKey,
	codexRequiresKey,
	codexTabNameKey,
} from "./codex";
import { PORT_AUDIO_EVENTS, REQUIRED_ASSET_IDS, REQUIRED_STRING_KEYS, slotFor } from "./contract";
import { SECRET_AUDIO_IDS, SECRET_STRING_KEYS } from "./secrets";
import { ThemePack } from "./pack";
import { THEME_PACKS } from "./packs";
import { PLACEHOLDER_MANIFEST } from "./packs/placeholder";
import { sortedKeys } from "./util";

/** The last `n` entries of `list` before its last `skip` (later features' entries), in order. */
function tail(list: ReadonlyArray<string>, n: number, skip = 0): string[] {
	const out = new Array<string>();
	const last = list.size() - skip;
	for (let i = last - n; i < last; i++) out.push(list[i]);
	return out;
}

/** What docs/SECRET_ROOMS.md SR10 appends after the Codex's entries (secrets.spec.ts), then docs/SILVER.md SV7's (silver.spec.ts). */
const SECRET_AFTER = {
	audio: SECRET_AUDIO_IDS.size() + SILVER_AUDIO_IDS.size(),
	strings: SECRET_STRING_KEYS.size() + SILVER_STRING_KEYS.size(),
} as const;

const quiet = () => {};

describe("codex: theme contract", () => {
	it("the strings are REQUIRED_STRING_KEYS' last ones before the secret rooms', distinct, and every bundled pack has each", () => {
		// 54 (CX5) + docs/SECRET_ROOMS.md SRD12's sub-header, kind line and description
		expect(CODEX_STRING_KEYS.size()).toBe(57);
		expect(tail(REQUIRED_STRING_KEYS, CODEX_STRING_KEYS.size(), SECRET_AFTER.strings)).toEqual([
			...CODEX_STRING_KEYS,
		]);
		expect(new Set(CODEX_STRING_KEYS).size()).toBe(CODEX_STRING_KEYS.size());
		expect(new Set(REQUIRED_STRING_KEYS).size()).toBe(REQUIRED_STRING_KEYS.size());
		for (const p of sortedKeys(THEME_PACKS))
			for (const key of CODEX_STRING_KEYS)
				expect([p, key, typeIs(THEME_PACKS[p].strings[key], "string")]).toEqual([p, key, true]);
	});

	it("appends sfx.codex.new to PORT_AUDIO_EVENTS (before the secret rooms' three): required, sfx; SILENT in every bundled pack; no fallback", () => {
		expect([...CODEX_AUDIO_IDS]).toEqual([CODEX_NEW_SOUND]);
		expect(CODEX_NEW_SOUND).toBe("sfx.codex.new");
		expect(tail(PORT_AUDIO_EVENTS, CODEX_AUDIO_IDS.size(), SECRET_AFTER.audio)).toEqual([...CODEX_AUDIO_IDS]);
		for (const id of CODEX_AUDIO_IDS) {
			expect([id, REQUIRED_ASSET_IDS.includes(id), slotFor(id)?.soundGroup]).toEqual([id, true, "sfx"]);
			// vale keeps the placeholder's SILENT for an ID its audio layout has no clip for (CX11 adds one)
			for (const p of sortedKeys(THEME_PACKS))
				expect([p, id, THEME_PACKS[p].assets[id].kind]).toEqual([p, id, "silent"]);
			expect((SFX_FALLBACK as unknown as ReadonlyMap<string, string>).get(id)).toBe(undefined);
		}
	});

	it("the plain-string copies agree with shared/codex (tabs, groups, sub-headers) and shared/characters", () => {
		expect([...CODEX_TAB_NAMES]).toEqual([...CODEX_TABS]);
		const groups: string[] = [];
		for (const g of CODEX_GROUPS) {
			groups.push(g);
			expect([g, codexKindKey(g) !== undefined]).toEqual([g, true]);
		}
		expect(sortedKeys(CODEX_KIND_OF_GROUP as unknown as Record<string, string>)).toEqual([...groups].sort());
		const sub: string[] = [];
		for (const tab of CODEX_TABS)
			if (CODEX_TAB_GROUPS[tab].size() > 1) for (const g of CODEX_TAB_GROUPS[tab]) sub.push(g);
		expect([...CODEX_SUBHEADER_GROUPS]).toEqual(sub);
		expect([...CODEX_REQUIRES_CHARACTERS]).toEqual(CHARACTERS.map((c) => c.id));
		// every key a helper builds is a codex string
		const keys = new Set(CODEX_STRING_KEYS);
		for (const tab of CODEX_TAB_NAMES) expect([tab, keys.has(codexTabNameKey(tab))]).toEqual([tab, true]);
		for (const g of CODEX_SUBHEADER_GROUPS) expect([g, keys.has(codexGroupNameKey(g))]).toEqual([g, true]);
		for (const g of CODEX_GROUPS) expect([g, keys.has(codexKindKey(g)!)]).toEqual([g, true]);
		for (const c of CODEX_REQUIRES_CHARACTERS) expect([c, keys.has(codexRequiresKey(c))]).toEqual([c, true]);
		expect(codexKindKey("nope")).toBe(undefined);
		// R6: the catalog's codex-only descriptions are codex strings
		for (const key of codexDescKeys()) expect([key, keys.has(key)]).toEqual([key, true]);
	});

	it("the placeholder English formats every placeholder (states, hints, run-over line, menu)", () => {
		const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: quiet });
		const s = (key: string, vars?: Record<string, string | number>) => pack.str(key, vars);
		expect(s("codex.tab.count", { tab: s("codex.tab.boons"), found: 9, total: 20 })).toBe("Boons 9/20");
		const date = s("codex.date", { day: 3, month: s("daily.date.month.nov"), year: 2026 });
		expect(date).toBe("3 Nov 2026");
		expect(s("codex.state.found", { floor: 7, date })).toBe("Found on floor 7 · 3 Nov 2026");
		expect([s("codex.state.foundFloor", { floor: 7 }), s("codex.state.foundDate", { date })]).toEqual([
			"Found on floor 7",
			"Found · 3 Nov 2026",
		]);
		expect([s("codex.state.seen"), s("codex.state.foundAny"), s("codex.unknown")]).toEqual([
			"Seen",
			"Found",
			"???",
		]);
		expect(s("codex.hint.affix", { floor: 4 })).toBe("Champions from floor 4");
		expect(s("codex.hint.boss", { every: 5 })).toBe("Waits every 5 floors");
		expect(s("codex.hint.evo", { boon: s("boon.volatile.name") })).toBe("Take Volatile three times");
		expect(s("codex.hint.duo", { a: "Volatile", b: "Chain Spark" })).toBe("Recipe: Volatile + Chain Spark");
		expect(s("codex.kind.boon", { rarity: s("boon.rarity.rare") })).toBe("Rare boon");
		expect(s("codex.kind.evolution", { boon: "Volatile" })).toBe("Evolution of Volatile");
		// docs/SECRET_ROOMS.md SRD12: the secret rooms' section (the Bestiary's last sub-header), kind line and entry name
		expect([s("codex.group.secrets"), s("codex.kind.secret"), s("secret.room.name")]).toEqual([
			"Secrets",
			"Secret",
			"Secret rooms",
		]);
		expect([s("hud.codex.new"), s("hud.codex.tag"), s("hud.codex.added")]).toEqual([
			"NEW!",
			"NEW",
			"Added to your Codex",
		]);
		expect(s("hud.codex.toast", { name: s("enemy.swarmer.name") })).toBe("Swarmer · Codex");
		expect([s("run.codex.new", { n: 3 }), s("run.codex.newOne"), s("run.codex.more", { n: 2 })]).toEqual([
			"3 new in the Codex",
			"1 new in the Codex",
			"+2",
		]);
		expect(s("run.codex.total", { pct: 41 })).toBe("Codex 41%");
		expect([s("menu.codex"), s("menu.codexMore", { n: 9 }), s("codex.unavailable")]).toEqual([
			"Codex",
			"9+",
			"Codex unavailable",
		]);
		// the codex-only tells read like the bestiary's: "Name: tip", the name the entry's own name string
		for (const [key, name] of [
			["codex.desc.enemy.swarmer", "enemy.swarmer.name"],
			["codex.desc.enemy.sniper", "enemy.sniper.name"],
			["codex.desc.enemy.bruiser", "enemy.bruiser.name"],
			["codex.desc.boss.act1", "boss.act1.name"],
			["codex.desc.boss.demonlord", "boss.demonlord.name"],
			["codex.desc.secret.room", "secret.room.name"],
		]) {
			const line = s(key);
			expect([key, line.sub(1, s(name).size() + 1)]).toEqual([key, `${s(name)}:`]);
		}
	});
});
