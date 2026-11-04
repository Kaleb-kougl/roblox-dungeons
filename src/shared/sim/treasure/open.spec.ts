// The open and its rewards (docs/TREASURE.md TR4 Verify, Design §2 step 4): the first living player in index order within
// reach opens an unlocked chest for the party, never the dead; every living present player gets their own grants per
// tier (party 1-4); a relic pool with nothing left gives boosts; without builds a Legendary gives a relic; a Legendary's
// bonus deal deals one extra round with a guaranteed duo on the next floor (three deals after a boss floor); boosts land
// at the offsets in front of the chest in the lowest free slots, and what doesn't fit goes straight to its player (owner
// answer C1); the draws are fixed per case on the treasure stream, so state.rngState, drops.rngState and killsSinceDrop
// stay identical to a twin run without treasure up to the first open (and the open itself touches neither stream);
// TREASURE points once per open, combo-neutral; the run counters and treasureRunSummary.
//
// Worlds: real endless floors with forced vaults (shared/run/testing buildVaultRunConfig, the dev override), seed 4242.
// Test-only surgery as in stepTreasure.spec.ts: players unhittable between ticks, `quiet` ticks (score and treasure
// passes only), members killed through SimCtx, teleports.
import { describe, expect, it } from "@rbxts/jest-globals";
import "shared/sim/testing";
import { TileType, VaultLock, VaultTier, isBossFloor, roomIdAt, tileAt, worldToGrid } from "shared/dungeon";
import {
	BOOST_COUNT,
	Boost,
	Button,
	DEBUG_FLOOR_BUTTON,
	DRAFT_CONFIRM_BUTTON,
	DRAFT_MIN_OPEN_TICKS,
	DUOS,
	EMPTY_INPUT,
	GIVEN_DROP_SLOT,
	NO_BOOST,
	NO_KIND,
	RELIC_COUNT,
	ScoreSource,
	SimCtx,
	TREASURE,
	TREASURE_UNSET,
	VaultStatus,
	boostTicks,
	buildPlayer,
	cardDuo,
	clearEvents,
	clearScoreEvents,
	clearTreasureEvents,
	cloneSimState,
	createSimState,
	damagePlayer,
	grantCard,
	grantRelic,
	hashState,
	isDraftOpen,
	landDrop,
	partySize,
	pickBoostKind,
	playerAt,
	rngInt,
	simWorldConfig,
	step,
	stepParty,
	stepScore,
	stepTreasure,
	takeTreasureBonusDeals,
	treasureAwardPoints,
	treasureRunSummary,
	unownedRelics,
	type ActorState,
	type InputFrame,
	type RoomScore,
	type SimConfig,
	type SimState,
	type TreasureOpened,
	type TreasureState,
} from "shared/sim";
import { buildVaultRunConfig, dismissDraft, frame, type VaultRunOptions } from "shared/run/testing";
import type { EndlessRunSetup } from "shared/run";

const SEED = 4242;
const UNHITTABLE = 1e6;
/** Forward cells from the chest's centre: in reach (1) and out of it (2; both FLOOR, VAULT.wallClearTiles). */
const IN_REACH = 1;
const OUT_OF_REACH = 2;

interface Run {
	readonly setup: EndlessRunSetup;
	readonly config: SimConfig;
	readonly s: SimState;
}

interface RunOptions {
	readonly tier?: number;
	readonly lock?: number;
	readonly party?: number;
	readonly floor?: number;
	readonly seed?: number;
	readonly extra?: Partial<SimConfig>;
	readonly vault?: VaultRunOptions;
	/** No SimConfig.builds (an object spread cannot drop a key: it skips nil values). */
	readonly noBuilds?: boolean;
}

type MutableConfig = { -readonly [K in keyof SimConfig]: SimConfig[K] };

