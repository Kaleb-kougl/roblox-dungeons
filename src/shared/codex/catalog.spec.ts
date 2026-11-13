// The Codex catalog (claude/codex-plan.md CX1): built from the data tables, every endless entity exactly once, nothing
// tutorial / M1-only, ids unique and stable (the append-only lock below), every existing string key in both bundled
// packs, and the game-fact -> id helpers.
import { describe, expect, it } from "@rbxts/jest-globals";
import { CHARACTERS } from "shared/characters";
import {
	AFFIXES,
	AffixKind,
	BOSS_FLOOR_EVERY,
	ENDLESS_BOSSES,
	ENDLESS_ROOM_KINDS,
	TEST_TURRET_KINDS,
} from "shared/dungeon";
import { SIGHTING_IDS } from "shared/onboarding";
import { TUTORIAL_ROOMS } from "shared/run";
import {
	BOONS,
	BOON_MAX_LEVEL,
	Boost,
	CURSES,
	CardKind,
	DUMMY_KIND,
	DUOS,
	DUO_CARD_BASE,
	GOLDEN_KIND,
	NO_BOOST,
	RELICS,
	boonCard,
	boonMaxLevel,
	duoCard,
	hasArchetype,
} from "shared/sim";
import { AFFIX_IDS, BOOST_KINDS, THEME_PACKS } from "shared/theme";
import { boonEvoDescKey, boonEvoNameKey, enemyNameKey, itemDescKey, itemNameKey } from "shared/view/hud";
import {
	CODEX_CATALOG,
	CODEX_DESC_PREFIX,
	CODEX_GROUPS,
	CODEX_SECRET_ID,
	CODEX_SIGHTING_ENTRIES,
	CODEX_TABS,
	CODEX_TAB_GROUPS,
	catalogTotal,
	codexAffixId,
	codexBoonId,
	codexBoostId,
	codexBossId,
	codexCardId,
	codexCurseId,
	codexDescKeys,
	codexDuoId,
	codexEnemyId,
	codexEntry,
	codexEvoId,
	codexGroupTab,
	codexRelicId,
	codexSecretId,
	codexTabEntries,
	isCodexId,
	type CodexGroup,
} from "shared/codex";

/**
 * The append-only order lock: each group's ids in catalog order as of v1. A new entry may be APPENDED to its group
 * (add it at the end here); reordering, renaming or removing one fails. Ids are stored in players' Codex docs.
 */
const ORDER_LOCK: { readonly [K in CodexGroup]: ReadonlyArray<string> } = {
	boons: [
		"boon:sharpened",
		"boon:swiftStrikes",
		"boon:piercingArrows",
		"boon:emberWake",
		"boon:hearty",
		"boon:slippery",
		"boon:deepFlask",
		"boon:warding",
		"boon:lingering",
		"boon:daredevil",
		"boon:bounty",
		"boon:composure",
		"boon:chainSpark",
		"boon:volatile",
		"boon:soulShards",
		"boon:overkill",
		"boon:bastion",
		"boon:riposte",
		"boon:ballista",
		"boon:wrecker",
	],
	evolutions: [
		"evo:sharpened",
		"evo:swiftStrikes",
		"evo:piercingArrows",
		"evo:hearty",
		"evo:slippery",
		"evo:deepFlask",
		"evo:warding",
		"evo:lingering",
		"evo:daredevil",
		"evo:bounty",
		"evo:chainSpark",
		"evo:volatile",
		"evo:soulShards",
		"evo:riposte",
		"evo:ballista",
		"evo:wrecker",
	],
	duos: [
		"duo:fireArrows",
		"duo:blazingTrail",
		"duo:stormBlade",
		"duo:conductor",
		"duo:shrapnel",
		"duo:chainReaction",
		"duo:closeCall",
		"duo:goldRush",
		"duo:unshaken",
		"duo:supernova",
		"duo:skewer",
		"duo:citadel",
		"duo:stoneHeart",
		"duo:thunderGuard",
		"duo:stillwater",
		"duo:rebuke",
		"duo:dragonBolt",
		"duo:powderKeg",
		"duo:fullHeart",
		"duo:happyHour",
	],
	relics: ["relic:mirrorCloak", "relic:hourglass", "relic:vampireFang", "relic:secondWind"],
	curses: ["curse:frailty", "curse:haste", "curse:impatience", "curse:thirst"],
	boosts: ["boost:fury", "boost:quickstep", "boost:frenzy", "boost:aegis"],
	enemies: [
		"enemy:swarmer",
		"enemy:sniper",
		"enemy:bruiser",
		"enemy:imp",
		"enemy:slime",
		"enemy:summoner",
		"enemy:bomber",
		"enemy:charger",
		"enemy:stormcaller",
		"enemy:warbanner",
		"enemy:reaper",
		"enemy:golden",
	],
	champions: ["affix:hulking", "affix:swift", "affix:shielded", "affix:vengeful"],
	bosses: ["boss:act1", "boss:demonlord"],
	// docs/SECRET_ROOMS.md SRD12: the secret rooms' one entry, its own tab and group appended after every other
	secrets: ["secret:room"],
};

