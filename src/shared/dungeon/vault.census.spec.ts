// Vault census (docs/TREASURE.md TR1): run seeds 1-10 x floors 2-20, solo and a party of 4. The vault rate per band
// against vaultChancePercent, chance hits lost to a floor with no eligible room, open rooms (combat / elite, planned
// spawns, >= minRoomTiles) with no valid chest cell, by room theme, the Legendary share, the lock split, the elite
// share and vault rooms by theme, the far-wall share; printed. Its own file: 380 floor builds over 190 Forge floors
// (about a minute headless).
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	EncounterRng,
	VAULT,
	VAULT_PERCENT_RANGE,
	VaultLock,
	VaultTier,
	buildEndlessFloor,
	generateDungeon,
	isFarWallFacing,
	legendaryPercent,
	placeVault,
	vaultChancePercent,
	vaultRoomOpen,
	vaultRooms,
	vaultSeed,
	type BreakableFloorInput,
	type Dungeon,
	type EndlessFloorLayout,
	type ForgeParams,
} from "shared/dungeon";

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

function inputOf(l: EndlessFloorLayout): BreakableFloorInput {
	return {
		seed: l.seed,
		dungeon: l.dungeon,
		encounter: l.encounter,
		roomSpawns: l.roomSpawns,
		spawn: l.spawn,
		stairwell: l.stairwell,
	};
}

function pct(n: number, of: number): string {
	return of > 0 ? string.format("%.1f", (n * 100) / of) : "-";
}

function bump(m: Map<string, number>, k: string): void {
	m.set(k, (m.get(k) ?? 0) + 1);
}

function byTheme(m: Map<string, number>): string {
	const keys: string[] = [];
	for (const [k] of m) keys.push(k);
	keys.sort();
	return keys.map((k) => `${k} ${m.get(k)}`).join(", ");
}

const RUNS = 10;
const LAST_FLOOR = 20;
const BANDS = VAULT.chanceByBand;

function bandOf(floor: number): number {
	let out = 0;
	for (let i = 0; i < BANDS.size(); i++) if (floor >= BANDS[i].fromFloor) out = i;
	return out;
}

describe("vault census (run seeds 1-10 x floors 2-20, solo and party 4)", () => {
	for (const party of [1, 4]) {
		it(`party ${party}: rates, empty rooms, tiers, locks, themes (printed)`, () => {
			const floors = BANDS.map(() => 0);
			const vaults = BANDS.map(() => 0);
			const hits = BANDS.map(() => 0);
			let lostHits = 0;
			let openRooms = 0;
			let emptyRooms = 0;
			const emptyByTheme = new Map<string, number>();
			const openByTheme = new Map<string, number>();
			const vaultByTheme = new Map<string, number>();
			let eligibleRooms = 0;
			let eligibleElite = 0;
			let total = 0;
			let legendary = 0;
			let legendaryWant = 0;
			let swift = 0;
			let elite = 0;
			let far = 0;
			let cellsTotal = 0;
			for (let run = 1; run <= RUNS; run++)
				for (let floor = VAULT.fromFloor; floor <= LAST_FLOOR; floor++) {
					const l = buildEndlessFloor(run, floor, dungeonFor, party);
					const input = inputOf(l);
					const pieces = l.breakables ?? [];
					const themes = l.dungeon.roomThemes ?? [];
					const band = bandOf(floor);
					floors[band]++;
					const eligible = vaultRooms(input, pieces, l.pellets);
					const withCells = new Set<number>();
					for (const r of eligible) {
						withCells.add(r.room.id);
						cellsTotal += r.cells.size();
						if (r.room.type === "elite") eligibleElite++;
					}
					eligibleRooms += eligible.size();
					for (const room of l.encounter.rooms) {
						if (!vaultRoomOpen(input, room)) continue;
						openRooms++;
						const theme = themes[room.id] ?? "none";
						bump(openByTheme, theme);
						if (!withCells.has(room.id)) {
							emptyRooms++;
							bump(emptyByTheme, theme);
						}
					}
					const hit =
						new EncounterRng(vaultSeed(l.seed)).int(0, VAULT_PERCENT_RANGE - 1) < vaultChancePercent(floor);
					if (hit) hits[band]++;
					// vault.spec checks buildEndlessFloor({ vaults: true }) against placeVault; here placeVault alone.
					const v = hit ? placeVault(input, floor, pieces, l.pellets) : undefined;
					if (hit && eligible.size() === 0) lostHits++;
					if (v === undefined) {
						expect(hit && eligible.size() > 0).toBe(false);
						continue;
					}
					vaults[band]++;
					total++;
					legendaryWant += legendaryPercent(floor);
					if (v.tier === VaultTier.LEGENDARY) legendary++;
					if (v.lock === VaultLock.SWIFT) swift++;
					if (l.encounter.rooms[v.room].type === "elite") elite++;
					if (isFarWallFacing(v.fx, v.fz)) far++;
					bump(vaultByTheme, themes[v.room] ?? "none");
				}
			const tag = `[vault census p${party}]`;
			const bandRows = BANDS.map(
				(b, i) =>
					`floors ${b.fromFloor}+ (${b.percent} %): ${vaults[i]} / ${floors[i]} = ${pct(
						vaults[i],
						floors[i],
					)} % ` + `(hits ${hits[i]})`,
			);
			print(`${tag} vault rate by band: ${bandRows.join("; ")}`);
			print(`${tag} chance hits lost to a floor with no eligible room: ${lostHits}`);
			print(
				`${tag} open rooms ${openRooms}, with no valid cell ${emptyRooms} (${pct(emptyRooms, openRooms)} %); ` +
					`mean cells per open room ${string.format("%.1f", cellsTotal / math.max(1, openRooms))}`,
			);
			print(`${tag} open rooms by theme: ${byTheme(openByTheme)}`);
			print(`${tag} no valid cell by theme: ${byTheme(emptyByTheme)}`);
			print(
				`${tag} ${total} vaults: Legendary ${legendary} (${pct(legendary, total)} %, want ` +
					`${string.format("%.1f", legendaryWant / math.max(1, total))} %), SWIFT ${swift} (${pct(
						swift,
						total,
					)} %), ` +
					`elite ${elite} (${pct(elite, total)} %; eligible rooms ${pct(
						eligibleElite,
						eligibleRooms,
					)} % elite), ` +
					`far wall ${far} (${pct(far, total)} %)`,
			);
			print(`${tag} vault rooms by theme: ${byTheme(vaultByTheme)}`);
			// Every band within 12 points of its percent (95 floors a band at most: binomial noise about 5 points).
			for (let i = 0; i < BANDS.size(); i++)
				expect(math.abs(vaults[i] / floors[i] - BANDS[i].percent / 100) <= 0.12).toBe(true);
			expect(lostHits <= 2).toBe(true);
			// A room with no valid cell is never picked, so it costs no vault (lostHits): crypt and store rooms lead it.
			expect(emptyRooms / openRooms <= 0.35).toBe(true);
			expect(far / total >= 0.6).toBe(true);
		});
	}
});
