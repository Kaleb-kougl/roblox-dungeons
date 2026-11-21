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
 *   enemy:<k>    archetype id (ENDLESS_ROOM_KINDS'   enemy:swarmer, enemy:slime (slimelets fold in), enemy:golden,
 *                first eleven, the Goldling          enemy:pyrekeeper (its braziers fold in)
 *                GOLDEN_KIND; later kinds appended
 *                after secret:room)
 *   affix:<k>    theme AFFIX_IDS (AffixKind - 1)     affix:hulking
 *   boss:<k>     ENDLESS_BOSSES kind `boss.<k>`      boss:act1 (Mother Mayhem), boss:demonlord
 *   secret:<k>   the secret rooms (theme `secret.<k>`) secret:room (docs/SECRET_ROOMS.md SRD12: the feature as a whole)
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
 *
 * Secrets (docs/SECRET_ROOMS.md SRD12): ONE entry `secret:room` in its own group `secrets`, a section of the last tab
 * (the Bestiary, after the bosses), so it comes after every existing entry (the order lock grows 86 -> 87) and the
 * desktop tab row keeps fitting without a scroll (a seventh tab would not: view/codex screen.spec). Its name is the theme's `secret.room.name`,
 * its description the codex-only `codex.desc.secret.room`, its art `{ kind: "secret" }` (the view draws it, SR9). It is
 * seen at a player's first knock on a crack (the first-time card's sighting id `secret.crack` maps to it:
 * CODEX_SIGHTING_ENTRIES, read by the seed and the tracker's codexSightingId) and found at the first secret the player
 * opens or is present for (the view track's claim, SR9).
 *
 * Later room enemies (docs/NEW_ENEMIES_2.md NXD14, NX9): the room kinds past ENDLESS_ROOM_KINDS' first
 * CODEX_FIRST_ROOM_KINDS (the Shieldwall `bulwark`, the Chainhook, the Snatcher, the Pyre-keeper, then any later
 * append) are a second list: their `enemy:` rows are appended to the catalog AFTER `secret:room`, so every earlier entry
 * keeps its catalog position. They are still group `enemies`: the grid (CODEX_TAB_GROUPS, `order`) shows them at the end
 * of the Enemies section, after the Goldling.
 *
 * @module
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
	PYRE,
	PYREKEEPER,
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
/**
 * One of the Codex screen's tabs (a `CODEX_TABS` member). Every entry belongs to exactly one, and the found / total
 * counts are kept per tab.
 */
export type CodexTab = (typeof CODEX_TABS)[number];

/**
 * Sub-groups inside a tab (the items tab: relics then curses; the bestiary: enemies, champions, bosses, then the secret
 * rooms' section, docs/SECRET_ROOMS.md SRD12).
 */
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
	"secrets",
] as const;
/**
 * One of the sections a tab's grid is divided into (a `CODEX_GROUPS` member). The catalog's append-only order is per
 * group, and `CODEX_TAB_GROUPS` says which tab shows each.
 */
export type CodexGroup = (typeof CODEX_GROUPS)[number];

/** Each tab's groups, in grid order. */
export const CODEX_TAB_GROUPS: { readonly [K in CodexTab]: ReadonlyArray<CodexGroup> } = table.freeze({
	boons: ["boons"],
	evolutions: ["evolutions"],
	duos: ["duos"],
	items: ["relics", "curses"],
	boosts: ["boosts"],
	bestiary: ["enemies", "champions", "bosses", "secrets"],
});

/** Separator between an id's category and its key (`boon:volatile`). */
export const CODEX_ID_SEPARATOR = ":";

/**
 * The shape of any Codex id, this catalog's or a newer server's (Luau pattern): a category of letters / digits starting
 * with a letter, the separator, a key of letters / digits / `_`. At most CODEX_ID_MAX_LENGTH bytes (isCodexIdShape).
 */
