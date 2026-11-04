// The vault's lock in the tick (docs/TREASURE.md TR3, Design §2 steps 1-3): the vault arms on its room's engagement
// (not on sight), UNTOUCHED cracks on the hit past the party's allowance (armor and Aegis hits count, i-framed and
// god-mode hits do not), SWIFT cracks when its countdown reaches 0 exactly S ticks after arming and so agrees with
// FAST at 100 %, a draft holds the countdown, a lock cracks once, a hit on the clear tick cracks, the clear unlocks
// (only once adopted children are down too) with missBy / spare, the Respite tables through the pure helpers, a floor
// change drops the vault, and UNLOCKED stays UNLOCKED while nobody living is in reach (the open: open.spec.ts). Worlds: real endless floors built with vaults
// (shared/run/testing buildVaultRunConfig; the override fixes the lock and tier), seed 4242 (a TR1 census floor range).
//
// Test-only surgery: players are made unhittable between ticks (hurtTicks) so only the hits a spec lands count;
// `quiet` ticks run only the score and treasure passes (score.spec.ts's tick pattern: clear events, the tick's hooks,
// stepScore, stepTreasure, tick += 1); members die through SimCtx; teleports.
import { describe, expect, it } from "@rbxts/jest-globals";
import "shared/sim/testing";
import { VaultLock, VaultTier } from "shared/dungeon";
import {
	Boost,
	BulletKind,
	DEBUG_FLOOR_BUTTON,
	EMPTY_INPUT,
	ENDLESS_TREASURE_CONFIG,
	NO_KIND,
	SOLO_PLAYER,
	ScoreSource,
	SimCtx,
	TREASURE_RESPITE_NONE,
	TREASURE_UNSET,
	VaultStatus,
	adoptScoreRoomMember,
	awardPoints,
	clearEvents,
	clearScoreEvents,
	clearTreasureEvents,
	closeDraft,
	createSimState,
	damagePlayer,
	fireBurstRaw,
	hashState,
	openDraft,
	packPayload,
	partySize,
	playerAt,
	scoreRoomDown,
	simWorldConfig,
	step,
	stepParty,
	stepScore,
	stepTreasure,
	swiftTicks,
	treasureRespiteLevel,
	vaultAllowance,
	type ActorState,
	type InputFrame,
	type RoomScore,
	type SimConfig,
	type SimState,
	type TreasureState,
} from "shared/sim";
import { buildVaultRunConfig, dismissDraft, type VaultRunOptions } from "shared/run/testing";
import type { EndlessRunSetup } from "shared/run";

const SEED = 4242;
/** Long enough that nothing an enemy does lands between the spec's own hits. */
const UNHITTABLE = 1e6;

interface Run {
	readonly setup: EndlessRunSetup;
	readonly config: SimConfig;
	readonly s: SimState;
}

interface RunOptions {
	readonly tier?: number;
	readonly party?: number;
	readonly floor?: number;
	readonly seed?: number;
	readonly extra?: Partial<SimConfig>;
	readonly vault?: VaultRunOptions;
}

/** A vault run starting on `floor` (default 2) whose every floor holds a vault with `lock` (and `tier`, default RARE). */
function vaultRun(lock: number, o: RunOptions = {}): Run {
	const seed = o.seed ?? SEED;
	const setup = buildVaultRunConfig(seed, o.party ?? 1, {
		override: { every: true, lock, tier: o.tier ?? VaultTier.RARE },
		startFloor: o.floor ?? 2,
		...o.vault,
	});
	const config: SimConfig = { ...setup.config, ...o.extra };
	const s = createSimState(seed, setup.spawn!.x, setup.spawn!.z, config);
	guard(s);
	return { setup, config, s };
}

function guard(s: SimState): void {
	for (let i = 0; i < partySize(s); i++) {
		const p = playerAt(s, i);
		p.hurtTicks = UNHITTABLE;
		p.hearts = p.heartsMax;
	}
}

const T = (r: Run): TreasureState => r.s.treasure!;
const rec = (r: Run): RoomScore => r.s.score!.rooms[T(r).record];

