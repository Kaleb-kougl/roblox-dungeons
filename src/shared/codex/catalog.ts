/**
 * The Codex catalog (claude/codex-plan.md "Design" CX1): every entry the Codex lists, built from the sim / dungeon /
 * theme data tables (never a hand-written list of names), with its stable id, its tab and group, its place in the tab,
 * its theme string keys, a reference for its art, the hint an unknown tile shows and the character it needs. Pure data
 * and lookups, Roblox-API-free (headlessly tested; CodexService validates claims with it).
 *
 * Entry ids are stable strings `<category>:<key>` (CODEX_ID_SEPARATOR ":"). The key is the theme id with its category
 * prefix dropped, spelled exactly as the theme spells it (camelCase kept):
 *
 *   boon:<k>     BOONS[i].id `boon.<k>`              boon:swiftStrikes, boon:volatile
 *   evo:<k>      the evolution of boon `boon.<k>`   evo:sharpened (Executioner), evo:wrecker (Demolition)
 *   duo:<k>      DUOS[i].id `duo.<k>`                duo:fireArrows, duo:chainReaction
 *   relic:<k>    RELICS[i].id `relic.<k>`            relic:mirrorCloak
 *   curse:<k>    CURSES[i].id `curse.<k>`            curse:frailty
 *   boost:<k>    theme BOOST_KINDS (Boost order)     boost:fury
 *   enemy:<k>    archetype id (ENDLESS_ROOM_KINDS,   enemy:swarmer, enemy:slime (slimelets fold in), enemy:golden
 *                then the Goldling GOLDEN_KIND)
 *   affix:<k>    theme AFFIX_IDS (AffixKind - 1)     affix:hulking
 *   boss:<k>     ENDLESS_BOSSES kind `boss.<k>`      boss:act1 (Mother Mayhem), boss:demonlord
 *
 * Ids are stored in players' Codex docs (KV_Codex_v1): never rename one. The catalog order is APPEND ONLY per group
 * (catalog.spec.ts holds the lock list): the source tables are append-only, so a new boon / duo / room kind lands at its
 * group's end. Removing an entry drops it from every doc on the next decode (unknown ids decode away).
 *
 * Not in v1 (decision R5): the power pellet, pacts, vault tiers, characters, weapons, turrets, the training dummy and
 * the bosses' summoned adds (plain swarmers). `requires` (R7) is the character a weapon-gated entry needs (a duo or an
 * evolution inherits its boons' gate); gated entries count toward 100 %.
 *
 * Descriptions (R6): the existing line where one exists (the draft text, the evolution text, `bestiary.<id>`), else a
 * codex-only key `codex.desc.<category>.<key>` (codexDescKeys lists them; the theme adds the strings, CX5).
 */
import { CHARACTERS, type CharacterId } from "shared/characters";
import { AFFIXES, BOSS_FLOOR_EVERY, ENDLESS_BOSSES, ENDLESS_ROOM_KINDS, affixThemeIndex } from "shared/dungeon";
import {
	BOONS,
	BOON_MAX_LEVEL,
	CURSES,
	CardKind,
	DUOS,
	GOLDEN_KIND,
	RELICS,
	SLIME_ID,
	SLIME_SMALL_ID,
	boonMaxLevel,
	cardBoon,
	cardDuo,
	type CardKindId,
} from "shared/sim";
import {
	AFFIX_IDS,
	BESTIARY_ARCHETYPES,
	BOOST_KINDS,
	affixNameKey,
	bestiaryAffixKey,
	bestiaryArchetypeKey,
	boostStringKey,
	type AffixId,
} from "shared/theme";

/** The Codex screen's tabs, in tab-row order. */
export const CODEX_TABS = ["boons", "evolutions", "duos", "items", "boosts", "bestiary"] as const;
export type CodexTab = (typeof CODEX_TABS)[number];

/** Sub-groups inside a tab (the items tab: relics then curses; the bestiary: enemies, champions, bosses). */
export const CODEX_GROUPS = [
	"boons",
	"evolutions",
	"duos",
	"relics",
	"curses",
	"boosts",
	"enemies",
	"champions",
	"bosses",
] as const;
export type CodexGroup = (typeof CODEX_GROUPS)[number];

