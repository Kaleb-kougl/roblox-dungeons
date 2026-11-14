// Silver in crates census (docs/SILVER.md SC4, the dungeon half): run seeds x floors 1-20, every floor built as the
// endless worlds build it (shared/run endlessRunFloor's options: vaults, modifiers, secrets, Silver). Per depth band:
// Silver pieces and Silver per floor, floors short of the band's min, the crate share of Silver pieces, rooms holding 1
// or 2, twinkling pieces per floor (boost + Silver + the Goldling's piece); per floor modifier (natural and forced):
// floors, Silver pieces, and every slot valid (clutter, never loot, never the Goldling's or an inert piece, at most 2 a
// room). Printed. OPT-IN size: the default sample (run seeds 1-4) runs in the suite; `--census` (shared/run/testing
// censusRequested) runs the plan's run seeds 1-40 x floors 1-20 (800 floor builds plus the forced-modifier sweep).
// The bot half (how many Silver pieces an endless bot breaks, crates' share of the run amount) is
// shared/run silverCensus.spec.ts.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	BREAKABLE_KINDS,
	BREAKABLE_SILVER,
	FLOOR_MODIFIER_WORLD_ALL,
	FloorModifier,
	MODIFIERS,
	breakableSilverBand,
	buildEndlessFloor,
	generateDungeon,
	gridToWorld,
	roomAt,
	type Dungeon,
	type EndlessFloorLayout,
	type EndlessFloorOptions,
	type ForgeParams,
} from "shared/dungeon";
import { censusRequested } from "shared/run/testing";

const FULL = censusRequested();
const RUNS = FULL ? 40 : 4;
const FIRST = 1;
const LAST = 20;
/** The forced-modifier sweep: run seeds x these floors (non-boss floors from 2). */
const FORCED_RUNS = FULL ? 10 : 2;
const FORCED_FLOORS: ReadonlyArray<number> = [2, 3, 4, 6, 7, 8, 9, 11, 13, 14, 16, 18, 19];

const dungeons = new Map<string, Dungeon>();
function dungeonFor(params: ForgeParams): Dungeon {
	const key = `${params.seed}/${params.roomCount}`;
	let d = dungeons.get(key);
	if (d === undefined) {
		d = generateDungeon(params);
		dungeons.set(key, d);
		// Keep memory flat over 800 floors: a floor's dungeon is built once per build pair.
		if (dungeons.size() > 8) dungeons.clear();
	}
	return d;
}

const OPTIONS: EndlessFloorOptions = {
	vaults: true,
	unlockFloors: false,
	modifiers: FLOOR_MODIFIER_WORLD_ALL,
	secrets: true,
	silver: true,
};

const BANDS = ["kept", "worn", "ruined", "abyss"];
function bandIndex(floor: number): number {
	const b = breakableSilverBand(floor);
	return BREAKABLE_SILVER.bands.findIndex((x) => x.fromFloor === b.fromFloor);
}

/** The slots before the vault's chest, the Goldling's piece and the secret's pieces. */
function clutterCount(l: EndlessFloorLayout): number {
	let c = l.breakables?.size() ?? 0;
	if (l.vault !== undefined) c = math.min(c, l.vault.slot);
	if (l.golden !== undefined) c = math.min(c, l.golden.piece);
	if (l.secret !== undefined) c = math.min(c, l.secret.crackSlot);
	return c;
}

/** The floor's Silver slots are valid (see the file comment); returns the per-room counts. */
function checkFloor(l: EndlessFloorLayout): Map<number, number> {
	const all = l.breakables ?? [];
	const loot = new Set<number>();
	for (const x of l.breakableLoot ?? []) loot.add(x.slot);
	const perRoom = new Map<number, number>();
	for (const s of l.breakableSilver ?? []) {
		expect(s.slot >= 0 && s.slot < clutterCount(l)).toBe(true);
		expect((BREAKABLE_KINDS as ReadonlyArray<string>).includes(all[s.slot].kind)).toBe(true);
		expect(loot.has(s.slot)).toBe(false);
		if (l.golden !== undefined) expect(s.slot).never.toBe(l.golden.piece);
		const room = roomAt(l.encounter, gridToWorld(all[s.slot].x), gridToWorld(all[s.slot].y))?.id ?? -1;
		perRoom.set(room, (perRoom.get(room) ?? 0) + 1);
	}
	for (const [room, n] of perRoom) if (room >= 0) expect(n <= BREAKABLE_SILVER.maxPerRoom).toBe(true);
	return perRoom;
}

const f2 = (x: number) => string.format("%.2f", x);
const pct = (n: number, of: number) => (of > 0 ? string.format("%.1f", (100 * n) / of) : "-");