/** One real tick (every player but 0 idle), players kept unhittable. */
function tick(r: Run, input: InputFrame = EMPTY_INPUT): void {
	if (r.s.party === undefined) step(r.s, input, r.config);
	else {
		const frames: InputFrame[] = [];
		for (let i = 0; i < r.s.party.size; i++) frames.push(i === 0 ? input : EMPTY_INPUT);
		stepParty(r.s, frames, r.config);
	}
	guard(r.s);
}

/** A tick of the score and treasure passes only, `during` its hooks (no player / actor / bullet step). */
function quiet(r: Run, during?: () => void): void {
	const s = r.s;
	clearEvents(s.events);
	clearScoreEvents(s.score!);
	clearTreasureEvents(T(r));
	if (during !== undefined) during();
	stepScore(s);
	stepTreasure(s);
	s.tick += 1;
}

/** `n` landed hits this tick on player `i` (normally hittable for the hit), through damagePlayer. */
function hurt(r: Run, n = 1, i = 0, prep?: (s: SimState) => void): void {
	quiet(r, () => {
		for (let k = 0; k < n; k++) {
			const p = playerAt(r.s, i);
			p.hurtTicks = 0;
			if (prep !== undefined) prep(r.s);
			damagePlayer(r.s, 1, p, i);
			p.hurtTicks = UNHITTABLE;
			p.hearts = p.heartsMax;
		}
	});
}

/** Forward cells from the chest's centre where enter() leaves player 0: FLOOR (VAULT.wallClearTiles), out of reach. */
const OUT_OF_REACH = 2;

/**
 * Player 0 onto the cell in front of the chest; one real tick: the room spawns, its record engages. Then a step back
 * to the second cell in front, out of the chest's reach, so a clear only unlocks it (the open is open.spec.ts's).
 */
function enter(r: Run): void {
	const t = T(r);
	const p = r.s.player;
	p.x = t.x + t.fx;
	p.z = t.z + t.fz;
	tick(r);
	expect(rec(r).engageTick).toBe(r.s.tick - 1);
	p.x = t.x + t.fx * OUT_OF_REACH;
	p.z = t.z + t.fz * OUT_OF_REACH;
	expect(OUT_OF_REACH > t.config.reachTiles).toBe(true);
}

function liveMembers(r: Run): ActorState[] {
	const s = r.s;
	const out: ActorState[] = [];
	const room = rec(r);
	for (let k = 0; k < room.memberSlots.size(); k++) {
		const a: ActorState | undefined = s.combat.actors[room.memberSlots[k]];
		if (a !== undefined && a.kind !== NO_KIND && a.id === room.memberIds[k] && a.alive !== 0) out.push(a);
	}
	return out;
}

/** Kills every living member (and any children they leave, adopted on death) through SimCtx, between ticks. */
function killRoom(r: Run, keep?: ActorState): void {
	const ctx = new SimCtx().bind(r.s, simWorldConfig(r.s, r.config), EMPTY_INPUT);
	for (let pass = 0; pass < 8; pass++) {
		const live = liveMembers(r).filter((a) => a !== keep);
		if (live.size() === 0) return;
		for (const a of live) if (a.alive !== 0) ctx.killActor(a);
	}
	error("killRoom: members kept coming back", 0);
}

/** Quiet ticks until state.tick === `at`. */
function quietUntil(r: Run, at: number): void {
	while (r.s.tick < at) quiet(r);
}

function skipFloor(r: Run): void {
	tick(r, { ...EMPTY_INPUT, buttons: DEBUG_FLOOR_BUTTON });
	dismissDraft(r.s);
	tick(r);
}