/** Each tab's groups, in grid order. */
export const CODEX_TAB_GROUPS: { readonly [K in CodexTab]: ReadonlyArray<CodexGroup> } = table.freeze({
	boons: ["boons"],
	evolutions: ["evolutions"],
	duos: ["duos"],
	items: ["relics", "curses"],
	boosts: ["boosts"],
	bestiary: ["enemies", "champions", "bosses"],
});

/** Separator between an id's category and its key (`boon:volatile`). */
export const CODEX_ID_SEPARATOR = ":";

/** The category part of each id (`<category>:<key>`). */
export const CODEX_ID_CATEGORY = table.freeze({
	boon: "boon",
	evo: "evo",
	duo: "duo",
	relic: "relic",
	curse: "curse",
	boost: "boost",
	enemy: "enemy",
	affix: "affix",
	boss: "boss",
});

/** Prefix of the codex-only description keys (R6): `codex.desc.<category>.<key>`. */
export const CODEX_DESC_PREFIX = "codex.desc.";

/**
 * What an unknown tile's hint line says (the view formats it, CX7; R3):
 *   none    `???`
 *   enemy   `Lurks deeper in the dungeon` (no floor: unlock floors differ between endless and the Daily)
 *   affix   `Champions from floor {floor}` (the affix's unlock floor, AFFIXES.unlocks)
 *   boss    `Waits on every boss floor` (`every`: BOSS_FLOOR_EVERY)
 *   evo     `Take {boon} three times` once that boon is found (`boon`: its entry id), else `???`
 *   duo     `Recipe: {a} + {b}` once both boons are found (`a`, `b`: their entry ids), else `Combine two boons`
 */
export type CodexHint =
	| { readonly kind: "none" }
	| { readonly kind: "enemy" }
	| { readonly kind: "affix"; readonly floor: number }
	| { readonly kind: "boss"; readonly every: number }
	| { readonly kind: "evo"; readonly boon: string }
	| { readonly kind: "duo"; readonly a: string; readonly b: string };

/**
 * Where an entry's tile art comes from (the view resolves it, CX7 `codexTileArt`):
 *   boon / evo / duo / relic / curse / boost  the RunItems cell look of that index (evo: the boon's index with the
 *                                             evolved frame; boost: the Boost index)
 *   actor                                     the archetype's sprite (`archetypeAt(archetypeIndex(id)).spriteId`)
 *   affix                                     the affix's look (theme `affix.<id>` role)
 */
export type CodexArtRef =
	| { readonly kind: "boon" | "evo" | "duo" | "relic" | "curse" | "boost"; readonly index: number }
	| { readonly kind: "actor"; readonly archetype: string }
	| { readonly kind: "affix"; readonly affix: AffixId };

export interface CodexEntry {
	/** Stable id (`boon:volatile`): the key in the Codex doc. */
	readonly id: string;
	readonly tab: CodexTab;
	readonly group: CodexGroup;
	/** Position in its tab (0-based, grid order: groups in CODEX_TAB_GROUPS order, then data order). */
	readonly order: number;
	/** Theme string keys of the name and the description / tell. */
	readonly nameKey: string;
	readonly descKey: string;
	readonly artRef: CodexArtRef;
	readonly hint: CodexHint;
	/** The character this entry needs (a weapon-gated boon / relic / duo / evolution); absent: any character. */
	readonly requires?: CharacterId;
}

/**
 * Archetypes that count as another entry's (a slimelet is an Ooze). Anything else outside the catalog (turrets, the
 * dummy, bosses: use codexBossId) has no enemy entry.
 */
export const CODEX_FOLDED_ARCHETYPES: ReadonlyMap<string, string> = new Map([[SLIME_SMALL_ID, SLIME_ID]]);

// --- Building ------------------------------------------------------------------------------------------------------

function codexId(category: string, key: string): string {
	return `${category}${CODEX_ID_SEPARATOR}${key}`;
}

/** The part of a theme id after its first `.` (`boon.swiftStrikes` -> `swiftStrikes`, `boss.act1` -> `act1`). */
function themeKey(themeId: string): string {
	const [dot] = string.find(themeId, ".", 1, true);
	if (dot === undefined) error(`codex: theme id '${themeId}' has no category prefix`, 0);
	return themeId.sub(dot + 1);
}

function nameKeyOf(themeId: string): string {
	return `${themeId}.name`;
}

function descKeyOf(themeId: string): string {
	return `${themeId}.desc`;
}