/** Every group's lock in catalog order: the whole catalog's (87 entries since the secret rooms). */
const LOCK_TOTAL = 87;

/** Why `ids` breaks the lock (undefined: it holds): every locked id at its place; extra ids only after them. */
function lockProblem(ids: ReadonlyArray<string>, lock: ReadonlyArray<string>): string | undefined {
	for (let i = 0; i < lock.size(); i++) {
		if (ids[i] !== lock[i]) return `position ${i}: expected ${lock[i]}, got ${tostring(ids[i])}`;
	}
	return undefined;
}

function groupIds(group: CodexGroup): string[] {
	const out: string[] = [];
	for (const e of CODEX_CATALOG) if (e.group === group) out.push(e.id);
	return out;
}

describe("codex catalog: order lock", () => {
	it("holds for every group", () => {
		for (const group of CODEX_GROUPS)
			expect([group, lockProblem(groupIds(group), ORDER_LOCK[group])]).toEqual([group, undefined]);
		let locked = 0;
		for (const group of CODEX_GROUPS) locked += ORDER_LOCK[group].size();
		expect([locked, CODEX_CATALOG.size()]).toEqual([LOCK_TOTAL, LOCK_TOTAL]);
	});

	it("appends the secret rooms last: a group (the last tab's last section) and entry after every other (docs/SECRET_ROOMS.md SRD12)", () => {
		expect(CODEX_TABS[CODEX_TABS.size() - 1]).toBe("bestiary");
		expect(CODEX_GROUPS[CODEX_GROUPS.size() - 1]).toBe("secrets");
		expect([...CODEX_TAB_GROUPS.bestiary]).toEqual(["enemies", "champions", "bosses", "secrets"]);
		expect(codexGroupTab("secrets")).toBe("bestiary");
		const last = CODEX_CATALOG[CODEX_CATALOG.size() - 1];
		expect([last.id, last.tab, last.group, last.order]).toEqual([
			CODEX_SECRET_ID,
			"bestiary",
			"secrets",
			catalogTotal("bestiary") - 1,
		]);
		expect(codexSecretId()).toBe("secret:room");
		expect([last.nameKey, last.descKey, last.artRef, last.hint, last.requires]).toEqual([
			"secret.room.name",
			"codex.desc.secret.room",
			{ kind: "secret" },
			{ kind: "none" },
			undefined,
		]);
		// the first-knock card's sighting id claims it (it is no `golden.rumour`: never pinned as no entry)
		expect(CODEX_SIGHTING_ENTRIES.get("secret.crack")).toBe(CODEX_SECRET_ID);
		expect(SIGHTING_IDS.includes("secret.crack")).toBe(true);
		for (const [sighting, id] of CODEX_SIGHTING_ENTRIES as unknown as Map<string, string>) {
			expect([sighting, SIGHTING_IDS.includes(sighting), isCodexId(id)]).toEqual([sighting, true, true]);
		}
		expect(CODEX_SIGHTING_ENTRIES.get("golden.rumour")).toBe(undefined);
	});

	it("passes an append and fails a reorder or a removal", () => {
		const lock = ["a:x", "a:y"];
		expect(lockProblem(["a:x", "a:y"], lock)).toBeUndefined();
		expect(lockProblem(["a:x", "a:y", "a:z"], lock)).toBeUndefined();
		expect(lockProblem(["a:y", "a:x"], lock)).toBeDefined();
		expect(lockProblem(["a:x"], lock)).toBeDefined();
		expect(lockProblem(["a:x", "a:z", "a:y"], lock)).toBeDefined();
	});
});