describe("treasure lock: arming (step 1)", () => {
	it("SEALED until its room engages: seeing the room from the entrance arms nothing", () => {
		const r = vaultRun(VaultLock.UNTOUCHED);
		for (let k = 0; k < 120; k++) {
			tick(r);
			expect([T(r).status, T(r).events.armed]).toEqual([VaultStatus.SEALED, 0]);
		}
		expect(rec(r).engageTick).toBe(-1);
	});

	it("arms on the engagement tick: UNTOUCHED allowance 0 solo; SWIFT ticksLeft = par; events.armed that tick only", () => {
		for (const lock of [VaultLock.UNTOUCHED, VaultLock.SWIFT]) {
			const r = vaultRun(lock);
			enter(r);
			const t = T(r);
			expect([t.status, t.armTick, t.events.armed]).toEqual([VaultStatus.ARMED, rec(r).engageTick, 1]);
			if (lock === VaultLock.UNTOUCHED) expect([t.allowance, t.ticksLeft]).toEqual([0, TREASURE_UNSET]);
			else expect([t.allowance, t.ticksLeft]).toEqual([TREASURE_UNSET, rec(r).parTicks]);
			expect([t.crackTick, t.missBy, t.spare]).toEqual([TREASURE_UNSET, TREASURE_UNSET, TREASURE_UNSET]);
			tick(r);
			expect([t.status, t.events.armed]).toEqual([VaultStatus.ARMED, 0]);
		}
	});

	it("co-op: the allowance is present players - 1, fixed at arm time", () => {
		for (const n of [2, 3, 4]) {
			const r = vaultRun(VaultLock.UNTOUCHED, { party: n });
			enter(r);
			expect([n, T(r).allowance]).toEqual([n, n - 1]);
		}
	});
});

describe("treasure lock: UNTOUCHED (step 2)", () => {
	it("solo: the first landed hit cracks (Rare -> Common, Legendary -> Rare), once; events.cracked that tick", () => {
		for (const [tier, down] of [
			[VaultTier.RARE, VaultTier.COMMON],
			[VaultTier.LEGENDARY, VaultTier.RARE],
		] as const) {
			const r = vaultRun(VaultLock.UNTOUCHED, { tier });
			enter(r);
			hurt(r);
			const t = T(r);
			const at = r.s.tick - 1;
			expect([t.status, t.startTier, t.tier, t.crackTick, t.events.cracked]).toEqual([
				VaultStatus.CRACKED,
				tier,
				down,
				at,
				1,
			]);
			hurt(r, 2);
			expect([t.status, t.tier, t.crackTick, t.events.cracked]).toEqual([VaultStatus.CRACKED, down, at, 0]);
		}
	});

	it("a hit landed on the engagement tick counts (as for PERFECT): it cracks on the arm tick", () => {
		const r = vaultRun(VaultLock.UNTOUCHED);
		const t = T(r);
		const s = r.s;
		const p = s.player;
		p.x = t.x + t.fx;
		p.z = t.z + t.fz;
		p.hurtTicks = 0;
		// An enemy bullet on the player: it lands in this tick's stepCombat, before stepEndless engages the room.
		const em = s.combat.enemyBullets.acquireEmitter();
		s.combat.enemyEmitters += 1;
		const payload = packPayload(1, BulletKind.ENEMY, 1);
		s.combat.enemySpawned += fireBurstRaw(s.combat.enemyBullets, em, p.x, p.z, 1, 0, 1, 0, 0.1, 2, payload);
		step(s, EMPTY_INPUT, r.config);
		guard(s);
		expect(s.events.playerHits).toBe(1);
		expect(rec(r).engageTick).toBe(s.tick - 1);
		expect([t.status, t.armTick, t.crackTick, t.events.armed, t.events.cracked]).toEqual([
			VaultStatus.CRACKED,
			s.tick - 1,
			s.tick - 1,
			1,
			1,
		]);
	});

	it("party of 3: allowance 2, the third hit (any players) cracks", () => {
		const r = vaultRun(VaultLock.UNTOUCHED, { party: 3 });
		enter(r);
		hurt(r, 1, 0);
		hurt(r, 1, 1);
		expect(T(r).status).toBe(VaultStatus.ARMED);
		hurt(r, 1, 2);
		expect([T(r).status, T(r).tier]).toEqual([VaultStatus.CRACKED, VaultTier.COMMON]);
	});

	it("armor and Aegis hits count", () => {
		const armor = vaultRun(VaultLock.UNTOUCHED);
		enter(armor);
		hurt(armor, 1, 0, (s) => (s.player.armor = 1));
		expect([armor.s.player.armor, T(armor).status]).toEqual([0, VaultStatus.CRACKED]);
		const aegis = vaultRun(VaultLock.UNTOUCHED);
		enter(aegis);
		hurt(aegis, 1, 0, (s) => {
			const bp = s.drops!.players[SOLO_PLAYER];
			bp.aegisPips = 1;
			bp.ticks[Boost.AEGIS] = 600;
		});
		expect([aegis.s.drops!.players[SOLO_PLAYER].aegisPips, T(aegis).status]).toEqual([0, VaultStatus.CRACKED]);
	});

	it("i-framed and god-mode hits do not land and do not count", () => {
		const iframes = vaultRun(VaultLock.UNTOUCHED);
		enter(iframes);
		hurt(iframes, 3, 0, (s) => (s.player.iframeTicks = 10));
		expect([iframes.s.score!.hitsTaken - rec(iframes).hitsAtEngage, T(iframes).status]).toEqual([
			0,
			VaultStatus.ARMED,
		]);
		const god = vaultRun(VaultLock.UNTOUCHED, { extra: { dev: { invulnerable: true } } });
		enter(god);
		hurt(god, 3);
		expect([god.s.dev!.blockedHits, T(god).status]).toEqual([3, VaultStatus.ARMED]);
	});
});

