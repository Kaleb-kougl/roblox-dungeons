// Every sim constant this port owns equals the web build's value bit for bit (fixtures/constants.json), including the
// module-load computations (secondsToTicks, ROLL_DISTANCE, TURN_COS / SIN, BOW_WOBBLE_COS / SIN, derived steps).
import { afterAll, beforeAll, describe, expect, it } from "@rbxts/jest-globals";
import constants from "shared/fixtures-generated/constants";
import { jsRound } from "shared/jsmath";
import * as units from "./units";
import * as playerData from "./playerData";
import * as combatData from "./combat/combatData";
import * as sword from "./combat/weapons/defs/sword";
import * as bow from "./combat/weapons/defs/bow";
import * as enemyShared from "./combat/actors/archetypes/enemyShared";
import * as swarmer from "./combat/actors/archetypes/swarmer";
import * as sniper from "./combat/actors/archetypes/sniper";
import * as bruiser from "./combat/actors/archetypes/bruiser";
import * as turretShared from "./combat/actors/archetypes/turretShared";
import * as bossAct1 from "./combat/actors/archetypes/boss/act1";
import {
	BulletKind,
	BulletPayload,
	ENEMY_HIT_R2,
	FULL_RING,
	PAYLOAD_BITS,
	PAYLOAD_FIELDS,
	ROLL_DASH_STEP,
	ROLL_RECOVERY_STEP,
	SIM_DT,
	SIM_HZ,
	STEP_TOLERANCE,
	TILE_SIZE,
	WALK_STEP,
	WEAPON_SCRATCH_SLOTS,
	WEAPON_SETS,
	archetypeAt,
	webArchetypeIds,
	float64Hex,
	weaponAt,
	weaponIds,
	SWORD_DATA,
	SWORD_REACH_PERCENT,
	SWORD_TEMPO_PERCENT,
	WEB_SWORD_TIMINGS,
	setSwordTimings,
	type SwordTimings,
} from "shared/sim";

/** `{ v, hex }` leaves are compared by bits; strings / booleans / plain numbers by value; tables recursively. */
function compareTree(expected: unknown, actual: unknown, path: string, out: string[]): void {
	if (typeIs(expected, "table")) {
		const leaf = expected as { v?: unknown; hex?: unknown };
		if (typeIs(leaf.hex, "string") && leaf.v !== undefined) {
			if (!typeIs(actual, "number"))
				out.push(`${path}: expected a number (${leaf.hex}), got ${tostring(actual)}`);
			else if (float64Hex(actual) !== leaf.hex) out.push(`${path}: ${float64Hex(actual)} != ${leaf.hex}`);
			return;
		}
		if (!typeIs(actual, "table")) {
			out.push(`${path}: missing (expected a table)`);
			return;
		}
		for (const [k, v] of pairs(expected as object)) {
			compareTree(v, (actual as Record<string, unknown>)[k as string], `${path}.${k}`, out);
		}
		return;
	}
	if (expected !== actual) out.push(`${path}: ${tostring(actual)} != ${tostring(expected)}`);
}

// the generated type lists each module by name; a ReadonlyMap view iterates them all
const modules = constants.modules as unknown as ReadonlyMap<string, ReadonlyMap<string, unknown>>;

/** Modules (or keys) that belong to other tasks. */
const NOT_OWNED = new Set([
	"src/config.ts:CAMERA_PITCH", // shared/config (view)
	"src/config.ts:CAMERA_YAW",
	"src/config.ts:PIXELS_PER_TILE",
	"src/config.ts:RENDER_H",
	"src/config.ts:RENDER_W",
]);

const PORTED: Record<string, unknown> = {
	"src/config.ts": units,
	"src/sim/playerData.ts": playerData,
	"src/sim/combatData.ts": combatData,
	"src/sim/patterns.ts": { BulletKind, FULL_RING },
	"src/sim/weapons/defs/sword.ts": sword,
	"src/sim/weapons/defs/bow.ts": bow,
	"src/sim/actors/archetypes/enemyShared.ts": enemyShared,
	"src/sim/actors/archetypes/swarmer.ts": swarmer,
	"src/sim/actors/archetypes/sniper.ts": sniper,
	"src/sim/actors/archetypes/bruiser.ts": bruiser,
	"src/sim/actors/archetypes/turretShared.ts": turretShared,
	"src/sim/actors/archetypes/boss/act1.ts": bossAct1,
};