export const CODEX_ID_SHAPE = "^%a%w*:[%w_]+$";
/**
 * The longest string that can pass as a Codex id, in bytes: `isCodexIdShape` refuses a longer one before matching it
 * against `CODEX_ID_SHAPE`. It bounds the unknown ids of a stored document that the store transform writes back
 * untouched; every id of this catalog is far shorter.
 */
export const CODEX_ID_MAX_LENGTH = 64;

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
	secret: "secret",
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
 *   secret                                    the secret rooms' look (docs/SECRET_ROOMS.md SR9: the view's, e.g. the
 *                                             crack or the chest; until it has one, the unknown glyph)
 */
export type CodexArtRef =
	| { readonly kind: "boon" | "evo" | "duo" | "relic" | "curse" | "boost"; readonly index: number }
	| { readonly kind: "actor"; readonly archetype: string }
	| { readonly kind: "affix"; readonly affix: AffixId }
	| { readonly kind: "secret" };

/**
 * One row of the Codex catalog: everything the screen needs to place and draw an entry's tile. Built once at module
 * load from the sim, dungeon and theme tables, the same on client and server (the server checks claimed ids against the
 * catalog). Whether a player has seen or found the entry is not here but in their Codex document, keyed by `id`.
 */
export interface CodexEntry {
	/** Stable id (`boon:volatile`): the key in the Codex doc. */
	readonly id: string;
	readonly tab: CodexTab;
	readonly group: CodexGroup;
	/**
	 * Position in its tab (0-based, grid order: groups in CODEX_TAB_GROUPS order, then catalog order within a group). The
	 * appended rows (the later room enemies, NXD14) sit at their group's end here although CODEX_CATALOG lists them last.
	 */
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
 * Archetypes that count as another entry's (a slimelet is an Ooze; a brazier is its Pyre-keeper's, docs/NEW_ENEMIES_2.md
 * NXD15). Anything else outside the catalog (turrets, the dummy, bosses: use codexBossId) has no enemy entry.
 */
export const CODEX_FOLDED_ARCHETYPES: ReadonlyMap<string, string> = new Map([
	[SLIME_SMALL_ID, SLIME_ID],
	[PYRE.id, PYREKEEPER.id],
]);

/**
 * How many of ENDLESS_ROOM_KINDS' rows list their `enemy:` entries before the Goldling (the room kinds up to
 * docs/NEW_ENEMIES.md's, 11). Every later row is appended after `secret:room` (docs/NEW_ENEMIES_2.md NXD14), in
 * ENDLESS_ROOM_KINDS order. Never change it: it fixes the catalog positions stored ids are listed in.
 */
export const CODEX_FIRST_ROOM_KINDS = 11;

/** The theme id of the secret rooms' entry (`secret.room`: name `secret.room.name`, id `secret:room`). */
const SECRET_ROOM_THEME_ID = "secret.room";

/** The secret rooms' entry id (docs/SECRET_ROOMS.md SRD12). */
export const CODEX_SECRET_ID = "secret:room";

/**
 * First-time cards whose sighting id (shared/onboarding SIGHTING_IDS) is an entry of its own rather than an archetype's
 * or an affix's: the first knock on a secret room's crack (`secret.crack`) sees `secret:room` (SRD12). Read by the seed
 * (doc.ts seedFromSightings) and so by the tracker's codexSightingId. Other non-archetype sightings (`pellet.power`,
 * `golden.rumour`) stay no entry.
 */
export const CODEX_SIGHTING_ENTRIES: ReadonlyMap<string, string> = new Map([["secret.crack", CODEX_SECRET_ID]]);

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

/** The catalog's rows in data order, and the rows appended after every one of them (NXD14). */
interface Rows {
	readonly rows: Row[];
	readonly appended: Row[];
}

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

function enemyRow(archetype: string): Row {
	const id = codexId(CODEX_ID_CATEGORY.enemy, archetype);
	ENEMY_BY_ARCHETYPE.set(archetype, id);
	const tell = (BESTIARY_ARCHETYPES as ReadonlyArray<string>).includes(archetype);
	return {
		id,
		group: "enemies",
		nameKey: `enemy.${archetype}.name`,
		descKey: tell
			? bestiaryArchetypeKey(archetype as (typeof BESTIARY_ARCHETYPES)[number])
			: codexDescKey(CODEX_ID_CATEGORY.enemy, archetype),
		artRef: { kind: "actor", archetype },
		hint: ENEMY_HINT,
	};
}