describe("treasure lock: SWIFT (step 2)", () => {
	it("counts down from the tick after arming and cracks exactly at E + S; then stops counting", () => {
		const r = vaultRun(VaultLock.SWIFT, { tier: VaultTier.LEGENDARY });
		enter(r);
		const t = T(r);
		const E = t.armTick;
		const S = t.ticksLeft;
		expect(S).toBe(rec(r).parTicks);
		quietUntil(r, E + S); // ticks E + 1 .. E + S - 1 have run
		expect([t.status, t.ticksLeft]).toEqual([VaultStatus.ARMED, 1]);
		quiet(r); // tick E + S
		expect([t.status, t.ticksLeft, t.crackTick, t.tier, t.events.cracked]).toEqual([
			VaultStatus.CRACKED,
			0,
			E + S,
			VaultTier.RARE,
			1,
		]);
		quiet(r);
		quiet(r);
		expect([t.ticksLeft, t.crackTick, t.tier]).toEqual([0, E + S, VaultTier.RARE]);
	});

	it("agrees with FAST at 100 %: kept iff the clear beats par (T - E < S); spare = FAST's ticks under, missBy the ticks over", () => {
		// Clear offsets from the arm tick: absolute (1, 30), then relative to S (S - 1, S, S + 1, S + 7).
		const cases: Array<[number, boolean]> = [
			[1, false],
			[30, false],
			[-1, true],
			[0, true],
			[1, true],
			[7, true],
		];
		for (const [offset, fromS] of cases) {
			const r = vaultRun(VaultLock.SWIFT);
			enter(r);
			const t = T(r);
			const E = t.armTick;
			const S = t.ticksLeft;
			const d = fromS ? S + offset : offset;
			const sc = r.s.score!;
			const fast0 = sc.counts[ScoreSource.FAST];
			const fastPts0 = sc.points[ScoreSource.FAST];
			quietUntil(r, E + d);
			killRoom(r);
			quiet(r); // tick E + d: the record clears
			expect(rec(r).cleared).toBe(1);
			const fast = sc.counts[ScoreSource.FAST] - fast0 > 0;
			const kept = t.crackTick === TREASURE_UNSET;
			expect([d, t.status, kept, kept === d < S]).toEqual([d, VaultStatus.UNLOCKED, fast, true]);
			if (kept) {
				expect([t.spare, t.missBy]).toEqual([S - d, TREASURE_UNSET]);
				// FAST pays its ticks under par through the clear tick's multipliers (combo, Depth, curses).
				expect(sc.points[ScoreSource.FAST] - fastPts0).toBe(awardPoints(r.s, sc, S - d));
			} else expect([t.spare, t.missBy, t.crackTick]).toEqual([TREASURE_UNSET, d - S, E + S]);
		}
	});

	it("a draft holds the countdown (a synthetic draft: in play drafts only open on a floor change)", () => {
		const r = vaultRun(VaultLock.SWIFT);
		enter(r);
		const t = T(r);
		tick(r);
		const left = t.ticksLeft;
		expect(openDraft(r.s, SOLO_PLAYER, 1)).toBe(true);
		const tick0 = r.s.tick;
		for (let k = 0; k < 90; k++) tick(r);
		expect([r.s.tick - tick0, t.ticksLeft, t.status]).toEqual([90, left, VaultStatus.ARMED]);
		closeDraft(r.s.run!.players[SOLO_PLAYER]);
		tick(r);
		expect(t.ticksLeft).toBe(left - 1);
	});
});