describe("codex catalog: content", () => {
	it("ids are unique, well formed and resolve", () => {
		const seen = new Set<string>();
		for (const e of CODEX_CATALOG) {
			expect([e.id, seen.has(e.id)]).toEqual([e.id, false]);
			seen.add(e.id);
			expect([e.id, string.match(e.id, "^%l+:%w+$")[0] !== undefined]).toEqual([e.id, true]);
			expect(codexEntry(e.id)).toBe(e);
			expect(isCodexId(e.id)).toBe(true);
		}
		expect(codexEntry("boon:nope")).toBeUndefined();
		expect(codexEntry(5)).toBeUndefined();
		expect(isCodexId(undefined)).toBe(false);
	});

	it("tabs, groups and orders are consistent", () => {
		let total = 0;
		for (const tab of CODEX_TABS) {
			const entries = codexTabEntries(tab);
			expect(catalogTotal(tab)).toBe(entries.size());
			total += entries.size();
			let group = 0;
			for (let i = 0; i < entries.size(); i++) {
				const e = entries[i];
				expect([e.id, e.order, e.tab]).toEqual([e.id, i, tab]);
				// groups contiguous, in CODEX_TAB_GROUPS order
				while (CODEX_TAB_GROUPS[tab][group] !== e.group) {
					group++;
					expect([e.id, group < CODEX_TAB_GROUPS[tab].size()]).toEqual([e.id, true]);
				}
				expect(codexGroupTab(e.group)).toBe(tab);
			}
		}
		expect(catalogTotal()).toBe(total);
		expect(CODEX_CATALOG.size()).toBe(total);
		for (const group of CODEX_GROUPS) expect([group, groupIds(group).size() > 0]).toEqual([group, true]);
	});

	it("counts follow the data tables", () => {
		expect(catalogTotal("boons")).toBe(BOONS.size());
		let evos = 0;
		for (let b = 0; b < BOONS.size(); b++) if (boonMaxLevel(b) >= BOON_MAX_LEVEL) evos++;
		expect(catalogTotal("evolutions")).toBe(evos);
		expect(catalogTotal("duos")).toBe(DUOS.size());
		expect(catalogTotal("items")).toBe(RELICS.size() + CURSES.size());
		expect(catalogTotal("boosts")).toBe(BOOST_KINDS.size());
		// + docs/SECRET_ROOMS.md SRD12's secret rooms (the Bestiary's last section)
		expect(catalogTotal("bestiary")).toBe(
			ENDLESS_ROOM_KINDS.size() + 1 + AFFIXES.unlocks.size() + ENDLESS_BOSSES.size() + 1,
		);
		expect(groupIds("champions").size()).toBe(AFFIX_IDS.size());
		expect(groupIds("secrets")).toEqual([CODEX_SECRET_ID]);
	});

	it("every endless entity appears exactly once", () => {
		const ids = new Set<string>();
		const add = (id: string | undefined) => {
			expect(id).toBeDefined();
			expect([id, ids.has(id as string)]).toEqual([id, false]);
			ids.add(id as string);
		};
		for (let i = 0; i < BOONS.size(); i++) add(codexBoonId(i));
		for (let i = 0; i < BOONS.size(); i++) if (boonMaxLevel(i) >= BOON_MAX_LEVEL) add(codexEvoId(i));
		for (let i = 0; i < DUOS.size(); i++) add(codexDuoId(i));
		for (let i = 0; i < RELICS.size(); i++) add(codexRelicId(i));
		for (let i = 0; i < CURSES.size(); i++) add(codexCurseId(i));
		for (let i = 0; i < BOOST_KINDS.size(); i++) add(codexBoostId(i));
		for (const k of ENDLESS_ROOM_KINDS) add(codexEnemyId(k.kind));
		add(codexEnemyId(GOLDEN_KIND));
		for (const u of AFFIXES.unlocks) add(codexAffixId(u.kind));
		for (const b of ENDLESS_BOSSES) add(codexBossId(b.kind));
		add(codexSecretId());
		expect(ids.size()).toBe(CODEX_CATALOG.size());
		for (const e of CODEX_CATALOG) expect([e.id, ids.has(e.id)]).toEqual([e.id, true]);
	});

	it("holds no tutorial-only or M1-only kind", () => {
		const endless = new Set<string>();
		for (const k of ENDLESS_ROOM_KINDS) endless.add(k.kind);
		for (const room of TUTORIAL_ROOMS) {
			for (const kind of room.kinds) {
				const id = codexEnemyId(kind);
				if (endless.has(kind)) expect([kind, id]).toEqual([kind, `enemy:${kind}`]);
				else expect([kind, id]).toEqual([kind, undefined]);
			}
		}
		for (const kind of TEST_TURRET_KINDS) expect([kind, codexEnemyId(kind)]).toEqual([kind, undefined]);
		expect(codexEnemyId(DUMMY_KIND)).toBeUndefined();
		expect(codexEnemyId("slime.small")).toBe("enemy:slime");
		for (const b of ENDLESS_BOSSES) expect(codexEnemyId(b.kind)).toBeUndefined();
		expect(codexBossId("swarmer")).toBeUndefined();
		for (const e of CODEX_CATALOG) {
			if (e.artRef.kind !== "actor") continue;
			const a = e.artRef.archetype;
			expect([e.id, hasArchetype(a), a === DUMMY_KIND, TEST_TURRET_KINDS.includes(a)]).toEqual([
				e.id,
				true,
				false,
				false,
			]);
		}
	});
});