function codexDescKey(category: string, key: string): string {
	return `${CODEX_DESC_PREFIX}${category}.${key}`;
}

/** The character whose loadout carries `weapon` (undefined for no gate). Throws when no single character does. */
function characterFor(weapon: string | undefined): CharacterId | undefined {
	if (weapon === undefined) return undefined;
	let found: CharacterId | undefined;
	for (const c of CHARACTERS) {
		let carries = false;
		for (const w of c.loadout) if (w === weapon) carries = true;
		if (!carries) continue;
		if (found !== undefined) error(`codex: weapon '${weapon}' is carried by more than one character`, 0);
		found = c.id;
	}
	if (found === undefined) error(`codex: no character carries weapon '${weapon}'`, 0);
	return found;
}

/** Both boons' gate (a duo or an evolution). Throws when they need different characters (no one could find it). */
function joinGates(a: CharacterId | undefined, b: CharacterId | undefined): CharacterId | undefined {
	if (a !== undefined && b !== undefined && a !== b) error(`codex: an entry needs both ${a} and ${b}`, 0);
	return a ?? b;
}

const NO_HINT: CodexHint = table.freeze({ kind: "none" });
const ENEMY_HINT: CodexHint = table.freeze({ kind: "enemy" });

type Row = Omit<CodexEntry, "order" | "tab">;

const GROUP_TAB = ((): ReadonlyMap<CodexGroup, CodexTab> => {
	const m = new Map<CodexGroup, CodexTab>();
	for (const tab of CODEX_TABS) for (const g of CODEX_TAB_GROUPS[tab]) m.set(g, tab);
	return m;
})();

/** Boon index -> entry id (and the evolution's, undefined for a legendary), duo index -> id, ... */
const BOON_IDS: string[] = [];
const EVO_IDS: (string | undefined)[] = [];
const DUO_IDS: string[] = [];
const RELIC_IDS: string[] = [];
const CURSE_IDS: string[] = [];
const BOOST_IDS: string[] = [];
const AFFIX_BY_KIND = new Map<number, string>();
const ENEMY_BY_ARCHETYPE = new Map<string, string>();
const BOSS_BY_ARCHETYPE = new Map<string, string>();