describe("constants.json parity", () => {
	// The port's sword is 20% slower (CLAUDE.md decision log); its web timers are compared here, the retune below.
	let portSword: SwordTimings;
	beforeAll(() => {
		portSword = setSwordTimings(WEB_SWORD_TIMINGS);
	});
	afterAll(() => {
		setSwordTimings(portSword);
	});

	it("every exported constant of the ported modules matches bit for bit", () => {
		const problems: string[] = [];
		let checked = 0;
		for (const [file, exported] of modules) {
			const actual = PORTED[file];
			if (actual === undefined) {
				problems.push(`${file}: not ported`);
				continue;
			}
			for (const [key, value] of exported) {
				if (NOT_OWNED.has(`${file}:${key}`)) continue;
				compareTree(value, (actual as Record<string, unknown>)[key], `${file}:${key}`, problems);
				checked++;
			}
		}
		expect(problems).toEqual([]);
		expect(checked).toBeGreaterThan(140);
	});

	it("derived module-load values (walk / roll steps, STEP_TOLERANCE, the enemy hit radius)", () => {
		const d = constants.derived;
		expect(float64Hex(SIM_DT)).toBe(d.SIM_DT.hex);
		expect(SIM_HZ).toBe(d.SIM_HZ);
		expect(TILE_SIZE).toBe(d.TILE_SIZE);
		expect(float64Hex(WALK_STEP)).toBe(d.WALK_STEP.hex);
		expect(float64Hex(ROLL_DASH_STEP)).toBe(d.ROLL_DASH_STEP.hex);
		expect(float64Hex(ROLL_RECOVERY_STEP)).toBe(d.ROLL_RECOVERY_STEP.hex);
		expect(float64Hex(STEP_TOLERANCE)).toBe(d.STEP_TOLERANCE.hex);
		expect(float64Hex(ENEMY_HIT_R2)).toBe(d.ENEMY_HIT_R2.hex);
	});

	it("weapon registry: same index order, triggers and data", () => {
		const problems: string[] = [];
		expect(weaponIds().size()).toBe(constants.weapons.size());
		for (const w of constants.weapons) {
			const def = weaponAt(w.index);
			if (def.id !== w.id) problems.push(`weapons[${w.index}]: ${def.id} != ${w.id}`);
			if ((def.trigger ?? "hold") !== w.trigger) problems.push(`${w.id}: trigger ${def.trigger} != ${w.trigger}`);
			compareTree(w.data, def.data, `${w.id}.data`, problems);
		}
		expect(problems).toEqual([]);
		expect(WEAPON_SETS).toBe(constants.weaponSets);
		expect(WEAPON_SCRATCH_SLOTS).toBe(constants.weaponScratchSlots);
	});

	it("archetype registry: same index order and data (hooks are code, not compared)", () => {
		const problems: string[] = [];
		// The web table is band 0; the port's own archetypes (dummy) number after it.
		expect(webArchetypeIds().size()).toBe(constants.archetypes.size());
		for (const a of constants.archetypes) {
			const def = archetypeAt(a.index);
			if (def.id !== a.id) problems.push(`archetypes[${a.index}]: ${def.id} != ${a.id}`);
			compareTree(a.data, def.data, `${a.id}.data`, problems);
		}
		expect(problems).toEqual([]);
	});

	it("payload layout (field, max, shift) and pack / get / with", () => {
		const layout = constants.payloadLayout;
		expect(PAYLOAD_BITS).toBe(layout.bits);
		const fields = layout.fields as unknown as Record<string, { max: number; shift: number }>;
		for (const [name] of PAYLOAD_FIELDS) {
			expect([name, BulletPayload.max(name), BulletPayload.shift(name)]).toEqual([
				name,
				fields[name].max,
				fields[name].shift,
			]);
		}
		// Ported from src/sim/combat.test.ts ("payload layout").
		const p = BulletPayload.pack({ damage: 2, kind: BulletKind.SNIPER, source: 3, pierce: 5 });
		expect(p).toBe(2 + BulletKind.SNIPER * 64 + 3 * 1024 + 5 * 262144);
		expect(BulletPayload.get(p, "damage")).toBe(2);
		expect(BulletPayload.get(p, "kind")).toBe(BulletKind.SNIPER);
		expect(BulletPayload.get(p, "source")).toBe(3);
		expect(BulletPayload.get(p, "pierce")).toBe(5);
		expect(BulletPayload.get(BulletPayload.with(p, "lastHit", 127), "lastHit")).toBe(127);
		expect(BulletPayload.get(BulletPayload.with(p, "lastHit", 127), "pierce")).toBe(5);
		// Out of range: the library's dev build (the web build's tests and fixture exporter) rejects it, so does the port.
		expect(() => BulletPayload.with(p, "damage", 64 + 7)).toThrow("holds integers 0");
	});
});

describe("port retune: the sword (CLAUDE.md decision log)", () => {
	it("every retuned timer is the web build's times SWORD_TEMPO_PERCENT, rounded to whole ticks", () => {
		const timers = (t: SwordTimings) => [t.swingRecoveryTicks, t.finisherWindupTicks, t.finisherRecoveryTicks];
		const slower = (ticks: number) => jsRound((ticks * SWORD_TEMPO_PERCENT) / 100);
		expect(SWORD_TEMPO_PERCENT).toBe(120);
		expect(timers(SWORD_DATA)).toEqual(timers(WEB_SWORD_TIMINGS).map(slower));
		expect(timers(SWORD_DATA)).toEqual([14, 11, 25]);
	});

	it("swing and finisher reach are the web build's times SWORD_REACH_PERCENT; the guard keeps the web reach", () => {
		expect(SWORD_REACH_PERCENT).toBe(115);
		expect(SWORD_DATA.reach).toBe(1.955);
		expect(SWORD_DATA.finisherReach).toBe(2.53);
		// Written as literals; the product itself is a ulp or so off them in float64.
		expect(SWORD_DATA.reach).toBeCloseTo((WEB_SWORD_TIMINGS.reach * SWORD_REACH_PERCENT) / 100, 12);
		expect(SWORD_DATA.finisherReach).toBeCloseTo((WEB_SWORD_TIMINGS.finisherReach * SWORD_REACH_PERCENT) / 100, 12);
		expect(SWORD_DATA.guardReach).toBe(1.9);
	});
});
