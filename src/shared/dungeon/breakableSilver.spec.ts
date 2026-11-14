// Silver in crates (docs/SILVER.md SC1, SVD15 / SVD16): which barrels and crates of an endless floor hold Silver. Pure
// (the same floor always gets the same Silver), its own stream with fixed draws (a hand twin replays them: 1 + 2 per
// piece), the band counts, at most 2 per room, crates picked about twice as often as barrels, stacks in range, never a
// loot piece, the Goldling's piece or an inert / secret piece, every floor modifier yielding valid slots (a Plunder
// floor's Silver avoiding its loot), the dev world's `every`, and the option off (and every other output with it on)
// exactly as before. The full census (runs 1-40 x floors 1-20) is breakableSilver.census.spec.ts.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	AFFIXES,
	BOSS_PICK,
	BREAKABLE,
	BREAKABLE_KINDS,
	BREAKABLE_LOOT,
	BREAKABLE_SILVER,
	EMPTY_ENCOUNTER,
	EncounterRng,
	FLOOR_MODIFIER_WORLD_ALL,
	FLOOR_SEED_MUL,
	FloorModifier,
	GOLDEN_PLACE,
	MODIFIERS,
	PACTS,
	PELLETS,
	ROSTER,
	SECRET,
	SOLID_DECOR,
	VAULT,
	breakableSilverBand,
	breakableSilverSeed,
	breakableSilverStack,
	buildEndlessFloor,
	generateDungeon,
	gridToWorld,
	placeBreakableSilver,
	roomAt,
	silverPieceWeight,
	type BreakablePlacement,
	type BreakableSilver,
	type BreakableSilverFloorInput,
	type Dungeon,
	type EncounterConfig,
	type EncounterRoom,
	type EndlessFloorLayout,
	type EndlessFloorOptions,
	type ForgeParams,
} from "shared/dungeon";
import { DROPS, GOLDEN_SIM_SALT, SECRETS_SALT, TREASURE } from "shared/sim";

const dungeons = new Map<string, Dungeon>();
function dungeonFor(params: ForgeParams): Dungeon {
	const key = `${params.seed}/${params.roomCount}`;
	let d = dungeons.get(key);
	if (d === undefined) {
		d = generateDungeon(params);
		dungeons.set(key, d);
	}
	return d;
}

/** The endless worlds' options (shared/run endlessRunFloor) without and with Silver. */
const WORLD: EndlessFloorOptions = {
	vaults: true,
	unlockFloors: false,
	modifiers: FLOOR_MODIFIER_WORLD_ALL,
	secrets: true,
};
const ON: EndlessFloorOptions = { ...WORLD, silver: true };

const RUNS = 4;
const FLOORS: ReadonlyArray<number> = [1, 2, 3, 4, 5, 7, 9, 10, 12, 14, 15, 17, 20];

interface Built {
	readonly run: number;
	readonly floor: number;
	readonly off: EndlessFloorLayout;
	readonly on: EndlessFloorLayout;
}

const BUILT: Built[] = [];
for (let run = 1; run <= RUNS; run++)
	for (const floor of FLOORS)
		BUILT.push({
			run,
			floor,
			off: buildEndlessFloor(run, floor, dungeonFor, 1, WORLD),
			on: buildEndlessFloor(run, floor, dungeonFor, 1, ON),
		});

/** The clutter count of a built floor: the slots before the vault's chest, the Goldling's piece and the secret's. */
function clutterCount(l: EndlessFloorLayout): number {
	const n = l.breakables?.size() ?? 0;
	let c = n;
	if (l.vault !== undefined) c = math.min(c, l.vault.slot);
	if (l.golden !== undefined) c = math.min(c, l.golden.piece);
	if (l.secret !== undefined) c = math.min(c, l.secret.crackSlot);
	return c;
}

/** placeBreakableSilver's input of a built floor. */
function inputOf(l: EndlessFloorLayout): BreakableSilverFloorInput {
	const clutter: BreakablePlacement[] = [];
	const all = l.breakables ?? [];
	for (let i = 0; i < clutterCount(l); i++) clutter.push(all[i]);
	return { seed: l.seed, encounter: l.encounter, clutter, loot: l.breakableLoot };
}