describe("codex catalog: strings", () => {
	it("every name and description key is in both bundled packs (the codex-only ones since CX5)", () => {
		const packIds = ["placeholder", "vale"];
		for (const packId of packIds) {
			const strings = THEME_PACKS[packId].strings;
			for (const e of CODEX_CATALOG) {
				expect([packId, e.nameKey, typeIs(strings[e.nameKey], "string")]).toEqual([packId, e.nameKey, true]);
				expect([packId, e.descKey, typeIs(strings[e.descKey], "string")]).toEqual([packId, e.descKey, true]);
			}
		}
	});

	it("uses the HUD's key spellings and lists the codex-only descriptions", () => {
		for (let i = 0; i < BOONS.size(); i++) {
			const e = codexEntry(codexBoonId(i))!;
			expect([e.nameKey, e.descKey]).toEqual([itemNameKey(BOONS[i].id), itemDescKey(BOONS[i].id)]);
			const evo = codexEntry(codexEvoId(i));
			if (evo !== undefined) {
				expect([evo.nameKey, evo.descKey]).toEqual([boonEvoNameKey(BOONS[i].id), boonEvoDescKey(BOONS[i].id)]);
			}
		}
		for (let i = 0; i < DUOS.size(); i++) expect(codexEntry(codexDuoId(i))!.nameKey).toBe(itemNameKey(DUOS[i].id));
		for (const k of ENDLESS_ROOM_KINDS)
			expect(codexEntry(codexEnemyId(k.kind))!.nameKey).toBe(enemyNameKey(k.kind));
		// R6: the codex-only lines are exactly the descriptions with no existing string
		expect(codexDescKeys()).toEqual([
			"codex.desc.enemy.swarmer",
			"codex.desc.enemy.sniper",
			"codex.desc.enemy.bruiser",
			"codex.desc.boss.act1",
			"codex.desc.boss.demonlord",
			// docs/SECRET_ROOMS.md SRD12
			"codex.desc.secret.room",
		]);
		const strings = THEME_PACKS.placeholder.strings;
		for (const e of CODEX_CATALOG) {
			if (e.group === "enemies" || e.group === "champions") {
				const own = e.descKey.sub(1, CODEX_DESC_PREFIX.size()) === CODEX_DESC_PREFIX;
				expect([e.id, own || e.descKey.sub(1, 9) === "bestiary."]).toEqual([e.id, true]);
				// a codex-only line exists only where no bestiary line does
				if (own)
					expect([e.id, strings[`bestiary.${(e.artRef as { archetype: string }).archetype}`]]).toEqual([
						e.id,
						undefined,
					]);
			}
		}
	});
});