describe("breakable silver: census (SC4)", () => {
	it(`per band and per modifier (run seeds 1-${RUNS} x floors ${FIRST}-${LAST}, printed)`, () => {
		const t0 = os.clock();
		const floors = [0, 0, 0, 0];
		const pieces = [0, 0, 0, 0];
		const silver = [0, 0, 0, 0];
		const short = [0, 0, 0, 0];
		const glints = [0, 0, 0, 0];
		const lootPieces = [0, 0, 0, 0];
		const clutter = [0, 0, 0, 0];
		let crates = 0;
		let barrels = 0;
		const roomsWith = [0, 0, 0]; // rooms holding 1, 2 Silver pieces (index 1, 2)
		const modFloors = new Map<number, number>();
		const modPieces = new Map<number, number>();
		for (let run = 1; run <= RUNS; run++)
			for (let floor = FIRST; floor <= LAST; floor++) {
				const l = buildEndlessFloor(run, floor, dungeonFor, 1, OPTIONS);
				const b = bandIndex(floor);
				const perRoom = checkFloor(l);
				const list = l.breakableSilver ?? [];
				floors[b]++;
				pieces[b] += list.size();
				clutter[b] += clutterCount(l);
				lootPieces[b] += l.breakableLoot?.size() ?? 0;
				if (list.size() < breakableSilverBand(floor).min) short[b]++;
				for (const s of list) {
					silver[b] += s.amount;
					if (l.breakables![s.slot].kind === "crate") crates++;
					else barrels++;
				}
				for (const [room, n] of perRoom) if (room >= 0 && n <= 2) roomsWith[n]++;
				glints[b] += list.size() + (l.breakableLoot?.size() ?? 0) + (l.golden !== undefined ? 1 : 0);
				modFloors.set(l.modifier, (modFloors.get(l.modifier) ?? 0) + 1);
				modPieces.set(l.modifier, (modPieces.get(l.modifier) ?? 0) + list.size());
			}
		const lines: string[] = [];
		for (let b = 0; b < 4; b++) {
			if (floors[b] === 0) continue;
			lines.push(
				`[SilverSC4] ${BANDS[b]}: ${floors[b]} floors, clutter ${f2(
					clutter[b] / floors[b],
				)}/floor, Silver pieces ${f2(pieces[b] / floors[b])}/floor (short of min ${short[b]}), Silver ${f2(
					silver[b] / floors[b],
				)}/floor (${f2(silver[b] / math.max(1, pieces[b]))}/piece), boost pieces ${f2(
					lootPieces[b] / floors[b],
				)}/floor, twinkling ${f2(glints[b] / floors[b])}/floor`,
			);
		}
		lines.push(
			`[SilverSC4] crates ${crates} / barrels ${barrels} (crates ${pct(
				crates,
				crates + barrels,
			)} %); rooms with 1 piece ${roomsWith[1]}, with 2 ${roomsWith[2]}`,
		);
		const name = (id: number) => MODIFIERS.kinds.find((k) => k.id === id)?.key ?? "none";
		for (const [id, n] of modFloors)
			lines.push(
				`[SilverSC4] natural modifier ${name(id)}: ${n} floors, ${f2(
					(modPieces.get(id) ?? 0) / n,
				)} Silver pieces/floor`,
			);
		// Forced: each modifier on every floor where it is eligible (the dev world's KV_FloorModifier).
		for (const k of MODIFIERS.kinds) {
			let n = 0;
			let p = 0;
			let s = 0;
			for (let run = 1; run <= FORCED_RUNS; run++)
				for (const floor of FORCED_FLOORS) {
					const l = buildEndlessFloor(run, floor, dungeonFor, 1, {
						...OPTIONS,
						modifierOverride: { every: true, kind: k.id },
					});
					checkFloor(l);
					if (l.modifier !== k.id) continue;
					n++;
					p += l.breakableSilver?.size() ?? 0;
					for (const x of l.breakableSilver ?? []) s += x.amount;
					if (k.id === FloorModifier.PLUNDER) {
						const loot = new Set<number>();
						for (const x of l.breakableLoot ?? []) loot.add(x.slot);
						for (const x of l.breakableSilver ?? []) expect(loot.has(x.slot)).toBe(false);
					}
				}
			lines.push(
				`[SilverSC4] forced ${k.key}: ${n} floors, ${f2(p / math.max(1, n))} Silver pieces/floor, ${f2(
					s / math.max(1, n),
				)} Silver/floor`,
			);
			expect(n > 0).toBe(true);
			expect(p > 0).toBe(true);
		}
		lines.push(`[SilverSC4] ${string.format("%.0f", os.clock() - t0)} s`);
		for (const line of lines) print(line);
		// Loose bounds: the band means within their ranges, crates about 2 : 1 by count.
		for (let b = 0; b < 4; b++) {
			if (floors[b] === 0) continue;
			const band = BREAKABLE_SILVER.bands[b];
			const mean = pieces[b] / floors[b];
			expect(mean >= band.min - 0.25 && mean <= band.max).toBe(true);
		}
		expect(crates > barrels).toBe(true);
	});
});