function silverOf(l: EndlessFloorLayout): ReadonlyArray<BreakableSilver> {
	return l.breakableSilver ?? [];
}

function roomIdOf(encounter: EncounterConfig, b: BreakablePlacement): number {
	return roomAt(encounter, gridToWorld(b.x), gridToWorld(b.y))?.id ?? -1;
}

/** A hand twin of the file comment's draws (the natural roll), returning the pieces and the number of draws. */
function twin(input: BreakableSilverFloorInput, floor: number): { out: BreakableSilver[]; draws: number } {
	const rng = new EncounterRng(bit32.bxor(input.seed, BREAKABLE_SILVER.salt));
	let draws = 0;
	const band = breakableSilverBand(floor);
	const count = rng.int(band.min, band.max);
	draws++;
	const [lo, hi] = breakableSilverStack(floor);
	const loot = new Set<number>();
	for (const l of input.loot ?? []) loot.add(l.slot);
	const taken = new Map<number, number>();
	const perRoom = new Map<number, number>();
	for (let k = 0; k < count; k++) {
		const open: number[] = [];
		let total = 0;
		for (let i = 0; i < input.clutter.size(); i++) {
			const p = input.clutter[i];
			const w = loot.has(i) ? 0 : p.kind === "crate" ? 2 : p.kind === "barrel" ? 1 : 0;
			const room = roomIdOf(input.encounter, p);
			if (w > 0 && !taken.has(i) && (room < 0 || (perRoom.get(room) ?? 0) < 2)) {
				open.push(i);
				total += w;
			}
		}
		if (total === 0) break;
		let roll = rng.int(0, total - 1);
		draws++;
		let slot = open[0];
		for (const i of open) {
			const w = input.clutter[i].kind === "crate" ? 2 : 1;
			if (roll < w) {
				slot = i;
				break;
			}
			roll -= w;
		}
		taken.set(slot, rng.int(lo, hi));
		draws++;
		const room = roomIdOf(input.encounter, input.clutter[slot]);
		if (room >= 0) perRoom.set(room, (perRoom.get(room) ?? 0) + 1);
	}
	const out: BreakableSilver[] = [];
	for (let i = 0; i < input.clutter.size(); i++) {
		const a = taken.get(i);
		if (a !== undefined) out.push({ slot: i, amount: a });
	}
	return { out, draws };
}

/** Every field of `on` but breakableSilver equals `off`'s (the dungeon by identity: it is the same cached object). */
function expectSameFloor(on: EndlessFloorLayout, off: EndlessFloorLayout): void {
	expect(on.dungeon === off.dungeon).toBe(true);
	expect(on.seed).toBe(off.seed);
	expect(on.roomCount).toBe(off.roomCount);
	expect(on.bossFloor).toBe(off.bossFloor);
	expect(on.bossKind).toBe(off.bossKind);
	expect(on.roster).toEqual(off.roster);
	expect(on.encounter).toEqual(off.encounter);
	expect(on.roomSpawns).toEqual(off.roomSpawns);
	expect(on.roomSpawnTiles).toEqual(off.roomSpawnTiles);
	expect(on.spawn).toEqual(off.spawn);
	expect(on.stairwell).toEqual(off.stairwell);
	expect(on.breakables).toEqual(off.breakables);
	expect(on.roomAffixes).toEqual(off.roomAffixes);
	expect(on.breakableLoot).toEqual(off.breakableLoot);
	expect(on.pellets).toEqual(off.pellets);
	expect(on.vault).toEqual(off.vault);
	expect(on.pactAltars).toEqual(off.pactAltars);
	expect(on.golden).toEqual(off.golden);
	expect(on.modifier).toBe(off.modifier);
	expect(on.secret === undefined).toBe(off.secret === undefined);
	if (on.secret !== undefined && off.secret !== undefined) {
		expect(on.secret.dungeon.grid).toEqual(off.secret.dungeon.grid);
		expect({ ...on.secret, dungeon: undefined }).toEqual({ ...off.secret, dungeon: undefined });
	}
}