describe("treasure lock: the clear (step 3)", () => {
	it("UNTOUCHED kept: UNLOCKED, spare = hits unused (party of 3, one hit: 1); events.unlocked", () => {
		const r = vaultRun(VaultLock.UNTOUCHED, { party: 3 });
		enter(r);
		hurt(r);
		killRoom(r);
		quiet(r);
		const t = T(r);
		expect([t.status, t.tier, t.spare, t.missBy, t.events.unlocked]).toEqual([
			VaultStatus.UNLOCKED,
			VaultTier.RARE,
			1,
			TREASURE_UNSET,
			1,
		]);
	});

	it("UNTOUCHED cracked: missBy = hits over the allowance (party of 3, four hits: 2)", () => {
		const r = vaultRun(VaultLock.UNTOUCHED, { party: 3 });
		enter(r);
		hurt(r, 4);
		killRoom(r);
		quiet(r);
		const t = T(r);
		expect([t.status, t.tier, t.missBy, t.spare]).toEqual([
			VaultStatus.UNLOCKED,
			VaultTier.COMMON,
			2,
			TREASURE_UNSET,
		]);
	});

	it("a cracking hit on the clear tick cracks (no PERFECT either): missBy 1", () => {
		const r = vaultRun(VaultLock.UNTOUCHED);
		enter(r);
		const perfect0 = r.s.score!.counts[ScoreSource.PERFECT];
		killRoom(r);
		hurt(r); // the clear tick, with a hit
		const t = T(r);
		expect(rec(r).cleared).toBe(1);
		expect(r.s.score!.counts[ScoreSource.PERFECT]).toBe(perfect0);
		expect([t.status, t.tier, t.crackTick, t.missBy, t.events.cracked, t.events.unlocked]).toEqual([
			VaultStatus.UNLOCKED,
			VaultTier.COMMON,
			r.s.tick - 1,
			1,
			1,
			1,
		]);
	});

	it("an adopted child keeps the room, and the chest, shut until it is down", () => {
		const r = vaultRun(VaultLock.SWIFT);
		enter(r);
		const parent = liveMembers(r)[0];
		const ctx = new SimCtx().bind(r.s, simWorldConfig(r.s, r.config), EMPTY_INPUT);
		const child = ctx.spawnActor("slime.small", parent.x, parent.z)!;
		adoptScoreRoomMember(r.s, parent, child);
		killRoom(r, child);
		quiet(r);
		expect([scoreRoomDown(r.s, rec(r)), rec(r).cleared, T(r).status]).toEqual([false, 0, VaultStatus.ARMED]);
		ctx.killActor(child);
		quiet(r);
		expect([rec(r).cleared, T(r).status]).toEqual([1, VaultStatus.UNLOCKED]);
	});

	it("a real slime's split: its children are adopted, and the chest unlocks only after them", () => {
		// Find a vault room (seeds 1-30, floors 4-9, lock UNTOUCHED) whose planned spawns hold a slime.
		let found: Run | undefined;
		for (let seed = 1; seed <= 30 && found === undefined; seed++) {
			const setup = buildVaultRunConfig(seed, 1, { override: { every: true }, treasure: false });
			for (let floor = 4; floor <= 9 && found === undefined; floor++) {
				const v = setup.endlessFloor(floor).vault;
				if (v === undefined) continue;
				const spawns = setup.endlessFloor(floor).roomSpawns[v.room];
				if (spawns.some((a) => a.kind === "slime")) found = vaultRun(VaultLock.UNTOUCHED, { seed, floor });
			}
		}
		expect(found).never.toBe(undefined);
		const r = found!;
		enter(r);
		const ctx = new SimCtx().bind(r.s, simWorldConfig(r.s, r.config), EMPTY_INPUT);
		const members0 = rec(r).memberSlots.size();
		for (const a of liveMembers(r)) if (a.kind !== NO_KIND && a.alive !== 0) ctx.killActor(a);
		expect(rec(r).memberSlots.size() > members0).toBe(true); // the split's children joined
		quiet(r);
		expect([rec(r).cleared, T(r).status]).toEqual([0, VaultStatus.ARMED]);
		killRoom(r);
		quiet(r);
		expect([rec(r).cleared, T(r).status, T(r).spare]).toEqual([1, VaultStatus.UNLOCKED, 0]);
	});

	it("UNLOCKED stays UNLOCKED while nobody living is in reach; the first tick someone is, it opens", () => {
		const r = vaultRun(VaultLock.UNTOUCHED);
		enter(r);
		killRoom(r);
		tick(r);
		const t = T(r);
		expect(t.status).toBe(VaultStatus.UNLOCKED);
		const spare = t.spare;
		for (let k = 0; k < 120; k++) {
			tick(r);
			expect([t.events.armed, t.events.cracked, t.events.unlocked, t.events.opened === undefined]).toEqual([
				0,
				0,
				0,
				true,
			]);
		}
		expect([t.status, t.opened, t.spare]).toEqual([VaultStatus.UNLOCKED, 0, spare]);
		r.s.player.x = t.x + t.fx;
		r.s.player.z = t.z + t.fz;
		tick(r);
		expect([t.status, t.opened, t.events.opened !== undefined]).toEqual([VaultStatus.OPENED, 1, true]);
	});
});