function buildRows(): Row[] {
	const rows: Row[] = [];
	const C = CODEX_ID_CATEGORY;
	const boonGates: (CharacterId | undefined)[] = [];
	for (let i = 0; i < BOONS.size(); i++) {
		const def = BOONS[i];
		const id = codexId(C.boon, themeKey(def.id));
		const requires = characterFor(def.requires);
		boonGates[i] = requires;
		BOON_IDS[i] = id;
		rows.push({
			id,
			group: "boons",
			nameKey: nameKeyOf(def.id),
			descKey: descKeyOf(def.id),
			artRef: { kind: "boon", index: i },
			hint: NO_HINT,
			requires,
		});
	}
	for (let i = 0; i < BOONS.size(); i++) {
		// The evolution is a common / rare boon's level III (a legendary's only level is I: no evolution).
		if (boonMaxLevel(i) < BOON_MAX_LEVEL) continue;
		const def = BOONS[i];
		const id = codexId(C.evo, themeKey(def.id));
		EVO_IDS[i] = id;
		rows.push({
			id,
			group: "evolutions",
			nameKey: `${def.id}.evo.name`,
			descKey: `${def.id}.evo.desc`,
			artRef: { kind: "evo", index: i },
			hint: { kind: "evo", boon: BOON_IDS[i] },
			requires: boonGates[i],
		});
	}
	for (let i = 0; i < DUOS.size(); i++) {
		const def = DUOS[i];
		const id = codexId(C.duo, themeKey(def.id));
		DUO_IDS[i] = id;
		rows.push({
			id,
			group: "duos",
			nameKey: nameKeyOf(def.id),
			descKey: descKeyOf(def.id),
			artRef: { kind: "duo", index: i },
			hint: { kind: "duo", a: BOON_IDS[def.a], b: BOON_IDS[def.b] },
			requires: joinGates(boonGates[def.a], boonGates[def.b]),
		});
	}
	for (let i = 0; i < RELICS.size(); i++) {
		const def = RELICS[i];
		const id = codexId(C.relic, themeKey(def.id));
		RELIC_IDS[i] = id;
		rows.push({
			id,
			group: "relics",
			nameKey: nameKeyOf(def.id),
			descKey: descKeyOf(def.id),
			artRef: { kind: "relic", index: i },
			hint: NO_HINT,
			requires: characterFor(def.requires),
		});
	}
	for (let i = 0; i < CURSES.size(); i++) {
		const def = CURSES[i];
		const id = codexId(C.curse, themeKey(def.id));
		CURSE_IDS[i] = id;
		rows.push({
			id,
			group: "curses",
			nameKey: nameKeyOf(def.id),
			descKey: descKeyOf(def.id),
			artRef: { kind: "curse", index: i },
			hint: NO_HINT,
		});
	}
	for (let i = 0; i < BOOST_KINDS.size(); i++) {
		const kind = BOOST_KINDS[i];
		const id = codexId(C.boost, kind);
		BOOST_IDS[i] = id;
		rows.push({
			id,
			group: "boosts",
			nameKey: boostStringKey(kind, "name"),
			descKey: boostStringKey(kind, "desc"),
			artRef: { kind: "boost", index: i },
			hint: NO_HINT,
		});
	}
	const enemyKinds: string[] = [];
	for (const k of ENDLESS_ROOM_KINDS) enemyKinds.push(k.kind);
	enemyKinds.push(GOLDEN_KIND);
	for (const archetype of enemyKinds) {
		const id = codexId(C.enemy, archetype);
		ENEMY_BY_ARCHETYPE.set(archetype, id);
		const tell = (BESTIARY_ARCHETYPES as ReadonlyArray<string>).includes(archetype);
		rows.push({
			id,
			group: "enemies",
			nameKey: `enemy.${archetype}.name`,
			descKey: tell
				? bestiaryArchetypeKey(archetype as (typeof BESTIARY_ARCHETYPES)[number])
				: codexDescKey(C.enemy, archetype),
			artRef: { kind: "actor", archetype },
			hint: ENEMY_HINT,
		});
	}
	for (const unlock of AFFIXES.unlocks) {
		const affix = AFFIX_IDS[affixThemeIndex(unlock.kind)];
		if (affix === undefined) error(`codex: affix kind ${unlock.kind} has no theme id`, 0);
		const id = codexId(C.affix, affix);
		AFFIX_BY_KIND.set(unlock.kind, id);
		rows.push({
			id,
			group: "champions",
			nameKey: affixNameKey(affix),
			descKey: bestiaryAffixKey(affix),
			artRef: { kind: "affix", affix },
			hint: { kind: "affix", floor: unlock.fromFloor },
		});
	}
	for (const boss of ENDLESS_BOSSES) {
		const key = themeKey(boss.kind);
		const id = codexId(C.boss, key);
		BOSS_BY_ARCHETYPE.set(boss.kind, id);
		rows.push({
			id,
			group: "bosses",
			nameKey: nameKeyOf(boss.kind),
			descKey: codexDescKey(C.boss, key),
			artRef: { kind: "actor", archetype: boss.kind },
			hint: { kind: "boss", every: BOSS_FLOOR_EVERY },
		});
	}
	return rows;
}

/** Rows grouped in tab / group order, each with its tab and its place in the tab. Throws on a duplicate id. */
function buildCatalog(): ReadonlyArray<CodexEntry> {
	const rows = buildRows();
	const out: CodexEntry[] = [];
	const ids = new Set<string>();
	for (const tab of CODEX_TABS) {
		let order = 0;
		for (const group of CODEX_TAB_GROUPS[tab]) {
			for (const row of rows) {
				if (row.group !== group) continue;
				if (ids.has(row.id)) error(`codex: duplicate entry id '${row.id}'`, 0);
				ids.add(row.id);
				out.push(table.freeze({ ...row, tab, order }));
				order++;
			}
		}
	}
	if (out.size() !== rows.size()) error("codex: a row's group belongs to no tab", 0);
	return table.freeze(out);
}

/** Every Codex entry: tabs in CODEX_TABS order, each tab's groups in order, then data order. */
export const CODEX_CATALOG: ReadonlyArray<CodexEntry> = buildCatalog();

const BY_ID = ((): ReadonlyMap<string, CodexEntry> => {
	const m = new Map<string, CodexEntry>();
	for (const e of CODEX_CATALOG) m.set(e.id, e);
	return m;
})();