/** The SC1 rules on one built floor: valid slots, never loot / Goldling / inert, cap per room, stacks in range. */
function expectValid(l: EndlessFloorLayout, everyRoomCap = true): void {
	const all = l.breakables ?? [];
	const clutter = clutterCount(l);
	const loot = new Set<number>();
	for (const x of l.breakableLoot ?? []) loot.add(x.slot);
	const [lo, hi] = breakableSilverStack(l.floor);
	const perRoom = new Map<number, number>();
	let last = -1;
	for (const s of silverOf(l)) {
		expect(s.slot % 1).toBe(0);
		expect(s.slot > last).toBe(true); // slot order, each once
		last = s.slot;
		expect(s.slot >= 0 && s.slot < clutter).toBe(true);
		const p = all[s.slot];
		expect((BREAKABLE_KINDS as ReadonlyArray<string>).includes(p.kind)).toBe(true);
		expect(loot.has(s.slot)).toBe(false);
		if (l.golden !== undefined) expect(s.slot).never.toBe(l.golden.piece);
		expect(s.amount >= lo && s.amount <= hi).toBe(true);
		expect(s.amount % 1).toBe(0);
		const room = roomIdOf(l.encounter, p);
		if (room >= 0) perRoom.set(room, (perRoom.get(room) ?? 0) + 1);
	}
	if (everyRoomCap) for (const [, n] of perRoom) expect(n <= BREAKABLE_SILVER.maxPerRoom).toBe(true);
}

describe("breakable silver: data and stream", () => {
	it("the tunables are the plan's (bands 2-3 / 3-4 / 3-5 / 3-5, 2 a room, crates 2 : 1, stacks 4-8 rising)", () => {
		expect(BREAKABLE_SILVER.bands.map((b) => [b.fromFloor, b.min, b.max])).toEqual([
			[1, 2, 3],
			[5, 3, 4],
			[10, 3, 5],
			[15, 3, 5],
		]);
		expect(BREAKABLE_SILVER.maxPerRoom).toBe(2);
		expect(silverPieceWeight("crate")).toBe(2);
		expect(silverPieceWeight("barrel")).toBe(1);
		expect(silverPieceWeight("chest")).toBe(0);
		expect(silverPieceWeight("crackedWall")).toBe(0);
		expect(breakableSilverStack(1)).toEqual([4, 8]);
		expect(breakableSilverStack(2)).toEqual([4, 8]);
		expect(breakableSilverStack(3)).toEqual([5, 9]);
		expect(breakableSilverStack(10)).toEqual([8, 12]);
		expect(breakableSilverStack(20)).toEqual([13, 17]);
		expect(breakableSilverStack(21)).toEqual([14, 18]);
		expect(breakableSilverStack(99)).toEqual([14, 18]); // capped
		for (let f = 2; f <= 40; f++) {
			const [a, b] = breakableSilverStack(f);
			const [pa, pb] = breakableSilverStack(f - 1);
			expect(a >= pa && b >= pb && b - a === 4).toBe(true);
		}
	});

	it("its own stream: floor seed ^ salt, a salt no other floor or sim stream uses", () => {
		expect(BREAKABLE_SILVER.salt).toBe(0x4b56534c);
		expect(breakableSilverSeed(12345)).toBe(bit32.bxor(12345, BREAKABLE_SILVER.salt));
		const salts = [
			BREAKABLE_SILVER.salt,
			SECRET.salt,
			MODIFIERS.salt,
			GOLDEN_PLACE.salt,
			VAULT.salt,
			PELLETS.salt,
			PACTS.salt,
			BREAKABLE.salt,
			BOSS_PICK.salt,
			AFFIXES.salt,
			BREAKABLE_LOOT.salt,
			ROSTER.salt,
			SOLID_DECOR.salt,
			DROPS.salt,
			TREASURE.salt,
			GOLDEN_SIM_SALT,
			SECRETS_SALT,
		];
		for (let i = 0; i < salts.size(); i++) {
			expect(salts[i]).never.toBe(FLOOR_SEED_MUL);
			for (let j = i + 1; j < salts.size(); j++) expect(salts[i]).never.toBe(salts[j]);
		}
	});

	it("a hand twin replays the draws on every built floor: count, then pick and stack per piece (1 + 2 per piece)", () => {
		for (const b of BUILT) {
			const input = inputOf(b.on);
			const t = twin(input, b.floor);
			expect(silverOf(b.on)).toEqual(t.out);
			expect(t.draws).toBe(1 + 2 * t.out.size());
			// Pure: the same input gives the same output; nothing in it is mutated.
			const before = [...input.clutter];
			expect(placeBreakableSilver(input, b.floor)).toEqual(t.out);
			expect(input.clutter).toEqual(before);
		}
	});

	it("no clutter: no Silver (the count is still drawn)", () => {
		expect(placeBreakableSilver({ seed: 7, encounter: EMPTY_ENCOUNTER, clutter: [] }, 3)).toEqual([]);
		expect(placeBreakableSilver({ seed: 7, encounter: EMPTY_ENCOUNTER, clutter: [] }, 3, { every: true })).toEqual(
			[],
		);
	});
});