describe("codex catalog: gates and hints", () => {
	function characterOf(weapon: string | undefined): string | undefined {
		if (weapon === undefined) return undefined;
		for (const c of CHARACTERS) for (const w of c.loadout) if (w === weapon) return c.id;
		return "none";
	}

	it("weapon-gated entries name the character that carries the weapon", () => {
		for (let i = 0; i < BOONS.size(); i++) {
			const want = characterOf(BOONS[i].requires);
			expect([i, codexEntry(codexBoonId(i))!.requires]).toEqual([i, want]);
			const evo = codexEntry(codexEvoId(i));
			if (evo !== undefined) expect([i, evo.requires]).toEqual([i, want]);
		}
		for (let i = 0; i < DUOS.size(); i++) {
			const want = characterOf(BOONS[DUOS[i].a].requires) ?? characterOf(BOONS[DUOS[i].b].requires);
			expect([i, codexEntry(codexDuoId(i))!.requires]).toEqual([i, want]);
		}
		for (let i = 0; i < RELICS.size(); i++) {
			expect([i, codexEntry(codexRelicId(i))!.requires]).toEqual([i, characterOf(RELICS[i].requires)]);
		}
		expect(codexEntry("boon:riposte")!.requires).toBe("knight");
		expect(codexEntry("boon:ballista")!.requires).toBe("archer");
		expect(codexEntry("relic:mirrorCloak")!.requires).toBe("knight");
		expect(codexEntry("duo:fireArrows")!.requires).toBe("archer");
		expect(codexEntry("boon:volatile")!.requires).toBeUndefined();
		for (const e of CODEX_CATALOG) {
			if (e.group === "curses" || e.group === "boosts" || codexGroupTab(e.group) === "bestiary") {
				expect([e.id, e.requires]).toEqual([e.id, undefined]);
			}
		}
	});

	it("hints come from the data", () => {
		for (const u of AFFIXES.unlocks) {
			expect(codexEntry(codexAffixId(u.kind))!.hint).toEqual({ kind: "affix", floor: u.fromFloor });
		}
		for (const b of ENDLESS_BOSSES) {
			expect(codexEntry(codexBossId(b.kind))!.hint).toEqual({ kind: "boss", every: BOSS_FLOOR_EVERY });
		}
		for (let i = 0; i < BOONS.size(); i++) {
			const evo = codexEntry(codexEvoId(i));
			if (evo !== undefined) expect(evo.hint).toEqual({ kind: "evo", boon: codexBoonId(i) });
			expect(codexEntry(codexBoonId(i))!.hint).toEqual({ kind: "none" });
		}
		for (let i = 0; i < DUOS.size(); i++) {
			expect(codexEntry(codexDuoId(i))!.hint).toEqual({
				kind: "duo",
				a: codexBoonId(DUOS[i].a),
				b: codexBoonId(DUOS[i].b),
			});
		}
		for (const id of groupIds("enemies")) expect(codexEntry(id)!.hint).toEqual({ kind: "enemy" });
		for (const g of ["relics", "curses", "boosts", "secrets"] as const) {
			for (const id of groupIds(g)) expect(codexEntry(id)!.hint).toEqual({ kind: "none" });
		}
		// R3 (read from data, never hard-coded): Hulking and Swift 4, Shielded 7, Vengeful 9 today
		expect(codexEntry("affix:shielded")!.hint).toEqual({ kind: "affix", floor: 7 });
	});
});