const TAB_TOTALS = ((): ReadonlyMap<CodexTab, number> => {
	const m = new Map<CodexTab, number>();
	for (const e of CODEX_CATALOG) m.set(e.tab, (m.get(e.tab) ?? 0) + 1);
	return m;
})();

// --- Lookups -------------------------------------------------------------------------------------------------------

/** The entry with id `id` (undefined for an unknown id or a non-string). */
export function codexEntry(id: unknown): CodexEntry | undefined {
	return typeIs(id, "string") ? BY_ID.get(id) : undefined;
}

/** True for a catalog entry id (an untrusted value: a remote's argument, a stored key). */
export function isCodexId(id: unknown): id is string {
	return codexEntry(id) !== undefined;
}

/** The number of entries in `tab` (every tab when absent): the 100 % mark. */
export function catalogTotal(tab?: CodexTab): number {
	return tab === undefined ? CODEX_CATALOG.size() : TAB_TOTALS.get(tab) ?? 0;
}

/** The entries of `tab`, in grid order. */
export function codexTabEntries(tab: CodexTab): CodexEntry[] {
	const out: CodexEntry[] = [];
	for (const e of CODEX_CATALOG) if (e.tab === tab) out.push(e);
	return out;
}

/** The tab a group belongs to. */
export function codexGroupTab(group: CodexGroup): CodexTab {
	return GROUP_TAB.get(group) as CodexTab;
}

/** The codex-only description keys (`codex.desc.*`, R6), in catalog order: the theme must define each (CX5). */
export function codexDescKeys(): string[] {
	const out: string[] = [];
	for (const e of CODEX_CATALOG)
		if (e.descKey.sub(1, CODEX_DESC_PREFIX.size()) === CODEX_DESC_PREFIX) out.push(e.descKey);
	return out;
}

/** The entry id of boon index `boon` (Boon / BOONS), or undefined. */
export function codexBoonId(boon: number): string | undefined {
	return BOON_IDS[boon];
}

/** The entry id of the evolution of boon index `boon`; undefined for a legendary (none) or a bad index. */
export function codexEvoId(boon: number): string | undefined {
	return EVO_IDS[boon];
}

/** The entry id of duo index `duo` (Duo / DUOS), or undefined. */
export function codexDuoId(duo: number): string | undefined {
	return DUO_IDS[duo];
}

/**
 * The entry a draft card names (card ids: a boon index, or DUO_CARD_BASE + a duo index). With `kind`
 * CardKind.EVOLUTION a boon card names the boon's evolution; any other kind (or none) names the boon itself.
 * Undefined for no card or an unknown id.
 */
export function codexCardId(card: number, kind?: CardKindId): string | undefined {
	const duo = cardDuo(card);
	if (duo >= 0) return codexDuoId(duo);
	const boon = cardBoon(card);
	if (boon < 0) return undefined;
	return kind === CardKind.EVOLUTION ? codexEvoId(boon) : codexBoonId(boon);
}

/** The entry id of relic index `relic` (Relic / RELICS), or undefined. */
export function codexRelicId(relic: number): string | undefined {
	return RELIC_IDS[relic];
}

/** The entry id of curse index `curse` (Curse / CURSES), or undefined. */
export function codexCurseId(curse: number): string | undefined {
	return CURSE_IDS[curse];
}

/** The entry id of boost index `boost` (Boost / BOOSTS), or undefined (NO_BOOST, a bad index). */
export function codexBoostId(boost: number): string | undefined {
	return BOOST_IDS[boost];
}

/**
 * The enemy entry of archetype id `archetype` (a numeric ActorState.kind: `archetypeAt(kind).id`). A slimelet
 * (`slime.small`) is the Ooze's. Undefined for anything outside the catalog: turrets, the dummy, bosses (codexBossId).
 */
export function codexEnemyId(archetype: string): string | undefined {
	return ENEMY_BY_ARCHETYPE.get(CODEX_FOLDED_ARCHETYPES.get(archetype) ?? archetype);
}

/** The entry id of affix kind `affix` (shared/dungeon AffixKind 1..4), or undefined (AffixKind.NONE, unknown). */
export function codexAffixId(affix: number): string | undefined {
	return AFFIX_BY_KIND.get(affix);
}

/** The boss entry of archetype id `archetype` (`boss.act1`), or undefined (not an endless boss). */
export function codexBossId(archetype: string): string | undefined {
	return BOSS_BY_ARCHETYPE.get(archetype);
}