describe("treasure lock: Respite (TRD10, dormant) and the floor change", () => {
	it("the pure helpers at every level (clamped past the table); the accessor is 0 until Respite exists", () => {
		const c = ENDLESS_TREASURE_CONFIG;
		expect([0, 1, 2, 3, 9].map((l) => vaultAllowance(1, l, c))).toEqual([0, 0, 1, 1, 1]);
		expect([0, 1, 2, 3].map((l) => vaultAllowance(3, l, c))).toEqual([2, 2, 3, 3]);
		expect([0, 1, 2, 3].map((l) => swiftTicks(600, l, c))).toEqual([600, 660, 720, 780]);
		expect(swiftTicks(455, 1, c)).toBe(501); // 500.5, round half up
		expect(swiftTicks(455, 0, c)).toBe(455);
		const r = vaultRun(VaultLock.SWIFT);
		expect([TREASURE_RESPITE_NONE, treasureRespiteLevel(r.s)]).toEqual([0, 0]);
	});

	it("a floor change drops a sealed or an armed vault silently (the next floor's is SEALED)", () => {
		for (const armed of [false, true]) {
			const r = vaultRun(VaultLock.SWIFT);
			if (armed) enter(r);
			skipFloor(r);
			const plan = r.setup.endlessFloor(3).vault!;
			const t = T(r);
			expect([t.status, t.room, t.armTick, t.ticksLeft]).toEqual([
				VaultStatus.SEALED,
				plan.room,
				TREASURE_UNSET,
				TREASURE_UNSET,
			]);
		}
	});

	it("events are not hashed; the lock is", () => {
		const r = vaultRun(VaultLock.UNTOUCHED);
		enter(r);
		const t = T(r);
		const h = hashState(r.s);
		t.events.armed = 0;
		t.events.cracked = 1;
		t.events.unlocked = 1;
		expect(hashState(r.s)).toBe(h);
		t.status = VaultStatus.CRACKED;
		expect(hashState(r.s)).never.toBe(h);
	});
});