function vaultRun(o: RunOptions = {}): Run {
	const seed = o.seed ?? SEED;
	const setup = buildVaultRunConfig(seed, o.party ?? 1, {
		override: { every: true, lock: o.lock ?? VaultLock.UNTOUCHED, tier: o.tier ?? VaultTier.RARE },
		startFloor: o.floor ?? 2,
		...o.vault,
	});
	const config: MutableConfig = { ...setup.config, ...o.extra };
	if (o.noBuilds === true) config.builds = undefined;
	const s = createSimState(seed, setup.spawn!.x, setup.spawn!.z, config);
	guard(s);
	return { setup, config, s };
}

function guard(s: SimState): void {
	for (let i = 0; i < partySize(s); i++) {
		const p = playerAt(s, i);
		p.hurtTicks = UNHITTABLE;
		if (p.dead === 0) p.hearts = p.heartsMax;
	}
}

const T = (r: Run): TreasureState => r.s.treasure!;
const rec = (r: Run): RoomScore => r.s.score!.rooms[T(r).record];

function tick(r: Run, input: InputFrame = EMPTY_INPUT): void {
	if (r.s.party === undefined) step(r.s, input, r.config);
	else {
		const frames: InputFrame[] = [];
		for (let i = 0; i < r.s.party.size; i++) frames.push(i === 0 ? input : EMPTY_INPUT);
		stepParty(r.s, frames, r.config);
	}
	guard(r.s);
}

/** A tick of the score and treasure passes only, `during` its hooks. */
function quiet(r: Run, during?: () => void): void {
	const s = r.s;
	clearEvents(s.events);
	clearScoreEvents(s.score!);
	clearTreasureEvents(T(r));
	if (s.drops !== undefined) {
		const e = s.drops.events;
		e.dropped.clear();
		e.collected.clear();
		e.fromChest.clear();
	}
	if (during !== undefined) during();
	stepScore(s);
	stepTreasure(s);
	s.tick += 1;
}

/** Player `i` `cells` cells in front of the chest (side offset `side` tiles across it); `t`: whose chest (default r's). */
function place(r: Run, i: number, cells: number, side = 0, t: TreasureState = T(r)): void {
	const p = playerAt(r.s, i);
	p.x = t.x + t.fx * cells - t.fz * side;
	p.z = t.z + t.fz * cells + t.fx * side;
}

/** Every player out of reach. */
function away(r: Run): void {
	for (let i = 0; i < partySize(r.s); i++) place(r, i, OUT_OF_REACH);
}

/** Player 0 into the room (it engages), then everyone out of reach. */
function enter(r: Run): void {
	place(r, 0, IN_REACH);
	tick(r);
	expect(rec(r).engageTick).toBe(r.s.tick - 1);
	away(r);
}

function liveMembers(r: Run, t: TreasureState = T(r)): ActorState[] {
	const s = r.s;
	const out: ActorState[] = [];
	const room = s.score!.rooms[t.record];
	for (let k = 0; k < room.memberSlots.size(); k++) {
		const a: ActorState | undefined = s.combat.actors[room.memberSlots[k]];
		if (a !== undefined && a.kind !== NO_KIND && a.id === room.memberIds[k] && a.alive !== 0) out.push(a);
	}
	return out;
}

function killRoom(r: Run, t: TreasureState = T(r)): void {
	const ctx = new SimCtx().bind(r.s, simWorldConfig(r.s, r.config), EMPTY_INPUT);
	for (let pass = 0; pass < 8; pass++) {
		const live = liveMembers(r, t);
		if (live.size() === 0) return;
		for (const a of live) if (a.alive !== 0) ctx.killActor(a);
	}
	error("killRoom: members kept coming back", 0);
}

/** `n` landed hits on player `i` in a quiet tick (the lock cracks when they pass the allowance). */
function hurt(r: Run, n: number, i = 0): void {
	quiet(r, () => {
		for (let k = 0; k < n; k++) {
			const p = playerAt(r.s, i);
			p.hurtTicks = 0;
			damagePlayer(r.s, 1, p, i);
			p.hurtTicks = UNHITTABLE;
			p.hearts = p.heartsMax;
		}
	});
}

/** Enter, (crack with `hits`), clear: the chest UNLOCKED with nobody in reach. */
function unlock(r: Run, hits = 0): void {
	enter(r);
	if (hits > 0) hurt(r, hits);
	killRoom(r);
	quiet(r);
	expect(T(r).status).toBe(VaultStatus.UNLOCKED);
}