describe("breakable silver: the floor around it", () => {
	it("option off: no draw, no breakableSilver; on: every other output byte-identical (layout, digest inputs, slots, spawn tiles)", () => {
		for (const b of BUILT) {
			expect(b.off.breakableSilver).toBe(undefined);
			expect(b.on.breakableSilver).never.toBe(undefined);
			expectSameFloor(b.on, b.off);
		}
	});

	it("the tutorial-style build (no options) is unchanged: no Silver", () => {
		const l = buildEndlessFloor(3, 2, dungeonFor);
		expect(l.breakableSilver).toBe(undefined);
	});
});

describe("breakable silver: counts, rooms, kinds", () => {
	it("every built floor: valid slots, never loot / the Goldling's / an inert piece, at most 2 a room, stacks in range", () => {
		for (const b of BUILT) expectValid(b.on);
	});

	it("counts: within the floor's band, short only when the candidates run out under the room cap", () => {
		let short = 0;
		for (const b of BUILT) {
			const band = breakableSilverBand(b.floor);
			const n = silverOf(b.on).size();
			expect(n <= band.max).toBe(true);
			if (n < band.min) {
				short++;
				// Short: no candidate left that the cap allows.
				const input = inputOf(b.on);
				const chosen = new Set<number>();
				const perRoom = new Map<number, number>();
				for (const s of silverOf(b.on)) {
					chosen.add(s.slot);
					const r = roomIdOf(b.on.encounter, input.clutter[s.slot]);
					perRoom.set(r, (perRoom.get(r) ?? 0) + 1);
				}
				const loot = new Set<number>();
				for (const x of input.loot ?? []) loot.add(x.slot);
				for (let i = 0; i < input.clutter.size(); i++) {
					if (chosen.has(i) || loot.has(i) || silverPieceWeight(input.clutter[i].kind) === 0) continue;
					const r = roomIdOf(b.on.encounter, input.clutter[i]);
					expect(r >= 0 && (perRoom.get(r) ?? 0) >= BREAKABLE_SILVER.maxPerRoom).toBe(true);
				}
			}
		}
		print(`[SilverSC1] floors short of their band's min: ${short} of ${BUILT.size()}`);
	});

	it("a hand-built floor: the cap holds per room, a piece in no room is uncapped, loot slots skipped, crates 2 : 1", () => {
		const room: EncounterRoom = {
			id: 0,
			type: "combat",
			depth: 1,
			cx: 5,
			cz: 5,
			minX: 0,
			maxX: 10,
			minZ: 0,
			maxZ: 10,
			floorTiles: 100,
		};
		const encounter: EncounterConfig = { ...EMPTY_ENCOUNTER, rooms: [room] };
		const clutter: BreakablePlacement[] = [];
		for (let i = 0; i < 6; i++) clutter.push({ kind: i % 2 === 0 ? "crate" : "barrel", x: 2 + i, y: 3 });
		for (let i = 0; i < 4; i++) clutter.push({ kind: "barrel", x: 40 + i, y: 40 }); // in no room
		let inRoom = 0;
		let loose = 0;
		let crates = 0;
		let barrels = 0;
		for (let seed = 1; seed <= 400; seed++) {
			const out = placeBreakableSilver({ seed, encounter, clutter, loot: [{ slot: 0, kind: 0 }] }, 20);
			let r = 0;
			for (const s of out) {
				expect(s.slot).never.toBe(0);
				if (s.slot < 6) {
					r++;
					if (clutter[s.slot].kind === "crate") crates++;
					else barrels++;
				} else loose++;
			}
			expect(r <= 2).toBe(true);
			inRoom += r;
		}
		expect(loose > 0).toBe(true);
		expect(inRoom > 0).toBe(true);
		// In the room: 2 crates (slots 2, 4) and 3 barrels (1, 3, 5) open, weights 4 : 3 on the first pick.
		expect(crates > barrels).toBe(true);
	});

	it("crates are picked about twice as often per piece as barrels (all built floors)", () => {
		let crates = 0;
		let barrels = 0;
		let crateSilver = 0;
		let barrelSilver = 0;
		for (const b of BUILT) {
			const input = inputOf(b.on);
			for (const p of input.clutter) {
				if (p.kind === "crate") crates++;
				else if (p.kind === "barrel") barrels++;
			}
			for (const s of silverOf(b.on)) {
				if (input.clutter[s.slot].kind === "crate") crateSilver++;
				else barrelSilver++;
			}
		}
		expect(crateSilver > 0 && barrelSilver > 0).toBe(true);
		const crateRate = crateSilver / math.max(1, crates);
		const barrelRate = barrelSilver / math.max(1, barrels);
		print(
			`[SilverSC1] crates ${crateSilver} / ${crates}, barrels ${barrelSilver} / ${barrels}: rate ratio ${string.format(
				"%.2f",
				crateRate / barrelRate,
			)}`,
		);
		expect(crateRate / barrelRate > 1.3 && crateRate / barrelRate < 3).toBe(true);
	});
});