function buildRows(): Rows {
	const rows: Row[] = [];
	const appended: Row[] = [];
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
	for (let i = 0; i < math.min(CODEX_FIRST_ROOM_KINDS, ENDLESS_ROOM_KINDS.size()); i++)
		rows.push(enemyRow(ENDLESS_ROOM_KINDS[i].kind));
	rows.push(enemyRow(GOLDEN_KIND));
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
	// docs/SECRET_ROOMS.md SRD12: the secret rooms, one entry (no hint: an unknown tile reads `???`)
	const secretKey = themeKey(SECRET_ROOM_THEME_ID);
	const secretId = codexId(C.secret, secretKey);
	if (secretId !== CODEX_SECRET_ID) error(`codex: the secret entry is '${secretId}', not '${CODEX_SECRET_ID}'`, 0);
	rows.push({
		id: secretId,
		group: "secrets",
		nameKey: nameKeyOf(SECRET_ROOM_THEME_ID),
		descKey: codexDescKey(C.secret, secretKey),
		artRef: { kind: "secret" },
		hint: NO_HINT,
	});
	// docs/NEW_ENEMIES_2.md NXD14: the later room kinds, after secret:room (the second list).
	for (let i = CODEX_FIRST_ROOM_KINDS; i < ENDLESS_ROOM_KINDS.size(); i++)
		appended.push(enemyRow(ENDLESS_ROOM_KINDS[i].kind));
	return { rows, appended };
}

/**
 * The rows grouped in tab / group order, then the appended rows (NXD14) in their order, each with its tab and its place
 * in the tab's grid (its group's rows, then its group's appended rows). Throws on a duplicate id.
 */
function buildCatalog(): ReadonlyArray<CodexEntry> {
	const { rows, appended } = buildRows();
	const orders = new Map<string, number>();
	const tabs = new Map<string, CodexTab>();
	for (const tab of CODEX_TABS) {
		let order = 0;
		for (const group of CODEX_TAB_GROUPS[tab]) {
			for (const list of [rows, appended]) {
				for (const row of list) {
					if (row.group !== group) continue;
					if (orders.has(row.id)) error(`codex: duplicate entry id '${row.id}'`, 0);
					orders.set(row.id, order);
					tabs.set(row.id, tab);
					order++;
				}
			}
		}
	}
	const out: CodexEntry[] = [];
	for (const tab of CODEX_TABS) {
		for (const group of CODEX_TAB_GROUPS[tab]) {
			for (const row of rows) {
				if (row.group !== group) continue;
				out.push(table.freeze({ ...row, tab, order: orders.get(row.id) as number }));
			}
		}
	}
	for (const row of appended) {
		const tab = tabs.get(row.id);
		if (tab === undefined) error("codex: an appended row's group belongs to no tab", 0);
		out.push(table.freeze({ ...row, tab, order: orders.get(row.id) as number }));
	}
	if (out.size() !== rows.size() + appended.size()) error("codex: a row's group belongs to no tab", 0);
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

/**
 * True for a string shaped like a Codex id (CODEX_ID_SHAPE, at most CODEX_ID_MAX_LENGTH bytes), whether or not this
 * catalog has it: a stored entry a newer server added (mergeStoredCodex keeps those untouched).
 */
export function isCodexIdShape(id: unknown): id is string {
	if (!typeIs(id, "string") || id.size() > CODEX_ID_MAX_LENGTH) return false;
	return string.match(id, CODEX_ID_SHAPE)[0] !== undefined;
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

/** The secret rooms' entry id (`secret:room`, docs/SECRET_ROOMS.md SRD12): seen at a first knock, found at an open. */
export function codexSecretId(): string {
	return CODEX_SECRET_ID;
}