/** Player `i` steps into reach; one quiet tick: the open (returns its event). */
function open(r: Run, i = 0): TreasureOpened {
	place(r, i, IN_REACH);
	quiet(r);
	const e = T(r).events.opened;
	expect([T(r).status, e !== undefined]).toEqual([VaultStatus.OPENED, true]);
	return e!;
}

/** The treasure word after `n` draws from `word`. */
function afterDraws(word: number, n: number): number {
	const h = { rngState: word };
	for (let k = 0; k < n; k++) rngInt(h, 0, 1);
	return h.rngState;
}

/** The boost kinds `n` draws from `word` give (pickBoostKind on a copy). */
function kindsFrom(word: number, n: number): number[] {
	const h = { rngState: word };
	const out: number[] = [];
	for (let k = 0; k < n; k++) out.push(pickBoostKind(h));
	return out;
}

function fillGround(r: Run, slots: number): void {
	const d = r.s.drops!;
	for (let k = 0; k < slots; k++) landDrop(d, k, Boost.FURY, 0, 0, r.s.tick);
}

describe("treasure open: who opens it (step 4)", () => {
	it("the first living player in index order within reach; the dead never open, and get nothing", () => {
		const r = vaultRun({ party: 2, tier: VaultTier.LEGENDARY });
		unlock(r);
		// Both in reach: player 0 opens.
		const both = cloneSimState(r.s);
		const rb: Run = { ...r, s: both };
		place(rb, 1, IN_REACH, 0.3);
		expect(open(rb, 0).opener).toBe(0);
		// Player 0 dead in reach: nothing; player 1 steps in: they open, and only they get a share.
		const p0 = r.s.player;
		p0.dead = 1;
		p0.hearts = 0;
		place(r, 0, IN_REACH);
		for (let k = 0; k < 30; k++) quiet(r);
		expect([T(r).status, T(r).events.opened === undefined]).toEqual([VaultStatus.UNLOCKED, true]);
		const e = open(r, 1);
		expect([e.opener, e.grants.size(), e.grants[0].player]).toEqual([1, 1, 1]);
		expect(T(r).bonusDeals).toEqual([0, 1]);
	});

	it("reach is config.reachTiles from the chest's centre", () => {
		const r = vaultRun();
		unlock(r);
		const t = T(r);
		const reach = t.config.reachTiles;
		place(r, 0, reach + 0.01);
		quiet(r);
		expect(t.status).toBe(VaultStatus.UNLOCKED);
		place(r, 0, reach);
		quiet(r);
		expect(t.status).toBe(VaultStatus.OPENED);
	});

	it("an unlock and an open on the same tick: standing in reach at the clear", () => {
		const r = vaultRun();
		enter(r);
		killRoom(r);
		place(r, 0, IN_REACH);
		quiet(r);
		expect([T(r).events.unlocked, T(r).status, T(r).opened]).toEqual([1, VaultStatus.OPENED, 1]);
	});
});