describe("breakable silver: floor modifiers and the dev override", () => {
	it("each floor modifier forced: valid slots; a Plunder floor's Silver avoids its loot", () => {
		for (const k of MODIFIERS.kinds) {
			let floors = 0;
			let silver = 0;
			for (let run = 1; run <= 3; run++)
				for (const floor of [2, 3, 4, 6, 8, 11, 13]) {
					const l = buildEndlessFloor(run, floor, dungeonFor, 1, {
						...ON,
						modifierOverride: { every: true, kind: k.id },
					});
					expectValid(l);
					if (l.modifier !== k.id) continue;
					floors++;
					silver += silverOf(l).size();
					if (k.id === FloorModifier.PLUNDER) {
						const loot = new Set<number>();
						for (const x of l.breakableLoot ?? []) loot.add(x.slot);
						for (const s of silverOf(l)) expect(loot.has(s.slot)).toBe(false);
					}
				}
			print(`[SilverSC1] modifier ${k.key}: ${floors} forced floors, ${silver} Silver pieces`);
			expect(floors > 0).toBe(true);
			expect(silver > 0).toBe(true);
		}
	});

	it("`every`: every candidate holds Silver (no loot, never the Goldling's or an inert piece), the rest unchanged", () => {
		for (const b of BUILT) {
			if (b.floor > 9) continue;
			const l = buildEndlessFloor(b.run, b.floor, dungeonFor, 1, { ...ON, silverOverride: { every: true } });
			expectValid(l, false);
			expectSameFloor(l, b.off);
			const input = inputOf(l);
			const loot = new Set<number>();
			for (const x of input.loot ?? []) loot.add(x.slot);
			let candidates = 0;
			for (let i = 0; i < input.clutter.size(); i++)
				if (!loot.has(i) && silverPieceWeight(input.clutter[i].kind) > 0) candidates++;
			expect(silverOf(l).size()).toBe(candidates);
		}
	});
});
