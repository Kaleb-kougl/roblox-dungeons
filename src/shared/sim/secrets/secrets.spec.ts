// Secret rooms' state, chest, score and hash (docs/SECRET_ROOMS.md SR4) on the secret arena (shared/sim/testing
// secretArena.ts): opt-in (no SimConfig.secrets: no state, no group, no SECRET source, the crack never opens); the floor
// fill (HIDDEN with the plan's slots, a plan out of step with the pieces throws); the open's SECRET points (600 x the
// kills' floor scale, combo-neutral); the chest opens on reach for every living present player with the vault's shares
// on the secrets' own stream (Rare a relic each; Legendary a bonus deal each into state.treasure.bonusDeals, taken by
// the next floor's draft, plus its boost); its treasure points into SECRET; run counters and secretsRunSummary; the
// `secrets` group last; clone and replay determinism; the next floor resets the secret.
import { describe, expect, it } from "@rbxts/jest-globals";
import { ARENA, arenaConfig, arenaWorld, type ArenaOptions } from "shared/sim/testing";
import { VaultTier, gridToWorld } from "shared/dungeon";
import {
	AXIS_MAX,
	BUILDS_CONFIG,
	Button,
	DEBUG_FLOOR_BUTTON,
	EMPTY_INPUT,
	ENDLESS_TREASURE_CONFIG,
	GOLDEN_SUBSYSTEM,
	SECRETS_CONFIG,
	SECRETS_SALT,
	SECRETS_SUBSYSTEM,
	SECRET_POINTS,
	SECRET_UNSET,
	ScoreSource,
	SecretHow,
	SecretStatus,
	TREASURE_POINTS,
	TREASURE_UNSET,
	cloneSimState,
	createSimState,
	floorScalePercent,
	hashLayout,
	hashState,
	isDraftOpen,
	meleeHitBreakables,
	playerAt,
	secretsRunSummary,
	secretsSeedState,
	seedToState,
	step,
	stepParty,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";

const SEED = 4711;
const CX = gridToWorld(ARENA.crackX) + 0.5;
const CZ = gridToWorld(ARENA.wallZ);

const frame = (over: Partial<InputFrame> = {}): InputFrame => ({ ...EMPTY_INPUT, aimZ: -AXIS_MAX, ...over });
const IDLE = frame();

const FULL: Partial<SimConfig> = {
	secrets: SECRETS_CONFIG,
	scoring: {},
	builds: BUILDS_CONFIG,
	treasure: ENDLESS_TREASURE_CONFIG,
};

function arena(o: ArenaOptions = {}, extra: Partial<SimConfig> = FULL): { config: SimConfig; s: SimState } {
	const config = arenaConfig(SEED, { ...o, extraConfig: { ...extra, ...o.extraConfig } });
	const s = createSimState(SEED, ARENA.spawnX, ARENA.spawnZ, config);
	for (let i = 0; i < (config.party?.size ?? 1); i++) playerAt(s, i).hurtTicks = 1e6;
	return { config, s };
}

/** Opens the crack with a finisher pass straight onto it (the opener specs cover the real ones). */
function openIt(s: SimState): void {
	meleeHitBreakables(s, CX, CZ + 1.5, 0, -1, 2.53, 0, 6, 0, true);
	expect(s.secrets!.status).toBe(SecretStatus.OPEN);
}

/** Moves the first `moved` players next to the chest (in reach) and steps once (a party of `party`). */
function reachChest(s: SimState, config: SimConfig, party = 1, moved = party): void {
	for (let i = 0; i < moved; i++) {
		const p = playerAt(s, i);
		p.x = gridToWorld(ARENA.chestX) + (i - (moved - 1) / 2) * 0.4;
		p.z = gridToWorld(ARENA.chestY) + 1;
	}
	if (party === 1) step(s, IDLE, config);
	else {
		const inputs: InputFrame[] = [];
		for (let i = 0; i < party; i++) inputs.push(IDLE);
		stepParty(s, inputs, config);
	}
}

describe("secrets: opt-in", () => {
	it("without SimConfig.secrets: no state, no group, no SECRET source, the crack never opens", () => {
		const { s } = arena({}, { scoring: {}, builds: BUILDS_CONFIG });
		expect(s.secrets).toBe(undefined);
		const groups = hashLayout(s).groups.map((g) => g.name);
		expect(groups.includes(SECRETS_SUBSYSTEM)).toBe(false);
		expect(s.score!.points.size()).toBe(ScoreSource.SECRET);
		meleeHitBreakables(s, CX, CZ + 1.5, 0, -1, 2.53, 0, 6, 0, true);
		expect(s.breakables!.knockSlots.size()).toBe(ARENA.cells);
		const first = s.breakables!.pieces.size() - 1 - ARENA.cells;
		expect(s.breakables!.pieces[first].hp).toBe(1);
	});

	it("with it: the group is the last one (after golden when there is one), SECRET is the 17th source", () => {
		const { s } = arena();
		const groups = hashLayout(s).groups.map((g) => g.name);
		expect(groups[groups.size() - 1]).toBe(SECRETS_SUBSYSTEM);
		expect(groups.includes(GOLDEN_SUBSYSTEM)).toBe(false);
		expect(s.score!.points.size()).toBe(ScoreSource.SECRET + 1);
		expect(ScoreSource.SECRET).toBe(16);
		// Without builds the earlier gated sources are padded too.
		const bare = arena({}, { secrets: SECRETS_CONFIG, scoring: {} }).s;
		expect(bare.score!.points.size()).toBe(ScoreSource.SECRET + 1);
	});

	it("its own stream: seedToState(seed) XOR SECRETS_SALT", () => {
		expect(SECRETS_SALT).toBe(0x4b565352);
		expect(secretsSeedState(SEED)).toBe(bit32.bxor(seedToState(SEED), SECRETS_SALT));
		expect(arena().s.secrets!.rngState).toBe(secretsSeedState(SEED));
	});
});

describe("secrets: the floor fill", () => {
	it("HIDDEN with the plan's room, slots, chest centre, facing and tier", () => {
		const { s } = arena({ extra: [{ x: 5, y: 12, kind: "barrel" }], tier: VaultTier.LEGENDARY });
		const sc = s.secrets!;
		expect([sc.status, sc.room, sc.crackSlot, sc.cells, sc.chestSlot]).toEqual([SecretStatus.HIDDEN, 0, 1, 2, 3]);
		expect([sc.x, sc.z, sc.fx, sc.fz, sc.tier]).toEqual([
			gridToWorld(ARENA.chestX),
			gridToWorld(ARENA.chestY),
			0,
			1,
			VaultTier.LEGENDARY,
		]);
		expect([sc.openTick, sc.openedBy, sc.openHow, sc.takenBy]).toEqual([
			SECRET_UNSET,
			SECRET_UNSET,
			SECRET_UNSET,
			SECRET_UNSET,
		]);
	});

	it("no plan: NONE; a plan out of step with the pieces throws", () => {
		expect(arena({ noPlan: true }).s.secrets!.status).toBe(SecretStatus.NONE);
		const world = arenaWorld();
		const bad = (floor: number) => ({ ...world(floor), breakables: [] });
		const config: SimConfig = { ...arenaConfig(SEED), ...FULL, endless: { runSeed: SEED, worldForFloor: bad } };
		expect(() => createSimState(SEED, ARENA.spawnX, ARENA.spawnZ, config)).toThrow();
	});
});

describe("secrets: the open's points", () => {
	it("SECRET_POINTS at the kills' floor scale, combo-neutral; once", () => {
		const { s } = arena();
		const combo = s.score!.combo;
		openIt(s);
		const want = (SECRET_POINTS * floorScalePercent(1)) / 100;
		expect(s.score!.points[ScoreSource.SECRET]).toBe(want);
		expect(s.score!.counts[ScoreSource.SECRET]).toBe(1);
		expect(s.secrets!.events.opened!.points).toBe(want);
		expect(s.score!.combo).toBe(combo);
		meleeHitBreakables(s, CX, CZ + 1.5, 0, -1, 2.53, 0, 6, 0, true);
		expect(s.score!.counts[ScoreSource.SECRET]).toBe(1);
	});
});

describe("secrets: the chest", () => {
	it("hidden: walking to it does nothing (the crack holds); open: the first living player in reach takes it", () => {
		const { config, s } = arena();
		reachChest(s, config); // teleported past the crack: still HIDDEN, nothing to take
		expect(s.secrets!.status).toBe(SecretStatus.HIDDEN);
		openIt(s);
		step(s, IDLE, config); // out of reach (the player stands at the chest already: reachChest moved them)
		expect(s.secrets!.status).toBe(SecretStatus.TAKEN);
	});

	it("Rare: a relic each (solo), the chest's treasure points into SECRET; counters and the summary", () => {
		const { config, s } = arena();
		openIt(s);
		const before = s.score!.points[ScoreSource.SECRET];
		const treasureBefore = s.score!.points[ScoreSource.TREASURE];
		reachChest(s, config);
		const sc = s.secrets!;
		expect([sc.status, sc.takenBy, sc.found, sc.taken]).toEqual([SecretStatus.TAKEN, 0, 1, 1]);
		const ev = sc.events.taken!;
		expect([ev.opener, ev.tier, ev.grants.size()]).toEqual([0, VaultTier.RARE, 1]);
		expect(ev.grants[0].relic).never.toBe(TREASURE_UNSET);
		expect(s.run!.players[0].relics.includes(ev.grants[0].relic)).toBe(true);
		expect(ev.points).toBe(TREASURE_POINTS[VaultTier.RARE]);
		expect(s.score!.points[ScoreSource.SECRET]).toBe(before + ev.points);
		expect(s.score!.points[ScoreSource.TREASURE]).toBe(treasureBefore);
		expect(secretsRunSummary(s)).toEqual({ found: 1, taken: 1, byHow: [1, 0, 0, 0] });
		// Once.
		step(s, IDLE, config);
		expect([sc.taken, sc.events.taken]).toEqual([1, undefined]);
	});

	it("Legendary with builds: a bonus deal each into treasure.bonusDeals (taken by the next floor's draft) + a boost", () => {
		const { config, s } = arena({ tier: VaultTier.LEGENDARY });
		openIt(s);
		reachChest(s, config);
		const g = s.secrets!.events.taken!.grants[0];
		expect([g.bonusDeal, g.relic, g.boosts.size()]).toEqual([1, TREASURE_UNSET, 1]);
		expect(s.treasure!.bonusDeals[0]).toBe(1);
		// The next floor's draft takes it.
		step(s, frame({ buttons: DEBUG_FLOOR_BUTTON }), config);
		for (let t = 0; t < 3 && !isDraftOpen(s); t++) step(s, IDLE, config);
		expect(isDraftOpen(s)).toBe(true);
		expect(s.treasure!.bonusDeals[0]).toBe(0);
	});

	it("Legendary without treasure state: the relic instead of the deal", () => {
		const { config, s } = arena(
			{ tier: VaultTier.LEGENDARY },
			{ secrets: SECRETS_CONFIG, scoring: {}, builds: BUILDS_CONFIG },
		);
		openIt(s);
		reachChest(s, config);
		const g = s.secrets!.events.taken!.grants[0];
		expect(g.bonusDeal).toBe(0);
		expect(g.relic).never.toBe(TREASURE_UNSET);
	});

	it("a party of 3: every living present player gets a share, the dead none; one opener", () => {
		const { config, s } = arena({ extraConfig: { party: { size: 3 }, scoring: { partySize: 3 } } });
		playerAt(s, 2).dead = 1;
		openIt(s);
		reachChest(s, config, 3, 2);
		const ev = s.secrets!.events.taken!;
		expect(ev.grants.map((g) => g.player)).toEqual([0, 1]);
		for (const g of ev.grants) expect(g.relic).never.toBe(TREASURE_UNSET);
	});

	it("the next floor resets the secret (the counters carry over); the stream carries over", () => {
		const { config, s } = arena();
		openIt(s);
		reachChest(s, config);
		const word = s.secrets!.rngState;
		step(s, frame({ buttons: DEBUG_FLOOR_BUTTON }), config);
		const sc = s.secrets!;
		expect([sc.status, sc.found, sc.taken, sc.rngState]).toEqual([SecretStatus.HIDDEN, 1, 1, word]);
		expect(s.breakables!.pieces[0].brokenTick).toBe(-1);
	});
});

describe("secrets: clone, hash and replay", () => {
	it("clone hashes the same; two runs with the same inputs hash the same every tick (open and take included)", () => {
		const runs = [arena(), arena()];
		const fire = frame({ buttons: Button.FIRE });
		for (let t = 0; t < 200; t++) {
			const input = t < 90 ? fire : frame({ moveZ: -AXIS_MAX, moveX: t % 7 === 0 ? AXIS_MAX : 0 });
			for (const r of runs) {
				if (t === 0) {
					r.s.player.x = CX;
					r.s.player.z = CZ + 2;
				}
				step(r.s, input, r.config);
			}
			expect(hashState(runs[0].s)).toBe(hashState(runs[1].s));
			expect(hashState(cloneSimState(runs[0].s))).toBe(hashState(runs[0].s));
		}
		expect(runs[0].s.secrets!.openHow).toBe(SecretHow.FINISHER);
		expect(runs[0].s.secrets!.status).toBe(SecretStatus.TAKEN);
	});
});