describe("treasure open: the grants per tier (party 1-4)", () => {
	it("Common (a cracked Rare): two boosts each, two draws each", () => {
		for (const n of [1, 2, 3, 4]) {
			const r = vaultRun({ party: n });
			unlock(r, n); // allowance n - 1: n hits crack it
			const t = T(r);
			expect(t.tier).toBe(VaultTier.COMMON);
			const word = t.rngState;
			const e = open(r);
			expect(e.grants.size()).toBe(n);
			const all: number[] = [];
			for (let i = 0; i < n; i++) {
				const g = e.grants[i];
				expect([g.player, g.relic, g.bonusDeal, g.boosts.size()]).toEqual([i, TREASURE_UNSET, 0, 2]);
				for (const k of g.boosts) all.push(k);
			}
			expect(all).toEqual(kindsFrom(word, 2 * n));
			expect(t.rngState).toBe(afterDraws(word, 2 * n));
		}
	});

	it("Rare: one relic each from that player's own unowned pool, one draw each; no boosts", () => {
		for (const n of [1, 2, 3, 4]) {
			const r = vaultRun({ party: n });
			// Player 1 already owns relic 0: their pool is smaller, so draws differ per player.
			if (n > 1) grantRelic(r.s, 1, 0);
			unlock(r);
			const t = T(r);
			const word = t.rngState;
			const pools: number[][] = [];
			for (let i = 0; i < n; i++) pools.push(unownedRelics(r.s, i));
			const e = open(r);
			const h = { rngState: word };
			for (let i = 0; i < n; i++) {
				const g = e.grants[i];
				const want = pools[i][rngInt(h, 0, pools[i].size() - 1)];
				expect([g.player, g.relic, g.bonusDeal, g.boosts.size()]).toEqual([i, want, 0, 0]);
				expect(r.s.run!.players[i].relics.includes(want)).toBe(true);
			}
			expect(t.rngState).toBe(h.rngState);
			// No relicCollected run event (TR0 correction 14): the chest's own event carries the grants.
			expect(r.s.run!.events.relicCollected).toBe(0);
		}
	});

	it("Legendary (builds): a bonus deal and one boost each, one draw each", () => {
		for (const n of [1, 2, 3, 4]) {
			const r = vaultRun({ party: n, tier: VaultTier.LEGENDARY });
			unlock(r);
			const t = T(r);
			const word = t.rngState;
			const e = open(r);
			const all: number[] = [];
			for (let i = 0; i < n; i++) {
				const g = e.grants[i];
				expect([g.player, g.relic, g.bonusDeal, g.boosts.size()]).toEqual([i, TREASURE_UNSET, 1, 1]);
				all.push(g.boosts[0]);
			}
			expect(all).toEqual(kindsFrom(word, n));
			expect(t.rngState).toBe(afterDraws(word, n));
			const deals: number[] = [];
			for (let i = 0; i < n; i++) deals.push(1);
			expect(t.bonusDeals).toEqual(deals);
		}
	});

	it("a relic pool with nothing left gives relicFallbackBoosts (2) boosts instead", () => {
		const r = vaultRun({ party: 2 });
		for (let k = 0; k < RELIC_COUNT; k++) grantRelic(r.s, 1, k);
		unlock(r);
		const word = T(r).rngState;
		const e = open(r);
		expect(T(r).config.relicFallbackBoosts).toBe(2);
		expect([e.grants[0].relic !== TREASURE_UNSET, e.grants[0].boosts.size()]).toEqual([true, 0]);
		expect([e.grants[1].relic, e.grants[1].boosts.size()]).toEqual([TREASURE_UNSET, 2]);
		expect(T(r).rngState).toBe(afterDraws(word, 3));
	});

	it("without builds a Legendary gives a relic (as Rare) and its boost; no bonus deal", () => {
		const r = vaultRun({ tier: VaultTier.LEGENDARY, noBuilds: true });
		expect(r.s.builds).toBe(undefined);
		unlock(r);
		const word = T(r).rngState;
		const e = open(r);
		const g = e.grants[0];
		expect([g.relic !== TREASURE_UNSET, g.bonusDeal, g.boosts.size()]).toEqual([true, 0, 1]);
		expect(T(r).bonusDeals).toEqual([0]);
		expect(T(r).rngState).toBe(afterDraws(word, 2));
	});
});