describe("codex catalog: helpers", () => {
	it("map game facts to ids and back", () => {
		for (let i = 0; i < BOONS.size(); i++) {
			expect(codexEntry(codexBoonId(i))!.artRef).toEqual({ kind: "boon", index: i });
			expect(codexCardId(boonCard(i))).toBe(codexBoonId(i));
			expect(codexCardId(boonCard(i), CardKind.NEW)).toBe(codexBoonId(i));
			expect(codexCardId(boonCard(i), CardKind.UPGRADE)).toBe(codexBoonId(i));
			expect(codexCardId(boonCard(i), CardKind.EVOLUTION)).toBe(codexEvoId(i));
			const evo = codexEvoId(i);
			if (evo !== undefined) expect(codexEntry(evo)!.artRef).toEqual({ kind: "evo", index: i });
			else expect(boonMaxLevel(i) < BOON_MAX_LEVEL).toBe(true);
		}
		for (let i = 0; i < DUOS.size(); i++) {
			expect(codexEntry(codexDuoId(i))!.artRef).toEqual({ kind: "duo", index: i });
			expect(codexCardId(duoCard(i))).toBe(codexDuoId(i));
			expect(codexCardId(duoCard(i), CardKind.DUO)).toBe(codexDuoId(i));
		}
		for (let i = 0; i < RELICS.size(); i++)
			expect(codexEntry(codexRelicId(i))!.artRef).toEqual({ kind: "relic", index: i });
		for (let i = 0; i < CURSES.size(); i++)
			expect(codexEntry(codexCurseId(i))!.artRef).toEqual({ kind: "curse", index: i });
		for (let i = 0; i < BOOST_KINDS.size(); i++) {
			expect(codexEntry(codexBoostId(i))!.artRef).toEqual({ kind: "boost", index: i });
			expect(codexBoostId(i)).toBe(`boost:${BOOST_KINDS[i]}`);
		}
		for (const u of AFFIXES.unlocks) {
			const e = codexEntry(codexAffixId(u.kind))!;
			expect(e.artRef).toEqual({ kind: "affix", affix: AFFIX_IDS[u.kind - 1] });
		}
		for (const b of ENDLESS_BOSSES)
			expect(codexEntry(codexBossId(b.kind))!.artRef).toEqual({ kind: "actor", archetype: b.kind });

		expect(codexBoonId(13)).toBe("boon:volatile");
		expect(codexEvoId(3)).toBeUndefined(); // Ember Wake: legendary
		expect(codexBoostId(Boost.AEGIS)).toBe("boost:aegis");
		expect(codexBoostId(NO_BOOST)).toBeUndefined();
		expect(codexAffixId(AffixKind.NONE)).toBeUndefined();
		expect(codexAffixId(AffixKind.VENGEFUL)).toBe("affix:vengeful");
		expect(codexBossId("boss.act1")).toBe("boss:act1");
		expect(codexEnemyId("golden")).toBe("enemy:golden");
		expect(codexCardId(-1)).toBeUndefined();
		expect(codexCardId(BOONS.size())).toBeUndefined();
		expect(codexCardId(DUO_CARD_BASE + DUOS.size())).toBeUndefined();
		expect(codexCardId(0.5)).toBeUndefined();
		expect(codexBoonId(-1)).toBeUndefined();
		expect(codexRelicId(RELICS.size())).toBeUndefined();
		expect(codexCurseId(-1)).toBeUndefined();
		expect(codexDuoId(DUOS.size())).toBeUndefined();
	});
});
