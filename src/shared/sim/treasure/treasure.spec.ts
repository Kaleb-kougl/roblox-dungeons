// Treasure rooms in the sim, the skeleton (docs/TREASURE.md TR2): the opt-in config, state.treasure created with its
// own stream and filled from the floor's vault plan at run start (dev mode's startFloor) and on every floor change,
// clone, the "treasure" hash group appended last only with the config (dump names), the shared tier / lock tables, and
// with the config absent nothing changes. Floors with vaults come from shared/run/testing buildVaultRunConfig (no
// world rolls vaults or sets the config until TR5).
import { describe, expect, it } from "@rbxts/jest-globals";
import "shared/sim/testing";
import { VAULT, VaultLock, VaultTier, gridToWorld, type VaultPlan } from "shared/dungeon";
import {
	AXIS_MAX,
	BreakableKind,
	CHEST_HP,
	DEBUG_FLOOR_BUTTON,
	DROPS,
	EMPTY_INPUT,
	ENDLESS_TREASURE_CONFIG,
	PELLETS_SUBSYSTEM,
	SCORE_SUBSYSTEM,
	TREASURE,
	TREASURE_HASH_FIELDS,
	TREASURE_SUBSYSTEM,
	TREASURE_UNSET,
	VAULT_LOCK_COUNT,
	VAULT_TIER_COUNT,
	VaultStatus,
	cloneSimState,
	createSimState,
	dropsSeedState,
	hashLayout,
	hashState,
	step,
	stepParty,
	treasureOnFloor,
	treasureRunSummary,
	treasureSeedState,
	writeHashFields,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { buildEndlessRunConfig, type EndlessRunSetup } from "shared/run";
import { buildVaultRunConfig, dismissDraft } from "shared/run/testing";

const SEED = 4242;
const EVERY = { every: true };

function fresh(setup: EndlessRunSetup, config: SimConfig = setup.config, seed = SEED): SimState {
	return createSimState(seed, setup.spawn!.x, setup.spawn!.z, config);
}

function tickAll(s: SimState, config: SimConfig, input: InputFrame = EMPTY_INPUT): void {
	if (s.party === undefined) step(s, input, config);
	else {
		const frames: InputFrame[] = [];
		for (let i = 0; i < s.party.size; i++) frames.push(i === 0 ? input : EMPTY_INPUT);
		stepParty(s, frames, config);
	}
}

/** The debug floor skip (press, release), the draft that opens dismissed. */
function skipFloor(s: SimState, config: SimConfig): void {
	tickAll(s, config, { ...EMPTY_INPUT, buttons: DEBUG_FLOOR_BUTTON });
	dismissDraft(s);
	tickAll(s, config);
}

/** state.treasure holds `plan` on the state's current records and pieces (SEALED, nothing armed). */
function expectSealed(s: SimState, plan: VaultPlan): void {
	const t = s.treasure!;
	const rec = s.score!.rooms[t.record];
	expect(rec.room).toBe(plan.room);
	expect(rec.engageTick).toBe(-1);
	const piece = s.breakables!.pieces[plan.slot];
	expect([piece.kind, piece.x, piece.y, piece.hp]).toEqual([BreakableKind.CHEST, plan.x, plan.y, CHEST_HP]);
	expect([t.status, t.room, t.slot, t.x, t.z, t.fx, t.fz]).toEqual([
		VaultStatus.SEALED,
		plan.room,
		plan.slot,
		gridToWorld(plan.x),
		gridToWorld(plan.y),
		plan.fx,
		plan.fz,
	]);
	expect([t.lock, t.startTier, t.tier]).toEqual([plan.lock, plan.tier, plan.tier]);
	for (const v of [t.armTick, t.ticksLeft, t.allowance, t.crackTick, t.missBy, t.spare])
		expect(v).toBe(TREASURE_UNSET);
}

function expectNone(s: SimState): void {
	const t = s.treasure!;
	expect([t.status, t.room, t.record, t.slot, t.lock, t.tier]).toEqual([
		VaultStatus.NONE,
		TREASURE_UNSET,
		TREASURE_UNSET,
		TREASURE_UNSET,
		TREASURE_UNSET,
		TREASURE_UNSET,
	]);
}

describe("treasure: data shared with the dungeon", () => {
	it("tier and lock tables: COMMON / RARE / LEGENDARY 0-2, UNTOUCHED / SWIFT 0-1, every per-tier table 3 long", () => {
		expect([VaultTier.COMMON, VaultTier.RARE, VaultTier.LEGENDARY, VAULT_TIER_COUNT]).toEqual([0, 1, 2, 3]);
		expect([VaultLock.UNTOUCHED, VaultLock.SWIFT, VAULT_LOCK_COUNT]).toEqual([0, 1, 2]);
		expect(VAULT.lockWeights.size()).toBe(VAULT_LOCK_COUNT);
		const c = ENDLESS_TREASURE_CONFIG;
		expect([c.points.size(), c.boosts.size()]).toEqual([VAULT_TIER_COUNT, VAULT_TIER_COUNT]);
		expect([...c.points]).toEqual([300, 800, 1500]);
		expect([...c.boosts]).toEqual([2, 0, 1]);
		expect([c.swiftParPercent, c.reachTiles]).toEqual([100, 1.5]);
		expect([...c.respiteAllowance]).toEqual([0, 0, 1, 1]);
		expect([...c.respiteSwiftPercent]).toEqual([0, 10, 20, 30]);
	});

	it("its own stream (KVTR), apart from the drops' (KVDR); boost offsets in front of the chest, one per ground slot", () => {
		expect(TREASURE.salt).toBe(0x4b565452);
		expect(treasureSeedState(SEED)).toBe(bit32.bxor(SEED, TREASURE.salt));
		expect(treasureSeedState(SEED)).never.toBe(dropsSeedState(SEED));
		expect(TREASURE.boostOffsets.size()).toBe(DROPS.maxOnGround);
		for (const o of TREASURE.boostOffsets) {
			expect(o.forward > 0.5).toBe(true);
			expect(math.abs(o.side) < 0.5).toBe(true);
		}
	});
});

/**
 * `config` without pacts and the Goldling (docs/FORTUNE.md: every endless world sets them too; their groups follow
 * treasure's and their HORDE / GOLDEN sources pad TREASURE), so treasure stays the last group here: what it adds, alone.
 */
function noFortune(config: SimConfig): SimConfig {
	// Secret rooms (docs/SECRET_ROOMS.md SR5) too: their group follows the Goldling's, their SECRET source pads last.
	return { ...config, pacts: undefined, golden: undefined, secrets: undefined };
}

describe("treasure: opt-in", () => {
	it("absent without SimConfig.treasure: no state, no group; the run hashes exactly as before", () => {
		const endless = buildEndlessRunConfig(SEED);
		const setup = { ...endless, config: noFortune({ ...endless.config, treasure: undefined }) };
		const s = fresh(setup);
		expect(s.treasure).toBe(undefined);
		expect(hashLayout(s).groups[hashLayout(s).groups.size() - 1].name).toBe(PELLETS_SUBSYSTEM);
		expect(treasureRunSummary(s)).toEqual({ opened: 0, kept: 0, legendary: 0 });
		// Vault floors without the config: the chest is a piece (blocks), nothing else knows.
		const vaults = buildVaultRunConfig(SEED, 1, { override: EVERY, treasure: false });
		const v = fresh(vaults, noFortune(vaults.config));
		expect(v.treasure).toBe(undefined);
		expect(v.score!.points.size()).toBe(s.score!.points.size());
	});

	it("present: the group is appended last; every other group equals the run without it but score's padding", () => {
		const setup = buildVaultRunConfig(SEED, 1, { override: EVERY, startFloor: 2 });
		const on = noFortune(setup.config);
		const off: SimConfig = { ...on, treasure: undefined };
		const a = fresh(setup, off);
		const b = fresh(setup, on);
		for (let t = 0; t < 120; t++) {
			const la = hashLayout(a, true);
			const lb = hashLayout(b, true);
			expect(lb.groups.size()).toBe(la.groups.size() + 1);
			const last = lb.groups[lb.groups.size() - 1];
			expect([last.name, lb.groups[lb.groups.size() - 2].name]).toEqual([TREASURE_SUBSYSTEM, PELLETS_SUBSYSTEM]);
			for (let g = 0; g < la.groups.size(); g++) {
				const ga = la.groups[g];
				const gb = lb.groups[g];
				expect(gb.name).toBe(ga.name);
				const va: number[] = [];
				const vb: number[] = [];
				for (let i = ga.start; i < ga.finish; i++) va.push(la.values[i]);
				for (let i = gb.start; i < gb.finish; i++) vb.push(lb.values[i]);
				if (ga.name !== SCORE_SUBSYSTEM) expect(vb).toEqual(va);
				// The same sources: since docs/BUILDS_V2.md BV9 the builds run pads TREASURE on its way to OVERCAP.
				else expect(vb.size()).toBe(va.size());
			}
			expect(lb.values).toEqual(writeHashFields(b, []));
			step(a, EMPTY_INPUT, off);
			step(b, EMPTY_INPUT, on);
		}
	});

	it("the group's values and dump names: TREASURE_HASH_FIELDS, then bonusDeals", () => {
		const setup = buildVaultRunConfig(SEED, 3, { override: EVERY, startFloor: 2 });
		const s = fresh(setup);
		const l = hashLayout(s, true);
		const g = l.groups.find((x) => x.name === TREASURE_SUBSYSTEM)!;
		const t = s.treasure!;
		const want: number[] = [];
		const names: string[] = [];
		for (const f of TREASURE_HASH_FIELDS) {
			want.push(t[f]);
			names.push(`treasure.${f}`);
		}
		want.push(3, 0, 0, 0);
		names.push(
			"treasure.bonusDeals.length",
			"treasure.bonusDeals[0]",
			"treasure.bonusDeals[1]",
			"treasure.bonusDeals[2]",
		);
		const got: number[] = [];
		const gotNames: string[] = [];
		for (let i = g.start; i < g.finish; i++) {
			got.push(l.values[i]);
			gotNames.push(l.names[i]);
		}
		expect(got).toEqual(want);
		expect(gotNames).toEqual(names);
		expect(TREASURE_HASH_FIELDS.size()).toBe(21);
	});
});

describe("treasure: create and floor changes", () => {
	it("floor 1 never holds a vault: NONE, the stream seeded, one bonus-deal entry per player", () => {
		for (const n of [1, 2, 4]) {
			const setup = buildVaultRunConfig(SEED, n, { override: EVERY });
			const s = fresh(setup);
			expect(setup.endlessFloor(1).vault).toBe(undefined);
			expectNone(s);
			const t = s.treasure!;
			expect(t.rngState).toBe(treasureSeedState(SEED));
			expect(t.bonusDeals).toEqual(n === 1 ? [0] : n === 2 ? [0, 0] : [0, 0, 0, 0]);
			expect([t.opened, t.kept, t.legendary]).toEqual([0, 0, 0]);
		}
	});

	it("dev mode's startFloor: the start floor's vault, SEALED on its record and chest piece", () => {
		const setup = buildVaultRunConfig(SEED, 1, { override: EVERY, startFloor: 3 });
		const plan = setup.endlessFloor(3).vault;
		expect(plan).never.toBe(undefined);
		const s = fresh(setup);
		expectSealed(s, plan!);
	});

	it("every floor change loads the new floor's vault (or none), keeps the stream and counters; the draft takes the bonus deals", () => {
		for (const override of [EVERY, undefined]) {
			const setup = buildVaultRunConfig(SEED, 1, { override });
			const s = fresh(setup);
			const t = s.treasure!;
			let vaults = 0;
			let nones = 0;
			for (let f = 2; f <= 7; f++) {
				t.bonusDeals[0] = 1; // test-only: as after a Legendary open; stepRun step 1 deals it (TR4)
				const rng = t.rngState;
				skipFloor(s, setup.config);
				expect(s.endless!.floor).toBe(f);
				const plan = setup.endlessFloor(f).vault;
				if (plan !== undefined) {
					expectSealed(s, plan);
					vaults++;
				} else {
					expectNone(s);
					nones++;
				}
				expect([t.rngState, t.bonusDeals[0]]).toEqual([rng, 0]);
			}
			expect(vaults + nones).toBe(6);
			if (override === EVERY) expect(nones).toBe(0);
		}
	});

	it("an armed vault left behind is gone on the next floor (lost silently)", () => {
		const setup = buildVaultRunConfig(SEED, 1, { override: EVERY, startFloor: 2 });
		const s = fresh(setup);
		s.treasure!.status = VaultStatus.ARMED; // test-only: as if its room had engaged
		s.treasure!.armTick = 5;
		skipFloor(s, setup.config);
		expectSealed(s, setup.endlessFloor(3).vault!);
	});

	it("treasureOnFloor refuses a plan whose slot is not the chest on its cell", () => {
		const setup = buildVaultRunConfig(SEED, 1, { override: EVERY, startFloor: 2 });
		const s = fresh(setup);
		const plan = setup.endlessFloor(2).vault!;
		expect(() => treasureOnFloor(s, { ...plan, slot: 0 })).toThrow();
		expect(() => treasureOnFloor(s, { ...plan, x: plan.x + 1 })).toThrow();
		treasureOnFloor(s, undefined);
		expectNone(s);
		treasureOnFloor(s, plan);
		expectSealed(s, plan);
	});
});

describe("treasure: clone and determinism", () => {
	it("clone copies every field (bonusDeals its own array) and hashes the same", () => {
		const setup = buildVaultRunConfig(SEED, 2, { override: EVERY, startFloor: 2 });
		const s = fresh(setup);
		s.treasure!.bonusDeals[1] = 1;
		const c = cloneSimState(s);
		expect(c.treasure).toEqual(s.treasure);
		expect(c.treasure!.bonusDeals).never.toBe(s.treasure!.bonusDeals);
		expect(c.treasure!.events).never.toBe(s.treasure!.events);
		expect(hashState(c)).toBe(hashState(s));
	});

	it("two identical vault runs hash the same every tick", () => {
		const setup = buildVaultRunConfig(SEED, 1, { override: EVERY, startFloor: 2 });
		const a = fresh(setup);
		const b = fresh(setup);
		for (let t = 0; t < 200; t++) {
			const input: InputFrame = { ...EMPTY_INPUT, moveX: t % 50 < 25 ? AXIS_MAX : -AXIS_MAX };
			step(a, input, setup.config);
			step(b, input, setup.config);
			expect(hashState(a)).toBe(hashState(b));
		}
	});
});