describe("treasure open: the Legendary bonus deal", () => {
	/** Player 0 owns both boons of DUOS[0], so a duo is available. */
	function duoReady(r: Run): void {
		grantCard(r.s, 0, DUOS[0].a);
		grantCard(r.s, 0, DUOS[0].b);
	}

	function nextFloor(r: Run): void {
		tick(r, { ...EMPTY_INPUT, buttons: DEBUG_FLOOR_BUTTON });
		expect(isDraftOpen(r.s)).toBe(true);
	}

	it("the next floor's draft deals one extra round, its first deal's card 0 a duo; taken once", () => {
		const plain = vaultRun({ tier: VaultTier.LEGENDARY });
		duoReady(plain);
		nextFloor(plain);
		expect(buildPlayer(plain.s, 0)!.draftsLeft).toBe(1); // no bonus: today's deals
		const r = vaultRun({ tier: VaultTier.LEGENDARY });
		duoReady(r);
		unlock(r);
		open(r);
		expect(T(r).bonusDeals).toEqual([1]);
		nextFloor(r);
		const p = r.s.run!.players[0];
		expect([T(r).bonusDeals[0], buildPlayer(r.s, 0)!.draftsLeft]).toEqual([0, 2]);
		expect(cardDuo(p.draftOffers[0]) >= 0).toBe(true);
		// The confirm re-deals (the boss double draft's path), then the draft closes.
		const confirm = (): void => {
			while (p.draftTicks < DRAFT_MIN_OPEN_TICKS) tick(r);
			tick(r, { ...EMPTY_INPUT, buttons: DRAFT_CONFIRM_BUTTON });
		};
		confirm();
		expect([p.draftOpen, buildPlayer(r.s, 0)!.draftsLeft]).toEqual([1, 1]);
		confirm();
		expect([p.draftOpen, isDraftOpen(r.s)]).toEqual([0, false]);
		expect(takeTreasureBonusDeals(r.s, 0)).toBe(0);
	});

	it("after a boss floor: three deals (the double draft plus one), one guaranteed duo", () => {
		const floor = 5;
		expect(isBossFloor(floor)).toBe(true);
		const r = vaultRun({ tier: VaultTier.LEGENDARY, floor });
		expect(r.setup.endlessFloor(floor).vault).never.toBe(undefined);
		duoReady(r);
		unlock(r);
		open(r);
		nextFloor(r);
		expect(buildPlayer(r.s, 0)!.draftsLeft).toBe(3);
		expect(cardDuo(r.s.run!.players[0].draftOffers[0]) >= 0).toBe(true);
	});
});

