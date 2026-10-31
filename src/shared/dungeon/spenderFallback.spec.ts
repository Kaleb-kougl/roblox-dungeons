// The endless room spender's "dearest" fallback (docs/ENEMY_VARIANTS.md EV5 open issue, measured in EV13): floors 1-30,
// party 1-4, combat and elite rooms, 200 room rng samples each (the real room stream's seeds: encounterRoomSeed of the
// floor seed). How often the no-draw fallback picks (saturated: every slot needs more than any kind costs; tail: near
// the cap), how often the pick was a tie the kind ORDER decided, what it bought, and the room mix today vs with the
// proposed tie-break (shared/dungeon/testing spenderFallback.ts). The mirror is checked against spendEncounterBudget
// draw for draw; the tie-break changes no floor-1 room (so the EV5 lock spec would still hold). Also printed: the worst
// pool slots a room could reach (shared/run/testing roomLoad) today and with the tie-break. Printed: the doc table.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	ENDLESS_ROOM_KINDS,
	EncounterRng,
	encounterCost,
	encounterRoomSeed,
	floorSeed,
	roomEncounterBudget,
	spendEncounterBudget,
	type EncounterRoomType,
} from "shared/dungeon";
import { tieSpend, traceSpend } from "shared/dungeon/testing";
import { roomLoad } from "shared/run/testing";

const SAMPLES = 200;
const LAST_FLOOR = 30;
const PARTIES = [1, 2, 3, 4];
const TYPES: EncounterRoomType[] = ["combat", "elite"];
const SHORT = new Map<string, string>([
	["swarmer", "sw"],
	["sniper", "sn"],
	["bruiser", "br"],
	["imp", "imp"],
	["slime", "sl"],
	["summoner", "su"],
]);

/** Pool slots of a bought list at its worst instant (shared/run/testing roomLoad). */
function slotsOf(kinds: ReadonlyArray<string>): number {
	return roomLoad(kinds.map((kind) => ({ kind, x: 0, z: 0 }))).slots;
}

function same(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
	if (a.size() !== b.size()) return false;
	for (let i = 0; i < a.size(); i++) if (a[i] !== b[i]) return false;
	return true;
}

function add(into: Map<string, number>, kinds: ReadonlyArray<string>): void {
	for (const k of kinds) into.set(k, (into.get(k) ?? 0) + 1);
}

/** Mean per room of each kind (ENDLESS_ROOM_KINDS order), kinds below 0.05 left out. */
function mix(counts: ReadonlyMap<string, number>, rooms: number): string {
	const parts: string[] = [];
	for (const k of ENDLESS_ROOM_KINDS) {
		const n = (counts.get(k.kind) ?? 0) / rooms;
		if (n >= 0.05) parts.push(`${string.format("%.1f", n)} ${SHORT.get(k.kind) ?? k.kind}`);
	}
	return parts.size() > 0 ? parts.join(" ") : "-";
}

describe("endless spender: the dearest fallback (floors 1-30, party 1-4)", () => {
	it("the mirror matches the spender; the tie-break changes no floor-1 room (printed)", () => {
		let mismatches = 0;
		let floorOneChanged = 0;
		let cells = 0;
		let firedCells = 0;
		let tiedCells = 0;
		print(`[spender fallback] ${SAMPLES} samples per row; rows where the fallback picked at least once`);
		print(
			"[spender fallback] | floor | party | room | budget | rooms with a fallback pick | fallback picks / room " +
				"(saturated + tail) | tied | fallback bought / room | room today | room with the tie-break | rooms changed | spent today | worst pool slots today / tie-break |",
		);
		for (let floor = 1; floor <= LAST_FLOOR; floor++) {
			for (const party of PARTIES) {
				for (const roomType of TYPES) {
					const budget = roomEncounterBudget(floor, roomType, party);
					let fired = 0;
					let saturated = 0;
					let tail = 0;
					let tied = 0;
					let changed = 0;
					let spent = 0;
					let slotsToday = 0;
					let slotsTie = 0;
					const bought = new Map<string, number>();
					const today = new Map<string, number>();
					const withTies = new Map<string, number>();
					for (let sample = 1; sample <= SAMPLES; sample++) {
						const seed = encounterRoomSeed(floorSeed(sample, floor), sample % 12);
						const real = spendEncounterBudget(new EncounterRng(seed), budget, floor);
						const tr = traceSpend(new EncounterRng(seed), budget, floor);
						const tb = tieSpend(new EncounterRng(seed), budget, floor);
						if (!same(real, tr.kinds)) mismatches++;
						if (!same(tr.kinds, tb.kinds)) {
							changed++;
							if (floor === 1) floorOneChanged++;
						}
						if (tr.saturated + tr.tail > 0) fired++;
						saturated += tr.saturated;
						tail += tr.tail;
						tied += tr.tied;
						for (const [k, n] of tr.fallbackKinds) bought.set(k, (bought.get(k) ?? 0) + n);
						add(today, tr.kinds);
						add(withTies, tb.kinds);
						for (const k of tr.kinds) spent += encounterCost(k);
						slotsToday = math.max(slotsToday, slotsOf(tr.kinds));
						slotsTie = math.max(slotsTie, slotsOf(tb.kinds));
					}
					cells++;
					if (fired === 0) continue;
					firedCells++;
					if (tied > 0) tiedCells++;
					const picks = saturated + tail;
					print(
						`[spender fallback] | ${floor} | ${party} | ${roomType} | ${string.format("%.1f", budget)} | ` +
							`${string.format("%.0f", (fired * 100) / SAMPLES)} % | ` +
							`${string.format("%.2f", picks / SAMPLES)} (${string.format(
								"%.2f",
								saturated / SAMPLES,
							)} + ` +
							`${string.format("%.2f", tail / SAMPLES)}) | ${string.format(
								"%.0f",
								(tied * 100) / picks,
							)} % | ` +
							`${mix(bought, SAMPLES)} | ${mix(today, SAMPLES)} | ${mix(withTies, SAMPLES)} | ` +
							`${string.format("%.0f", (changed * 100) / SAMPLES)} % | ` +
							`${string.format(
								"%.0f",
								(spent * 100) / (budget * SAMPLES),
							)} % | ${slotsToday} / ${slotsTie} |`,
					);
				}
			}
		}
		print(
			`[spender fallback] ${firedCells} of ${cells} (floor, party, room type) rows fire the fallback; ${tiedCells} of them break a tie by order`,
		);
		expect(mismatches).toBe(0);
		expect(floorOneChanged).toBe(0);
	});
});