describe("treasure open: where the boosts land (C1)", () => {
	it("an empty ground: the lowest free slots, at TREASURE.boostOffsets in order, FLOOR of the room in front", () => {
		const r = vaultRun({ party: 2 });
		unlock(r, 2); // Common: 4 boosts, 4 slots
		const t = T(r);
		const d = r.s.drops!;
		const e = open(r);
		expect(d.events.fromChest).toEqual([0, 1, 2, 3]);
		expect([e.grants[0].slots, e.grants[1].slots]).toEqual([
			[0, 1],
			[2, 3],
		]);
		const world = r.setup.endlessFloor(r.s.endless!.floor);
		for (let k = 0; k < 4; k++) {
			const g = d.ground[k];
			const o = TREASURE.boostOffsets[k];
			expect([g.kind, g.x, g.z, g.spawnTick]).toEqual([
				k < 2 ? e.grants[0].boosts[k] : e.grants[1].boosts[k - 2],
				t.x + t.fx * o.forward - t.fz * o.side,
				t.z + t.fz * o.forward + t.fx * o.side,
				r.s.tick - 1,
			]);
			expect((g.x - t.x) * t.fx + (g.z - t.z) * t.fz > 0.5).toBe(true);
			expect(tileAt(world.dungeon, worldToGrid(g.x), worldToGrid(g.z))).toBe(TileType.FLOOR);
			expect(roomIdAt(world.dungeon, g.x, g.z)).toBe(t.room);
		}
	});

	it("a full ground: what doesn't fit goes straight to the player whose share it is; the draws don't change", () => {
		const free = vaultRun();
		unlock(free, 1);
		const freeOpen = open(free);
		const r = vaultRun();
		unlock(r, 1);
		fillGround(r, 3); // one slot left for a Common's two boosts
		const d = r.s.drops!;
		const e = open(r);
		const g = e.grants[0];
		expect(g.boosts).toEqual(freeOpen.grants[0].boosts);
		expect(T(r).rngState).toBe(T(free).rngState);
		expect(g.slots).toEqual([3, GIVEN_DROP_SLOT]);
		const o = TREASURE.boostOffsets[0];
		expect([d.ground[3].x, d.ground[3].z]).toEqual([
			T(r).x + T(r).fx * o.forward - T(r).fz * o.side,
			T(r).z + T(r).fz * o.forward + T(r).fx * o.side,
		]);
		const given = g.boosts[1];
		const c = d.events.collected;
		expect([c.size(), c[0].player, c[0].kind, c[0].slot, c[0].x, c[0].z]).toEqual([
			1,
			0,
			given,
			GIVEN_DROP_SLOT,
			r.s.player.x,
			r.s.player.z,
		]);
		expect(d.players[0].ticks[given]).toBe(boostTicks(given));
		expect(d.events.fromChest).toEqual([3]);
	});

	it("every slot taken: each boost given to its own player (Aegis with its pip)", () => {
		const r = vaultRun({ party: 3 });
		unlock(r, 3);
		fillGround(r, 4);
		const d = r.s.drops!;
		const e = open(r);
		expect(d.events.fromChest).toEqual([]);
		let seen = 0;
		for (const g of e.grants) {
			expect(g.slots).toEqual([GIVEN_DROP_SLOT, GIVEN_DROP_SLOT]);
			for (const k of g.boosts) {
				const c = d.events.collected[seen++];
				expect([c.player, c.kind, c.slot]).toEqual([g.player, k, GIVEN_DROP_SLOT]);
				expect(d.players[g.player].ticks[k]).toBe(boostTicks(k));
				if (k === Boost.AEGIS) expect(d.players[g.player].aegisPips).toBe(1);
			}
		}
		expect(seen).toBe(6);
		for (const g of d.ground) expect(g.kind).toBe(Boost.FURY); // the ground untouched
	});

	it("landed boosts are ordinary ground drops: picked up first-touch next tick", () => {
		const r = vaultRun();
		unlock(r, 1);
		open(r);
		const d = r.s.drops!;
		const slot = d.events.fromChest[0];
		const g = d.ground[slot];
		const kind = g.kind;
		expect(kind !== NO_BOOST && kind < BOOST_COUNT).toBe(true);
		r.s.player.x = g.x;
		r.s.player.z = g.z;
		tick(r);
		expect(d.ground[slot].kind).toBe(NO_BOOST);
		expect(d.players[0].ticks[kind] > 0).toBe(true);
	});
});

describe("treasure open: streams, score, counters, events", () => {
	it("state.rngState, drops.rngState and killsSinceDrop match a twin run without treasure up to the first open, and through it", () => {
		for (const [seed, tier, lock] of [
			[SEED, VaultTier.RARE, VaultLock.UNTOUCHED],
			[7, VaultTier.LEGENDARY, VaultLock.SWIFT],
			[31, VaultTier.RARE, VaultLock.SWIFT],
		] as const) {
			const a = vaultRun({ seed, tier, lock });
			const b = vaultRun({ seed, tier, lock, vault: { treasure: false } });
			expect([a.s.treasure !== undefined, b.s.treasure]).toEqual([true, undefined]);
			const same = (): void => {
				expect([a.s.tick, a.s.rngState, a.s.drops!.rngState, a.s.drops!.killsSinceDrop]).toEqual([
					b.s.tick,
					b.s.rngState,
					b.s.drops!.rngState,
					b.s.drops!.killsSinceDrop,
				]);
			};
			const both = (input: InputFrame = EMPTY_INPUT): void => {
				tick(a, input);
				tick(b, input);
				same();
			};
			// Walk in, fight with the sword for a while (enemies shoot, kills roll drops), then the rest die.
			const ta = T(a); // b has no treasure state: its chest is the same piece
			for (const r of [a, b]) place(r, 0, OUT_OF_REACH, 0, ta);
			both();
			for (let k = 0; k < 240; k++) {
				const live = liveMembers(a, ta);
				const p = a.s.player;
				const aim = live.size() > 0 ? live[0] : undefined;
				const ax = aim !== undefined ? aim.x - p.x : 0;
				const az = aim !== undefined ? aim.z - p.z : 1;
				const len = math.max(1e-6, math.sqrt(ax * ax + az * az));
				both(frame(0, 0, Button.FIRE, ax / len, az / len));
			}
			for (const r of [a, b]) {
				killRoom(r, ta);
				place(r, 0, OUT_OF_REACH, 0, ta);
			}
			both();
			// The fight may have carried the player into reach already (then it opened there); else it waits.
			const st = T(a).status;
			expect(st === VaultStatus.UNLOCKED || st === VaultStatus.OPENED).toBe(true);
			for (let k = 0; k < 20; k++) both();
			for (const r of [a, b]) place(r, 0, IN_REACH, 0, ta);
			both();
			expect([T(a).status, T(a).opened]).toEqual([VaultStatus.OPENED, 1]);
		}
	});

	it("TREASURE points once per open, combo-neutral: floor(points[tier] x Depth x (4 + curses) / 4)", () => {
		const r = vaultRun({ tier: VaultTier.LEGENDARY, floor: 7 });
		unlock(r);
		const sc = r.s.score!;
		sc.combo = 35; // x3.5: must not count
		sc.curses = 2;
		const before = sc.points[ScoreSource.TREASURE];
		const count = sc.counts[ScoreSource.TREASURE];
		const total = sc.total;
		const base = T(r).config.points[VaultTier.LEGENDARY];
		const want = treasureAwardPoints(r.s, sc, base);
		const e = open(r);
		expect(want).toBe(math.floor((base * r.s.endless!.depth * (4 + 2)) / 4));
		expect([e.points, sc.points[ScoreSource.TREASURE] - before, sc.counts[ScoreSource.TREASURE] - count]).toEqual([
			want,
			want,
			1,
		]);
		expect([sc.total - total, sc.combo]).toEqual([want, 35]);
		for (let k = 0; k < 10; k++) quiet(r);
		expect(sc.counts[ScoreSource.TREASURE] - count).toBe(1);
	});

	it("the run counters and treasureRunSummary: opened, kept, legendary; carried across floors", () => {
		const r = vaultRun({ tier: VaultTier.LEGENDARY });
		expect(treasureRunSummary(r.s)).toEqual({ opened: 0, kept: 0, legendary: 0 });
		unlock(r);
		const e = open(r);
		expect([e.kept, e.tier, e.startTier, e.lock, e.missBy, e.spare]).toEqual([
			1,
			VaultTier.LEGENDARY,
			VaultTier.LEGENDARY,
			VaultLock.UNTOUCHED,
			TREASURE_UNSET,
			0,
		]);
		expect(treasureRunSummary(r.s)).toEqual({ opened: 1, kept: 1, legendary: 1 });
		tick(r, { ...EMPTY_INPUT, buttons: DEBUG_FLOOR_BUTTON });
		dismissDraft(r.s);
		tick(r);
		expect(T(r).status).toBe(VaultStatus.SEALED);
		unlock(r, 1); // cracked: Legendary -> Rare
		const e2 = open(r);
		expect([e2.kept, e2.tier, e2.missBy]).toEqual([0, VaultTier.RARE, 1]);
		expect(treasureRunSummary(r.s)).toEqual({ opened: 2, kept: 1, legendary: 1 });
		const plain = vaultRun({ vault: { treasure: false } });
		expect(treasureRunSummary(plain.s)).toEqual({ opened: 0, kept: 0, legendary: 0 });
	});

	it("events.opened on its tick only, deep-cloned, not hashed; the open itself is", () => {
		const r = vaultRun();
		unlock(r);
		const pre = hashState(r.s);
		const e = open(r);
		const c = cloneSimState(r.s);
		const ce = c.treasure!.events.opened!;
		expect(ce).toEqual(e);
		expect(ce).never.toBe(e);
		expect(ce.grants[0]).never.toBe(e.grants[0]);
		expect(hashState(r.s)).never.toBe(pre);
		const h = hashState(r.s);
		T(r).events.opened = undefined;
		expect(hashState(r.s)).toBe(h);
		T(r).events.opened = e;
		quiet(r);
		expect(T(r).events.opened === undefined).toBe(true);
		expect(T(r).status).toBe(VaultStatus.OPENED);
	});
});
