// docs/NEW_ENEMIES_2.md NX3: the Chainhook (`chainhook`, band PORT_BAND_ENEMIES_3, index 20) and BulletKind.HOOK. The
// throw (0.7 s aim down a heading locked at its start, one HOOK bullet), the hook's rules (a rolling, i-framed or
// god-mode player is never latched; a sword guard erases it and counts a parry; a hook from a dead thrower or caught by
// a teammate latches nothing), the drag (pulled to pullStop, or for at most 0.6 s; walls and pools stop it and the
// player never ends inside one; broken by a roll, a pillar breaking sight, its death, 3 damage since the latch, the
// player's death), the yank (only after an arrival: a 0.3 s ring, then the 5-bullet fan), co-op (only the player it
// threw at is ever moved), the feed (hookLatched / hookBroken and CombatState.hookEvents), the reads of hashed state
// (hookedPlayerOf / chainhookHolderOf) and the draws (the first cooldown in init, one per throw, nothing else).
import "shared/sim/testing";
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	TileType,
	actorMover,
	bodyBlocker,
	bulletBlocker,
	circleOverlapsWall,
	gridToWorld,
	playerSlideMover,
	worldToGrid,
	type Dungeon,
} from "shared/dungeon";
import {
	AiState,
	Button,
	CHAINHOOK,
	CHAINHOOK_ATTACK_THROW,
	CHAINHOOK_ATTACK_YANK,
	CHAINHOOK_DIR_X,
	CHAINHOOK_DIR_Z,
	CHAINHOOK_DRAG,
	CHAINHOOK_HOOKED,
	CHAINHOOK_KEEP,
	CHAINHOOK_THROWN,
	CHAINHOOK_THROW_TARGET,
	DEFAULT_SIM_CONFIG,
	EMPTY_INPUT,
	HookEnd,
	PLAYER_RADIUS,
	PORT_BAND_ENEMIES_3,
	Rng,
	SimCtx,
	archetypeIndex,
	chainhookHolderOf,
	createSimState,
	damagePlayer,
	hashState,
	hookEndBreaks,
	hookedPlayerOf,
	partySize,
	playerAt,
	spawnActor,
	step,
	stepParty,
	type ActorState,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";

const KIND = archetypeIndex("chainhook");
const D = CHAINHOOK.data;

interface World {
	s: SimState;
	config: SimConfig;
}

/** An open world (the default config: no grid, every line of sight clear). */
function open(party = 1, extra: Partial<SimConfig> = {}): World {
	const config: SimConfig = {
		...DEFAULT_SIM_CONFIG,
		loadout: ["weapon.sword"],
		party: party > 1 ? { size: party } : undefined,
		...extra,
	};
	return { s: createSimState(11, 0, 0, config), config };
}

function ctxOf(w: World): SimCtx {
	return new SimCtx().bind(w.s, w.config, EMPTY_INPUT);
}

function put(s: SimState, i: number, x: number, z: number): void {
	const p = playerAt(s, i);
	p.x = x;
	p.z = z;
	p.prevX = x;
	p.prevZ = z;
}

/** A Chainhook at (x, z), stepping from this tick on, throwing as soon as it can (cooldown 0). */
function chainhook(w: World, x: number, z: number): ActorState {
	const a = spawnActor(ctxOf(w), KIND, x, z)!;
	a.spawnTick = -1;
	a.cooldown = 0;
	return a;
}

interface Tally {
	latches: number;
	breaks: number;
	latchPlayers: number[];
	latchSlots: number[];
	endPlayers: number[];
	endReasons: number[];
	hits: number;
	spawned: number;
	yanks: number;
	dragTicks: number;
}

function tally(): Tally {
	return {
		latches: 0,
		breaks: 0,
		latchPlayers: [],
		latchSlots: [],
		endPlayers: [],
		endReasons: [],
		hits: 0,
		spawned: 0,
		yanks: 0,
		dragTicks: 0,
	};
}

function collect(w: World, t: Tally, a?: ActorState): void {
	const s = w.s;
	const e = s.combat.hookEvents;
	expect(e.latchPlayer.size()).toBe(s.events.hookLatched);
	expect(e.latchSlot.size()).toBe(s.events.hookLatched);
	let breaks = 0;
	for (const r of e.endReason) if (hookEndBreaks(r)) breaks++;
	expect(breaks).toBe(s.events.hookBroken);
	t.latches += s.events.hookLatched;
	t.breaks += s.events.hookBroken;
	for (const k of e.latchPlayer) t.latchPlayers.push(k);
	for (const k of e.latchSlot) t.latchSlots.push(k);
	for (const k of e.endPlayer) t.endPlayers.push(k);
	for (const r of e.endReason) t.endReasons.push(r);
	t.hits += s.events.playerHits;
	if (a !== undefined) {
		if (a.aiState === CHAINHOOK_DRAG) t.dragTicks++;
		if (a.aiState === AiState.TELEGRAPH && a.attack === CHAINHOOK_ATTACK_YANK) t.yanks++;
	}
}

/** One tick for every player with `input` (solo: step; a party: stepParty). */
function tick(w: World, input: InputFrame = EMPTY_INPUT): void {
	if (w.s.party !== undefined) {
		const inputs: InputFrame[] = [];
		for (let i = 0; i < partySize(w.s); i++) inputs.push(input);
		stepParty(w.s, inputs, w.config);
	} else step(w.s, input, w.config);
}

function run(w: World, ticks: number, t: Tally, a?: ActorState, input: InputFrame = EMPTY_INPUT): void {
	for (let k = 0; k < ticks; k++) {
		const before = w.s.combat.enemySpawned;
		tick(w, input);
		t.spawned += w.s.combat.enemySpawned - before;
		collect(w, t, a);
	}
}

/** Steps until `pred` holds (at most `max` ticks); returns the ticks stepped. */
function stepUntil(w: World, t: Tally, a: ActorState, pred: () => boolean, max = 200, input = EMPTY_INPUT): number {
	for (let k = 1; k <= max; k++) {
		run(w, 1, t, a, input);
		if (pred()) return k;
	}
	error("stepUntil: never", 0);
}

function dist(a: ActorState, s: SimState, i = 0): number {
	const p = playerAt(s, i);
	const dx = p.x - a.x;
	const dz = p.z - a.z;
	return math.sqrt(dx * dx + dz * dz);
}

// ---------------------------------------------------------------------------------------------

describe("Chainhook: data", () => {
	it("band 6; the hook is one 0-damage HOOK bullet; the Design's numbers", () => {
		expect(CHAINHOOK.band).toBe(PORT_BAND_ENEMIES_3);
		expect([D.hook.count, D.hook.damage, D.hook.speed, D.hook.life]).toEqual([1, 0, 16, 0.5]);
		expect([D.aimTicks, D.dragMaxTicks, D.yankTelegraphTicks]).toEqual([42, 36, 18]);
		expect([D.pullSpeed, D.pullStop, D.breakDamage, D.throwRange]).toEqual([10, 1.3, 3, 8]);
		expect([D.yankFan.count, D.yankFan.spread]).toEqual([5, 0.7]);
	});
});

describe("Chainhook: the throw, the drag and the yank", () => {
	it("aims 0.7 s at a locked heading, throws, latches, drags to pullStop, then yanks after 0.3 s", () => {
		const w = open();
		const a = chainhook(w, 0, 5);
		const t = tally();
		run(w, 1, t, a);
		expect([a.aiState, a.attack, a.v[CHAINHOOK_DIR_X], a.v[CHAINHOOK_DIR_Z]]).toEqual([
			AiState.TELEGRAPH,
			CHAINHOOK_ATTACK_THROW,
			0,
			-1,
		]);
		// The heading stays locked while the player walks off the line.
		const aim = stepUntil(w, t, a, () => a.aiState === CHAINHOOK_THROWN, 100, { ...EMPTY_INPUT, moveX: 300 });
		expect(aim).toBe(D.aimTicks);
		expect([a.v[CHAINHOOK_DIR_X], a.v[CHAINHOOK_DIR_Z], t.spawned]).toEqual([0, -1, 1]);
		// The player walked 0.7 s sideways: back on the line for the catch.
		put(w.s, 0, 0, 0);
		stepUntil(w, t, a, () => a.aiState === CHAINHOOK_DRAG, 40);
		expect([t.latches, t.latchPlayers, t.latchSlots, t.hits]).toEqual([1, [0], [w.s.combat.actors.indexOf(a)], 0]);
		expect([hookedPlayerOf(a), chainhookHolderOf(w.s, 0), a.v[CHAINHOOK_HOOKED]]).toEqual([
			0,
			w.s.combat.actors.indexOf(a),
			1,
		]);
		const ax = a.x;
		const az = a.z;
		stepUntil(w, t, a, () => a.aiState !== CHAINHOOK_DRAG, 60);
		expect([a.x, a.z]).toEqual([ax, az]); // it stands still while dragging
		expect(dist(a, w.s)).toBeCloseTo(D.pullStop, 9);
		// 5 - 1.3 at 10 u/s: 23 drag ticks (the last one short), under 0.6 s. A tick's end shows the latch tick as DRAG
		// and the arrival tick as the yank, so the ticks seen in DRAG are the drag ticks.
		expect(t.dragTicks).toBe(math.ceil((5 - D.pullStop) / (D.pullSpeed / 60)));
		expect([t.endReasons, t.breaks, t.hits]).toEqual([[HookEnd.ARRIVED], 0, 0]);
		expect([a.aiState, a.attack, hookedPlayerOf(a), chainhookHolderOf(w.s, 0)]).toEqual([
			AiState.TELEGRAPH,
			CHAINHOOK_ATTACK_YANK,
			-1,
			-1,
		]);
		const spawnedBefore = t.spawned;
		const yank = stepUntil(w, t, a, () => a.aiState === CHAINHOOK_KEEP, 40);
		expect(yank).toBe(D.yankTelegraphTicks);
		expect(t.spawned - spawnedBefore).toBe(D.yankFan.count);
		run(w, 30, t, a);
		expect(t.hits).toBe(1); // the fan at the player standing at its feet
	});

	it("a drag that cannot reach pullStop ends after 0.6 s with no yank", () => {
		const w = open();
		const a = chainhook(w, 0, 7.9);
		const t = tally();
		stepUntil(w, t, a, () => a.aiState === CHAINHOOK_DRAG, 120);
		const latchDist = dist(a, w.s);
		stepUntil(w, t, a, () => a.aiState !== CHAINHOOK_DRAG, 60);
		expect(a.aiState).toBe(CHAINHOOK_KEEP);
		expect(dist(a, w.s)).toBeCloseTo(latchDist - (D.dragMaxTicks * D.pullSpeed) / 60, 9);
		run(w, 80, t, a);
		expect([t.latches, t.dragTicks, t.endReasons, t.yanks, t.spawned]).toEqual([
			1,
			D.dragMaxTicks,
			[HookEnd.TIMED_OUT],
			0,
			1,
		]);
	});
});

describe("Chainhook: the hook's rules", () => {
	it("a rolling player is never latched; a roll on the hook's arrival dodges it", () => {
		let dodged = 0;
		let caught = 0;
		for (let rollAt = 0; rollAt <= 24; rollAt++) {
			const w = open();
			const a = chainhook(w, 0, 6);
			const t = tally();
			stepUntil(w, t, a, () => a.aiState === CHAINHOOK_THROWN, 100);
			for (let k = 0; k < 40; k++) {
				// Roll toward the Chainhook: the body stays on the line, only the roll can dodge.
				const input: InputFrame = { ...EMPTY_INPUT, moveZ: 1000, buttons: k === rollAt ? Button.ROLL : 0 };
				const latchesBefore = t.latches;
				run(w, 1, t, a, k >= rollAt ? input : EMPTY_INPUT);
				if (t.latches > latchesBefore) {
					const p = playerAt(w.s, 0);
					expect([p.rollTicks, p.iframeTicks]).toEqual([0, 0]);
				}
				if (a.aiState !== CHAINHOOK_THROWN) break;
			}
			if (t.latches === 0) dodged++;
			else caught++;
		}
		expect(dodged > 0).toBe(true);
		expect(caught > 0).toBe(true);
	});

	it("post-hit invulnerability and dev god mode pass the hook through: no latch, the hook flies on", () => {
		for (const god of [false, true]) {
			const w = open(1, god ? { dev: { invulnerable: true } } : {});
			const a = chainhook(w, 0, 5);
			const t = tally();
			stepUntil(w, t, a, () => a.aiState === CHAINHOOK_THROWN, 100);
			if (!god) playerAt(w.s, 0).hurtTicks = 1e6;
			const blocked0 = w.s.dev?.blockedHits ?? 0;
			stepUntil(w, t, a, () => a.aiState === CHAINHOOK_KEEP, 60);
			expect([t.latches, t.hits]).toEqual([0, 0]);
			// The hook lived its whole 0.5 s (it was not consumed on the player).
			expect(t.dragTicks).toBe(0);
			expect(w.s.dev?.blockedHits ?? 0).toBe(blocked0); // god mode counts no blocked hit: the hook deals none
			expect([playerAt(w.s, 0).x, playerAt(w.s, 0).z]).toEqual([0, 0]);
		}
	});

	it("a sword guard erases the hook and counts it as a parry (guardCancels, the guard feed)", () => {
		const w = open(1, { scoring: {} });
		const a = chainhook(w, 0, 5);
		const t = tally();
		stepUntil(w, t, a, () => a.aiState === CHAINHOOK_THROWN, 100);
		const guard: InputFrame = { ...EMPTY_INPUT, aimX: 0, aimZ: 1000, buttons: Button.ALT };
		let cancels = 0;
		let fed = 0;
		for (let k = 0; k < 30; k++) {
			run(w, 1, t, a, k === 0 ? guard : { ...guard, buttons: 0 });
			cancels += w.s.score!.events.guardCancels;
			fed += w.s.score!.events.guardX.size();
		}
		expect([cancels, fed, t.latches, w.s.combat.enemyBullets.activeCount]).toEqual([1, 1, 0, 0]);
		expect(a.aiState).toBe(CHAINHOOK_KEEP);
	});

	it("a hook from a thrower killed in flight is consumed on the player and latches nothing", () => {
		const w = open();
		const a = chainhook(w, 0, 5);
		const t = tally();
		stepUntil(w, t, a, () => a.aiState === CHAINHOOK_THROWN, 100);
		ctxOf(w).killActor(a);
		run(w, 30, t, a);
		expect([t.latches, t.hits, t.endReasons]).toEqual([0, 0, []]);
		expect(w.s.combat.enemyBullets.activeCount).toBe(0);
		expect([playerAt(w.s, 0).x, playerAt(w.s, 0).z]).toEqual([0, 0]);
	});
});

describe("Chainhook: breaking the drag", () => {
	/** Solo, latched from (0, 6): returns the world, the Chainhook and the tally on the latch tick. */
	function latched(config: Partial<SimConfig> = {}): { w: World; a: ActorState; t: Tally } {
		const w = open(1, config);
		const a = chainhook(w, 0, 6);
		const t = tally();
		stepUntil(w, t, a, () => a.aiState === CHAINHOOK_DRAG, 120);
		run(w, 3, t, a); // three drag ticks
		return { w, a, t };
	}

	it("a roll breaks it at once", () => {
		const { w, a, t } = latched();
		const z0 = playerAt(w.s, 0).z;
		run(w, 1, t, a, { ...EMPTY_INPUT, moveX: 1000, buttons: Button.ROLL });
		expect([t.endReasons, t.breaks, a.aiState, hookedPlayerOf(a)]).toEqual([[HookEnd.ROLL], 1, CHAINHOOK_KEEP, -1]);
		expect(playerAt(w.s, 0).z).toBe(z0); // the roll moved it sideways; nothing pulled it
	});

	it("its death breaks it", () => {
		const { w, a, t } = latched();
		ctxOf(w).killActor(a);
		collect(w, t);
		const p = playerAt(w.s, 0);
		const z0 = p.z;
		run(w, 10, t, a);
		expect([t.endReasons, t.breaks, p.z, chainhookHolderOf(w.s, 0)]).toEqual([[HookEnd.DEATH], 1, z0, -1]);
	});

	it("3 damage since the latch breaks it (2 does not)", () => {
		const { w, a, t } = latched();
		ctxOf(w).damageActor(a, 1);
		ctxOf(w).damageActor(a, 1);
		expect(a.aiState).toBe(CHAINHOOK_DRAG);
		ctxOf(w).damageActor(a, 1);
		collect(w, t);
		expect([t.endReasons, t.breaks, a.aiState, a.hp]).toEqual([[HookEnd.DAMAGE], 1, CHAINHOOK_KEEP, D.hp - 3]);
	});

	it("the hooked player's death ends it", () => {
		const { w, a, t } = latched();
		const p = playerAt(w.s, 0);
		p.armor = 0;
		p.hurtTicks = 0;
		expect(damagePlayer(w.s, 100, p, 0)).toBe(true);
		expect(p.dead).toBe(1);
		run(w, 1, t, a);
		expect([t.endReasons, t.breaks, a.aiState]).toEqual([[HookEnd.PLAYER_DEAD], 1, CHAINHOOK_KEEP]);
	});
});

// ---------------------------------------------------------------------------------------------
// A walled floor (gx 1..18, gz 1..18 inside a wall ring), every test its own grid so it can raise a pillar.

const W = 20;
const H = 20;

function floorGrid(): Dungeon {
	const grid: number[] = [];
	for (let gz = 0; gz < H; gz++)
		for (let gx = 0; gx < W; gx++) {
			const inside = gx >= 1 && gx <= W - 2 && gz >= 1 && gz <= H - 2;
			grid.push(inside ? TileType.FLOOR : TileType.WALL);
		}
	return { W, H, grid } as unknown as Dungeon;
}

function setTile(d: Dungeon, gx: number, gz: number, t: number): void {
	(d.grid as number[])[gz * W + gx] = t;
}

function walled(d: Dungeon): World {
	return open(1, {
		moveResolver: playerSlideMover(d, PLAYER_RADIUS),
		actorMover: actorMover(d),
		isBulletBlocked: bulletBlocker(d),
		isBodyBlocked: bodyBlocker(d),
	});
}

describe("Chainhook: walls", () => {
	it("a pool between them stops the pull: the player never stands in it, the drag times out", () => {
		const d = floorGrid();
		for (let gx = 1; gx <= W - 2; gx++) setTile(d, gx, 9, TileType.POOL); // bullets and sight cross a pool
		const w = walled(d);
		const px = gridToWorld(10);
		put(w.s, 0, px, gridToWorld(6));
		const a = chainhook(w, px, gridToWorld(12));
		const body = bodyBlocker(d);
		const t = tally();
		for (let k = 0; k < 160; k++) {
			run(w, 1, t, a);
			const p = playerAt(w.s, 0);
			expect(body(p.x, p.z)).toBe(false);
			expect(circleOverlapsWall(d, p.x, p.z, PLAYER_RADIUS)).toBe(false);
		}
		expect(t.latches >= 1).toBe(true);
		expect(t.endReasons[0]).toBe(HookEnd.TIMED_OUT);
		expect(t.yanks).toBe(0);
	});

	it("a pillar breaking the line of sight breaks it; the player is not pulled on that tick", () => {
		const d = floorGrid();
		const w = walled(d);
		const px = gridToWorld(10);
		put(w.s, 0, px, gridToWorld(4));
		const a = chainhook(w, px, gridToWorld(10));
		const t = tally();
		stepUntil(w, t, a, () => a.aiState === CHAINHOOK_DRAG, 120);
		run(w, 2, t, a);
		const p = playerAt(w.s, 0);
		// A pillar rises between them (the cell under the midpoint).
		setTile(d, 10, worldToGrid((p.z + a.z) / 2), TileType.WALL);
		expect(ctxOf(w).lineOfSight(a.x, a.z, p.x, p.z)).toBe(false);
		const z0 = p.z;
		run(w, 1, t, a);
		expect([t.endReasons, t.breaks, p.z]).toEqual([[HookEnd.SIGHT], 1, z0]);
	});
});

// ---------------------------------------------------------------------------------------------

describe("Chainhook: co-op", () => {
	it("only the player it holds is ever moved, and only the one it threw at is ever latched", () => {
		const w = open(2);
		put(w.s, 0, 0, 0);
		put(w.s, 1, 3, -2);
		const a = chainhook(w, 0, 5);
		const t = tally();
		let target = 0;
		for (let k = 0; k < 1200; k++) {
			// Nobody walks (EMPTY_INPUT): a player who moves was dragged, by the Chainhook holding them as the tick started.
			const held = a.v[CHAINHOOK_HOOKED];
			const xs = [playerAt(w.s, 0).x, playerAt(w.s, 1).x];
			const zs = [playerAt(w.s, 0).z, playerAt(w.s, 1).z];
			const latches = t.latches;
			run(w, 1, t, a);
			if (a.aiState === AiState.TELEGRAPH && a.attack === CHAINHOOK_ATTACK_THROW)
				target = a.v[CHAINHOOK_THROW_TARGET] - 1;
			if (t.latches > latches) expect(t.latchPlayers[t.latchPlayers.size() - 1]).toBe(target);
			for (let i = 0; i < 2; i++) {
				const moved = playerAt(w.s, i).x !== xs[i] || playerAt(w.s, i).z !== zs[i];
				if (moved) expect(held).toBe(i + 1);
				playerAt(w.s, i).hearts = playerAt(w.s, i).heartsMax;
			}
		}
		expect(t.latches >= 2).toBe(true);
	});

	it("a teammate stepping into the line takes the hook: consumed, nobody latched or moved", () => {
		const w = open(2);
		put(w.s, 0, 0, 0);
		put(w.s, 1, 4, -3);
		const a = chainhook(w, 0, 5);
		const t = tally();
		stepUntil(w, t, a, () => a.aiState === CHAINHOOK_THROWN, 100);
		put(w.s, 1, 0, 2.5);
		run(w, 30, t, a);
		expect([t.latches, t.hits, w.s.combat.enemyBullets.activeCount, a.aiState]).toEqual([0, 0, 0, CHAINHOOK_KEEP]);
		expect([playerAt(w.s, 0).z, playerAt(w.s, 1).z]).toEqual([0, 2.5]);
	});

	it("a teammate's 3 damage frees the hooked player", () => {
		const w = open(2);
		put(w.s, 0, 0, 0);
		put(w.s, 1, 3, -2);
		const a = chainhook(w, 0, 6);
		const t = tally();
		stepUntil(w, t, a, () => a.aiState === CHAINHOOK_DRAG, 120);
		const ctx = ctxOf(w);
		ctx.actingPlayer(1);
		for (let k = 0; k < 3; k++) ctx.damageActor(a, 1);
		collect(w, t);
		expect([t.endPlayers, t.endReasons, chainhookHolderOf(w.s, 0)]).toEqual([[0], [HookEnd.DAMAGE], -1]);
	});

	it("two co-op runs with throws, drags, breaks and yanks hash the same every tick", () => {
		function play(): string[] {
			const w = open(2);
			put(w.s, 0, 0, 0);
			put(w.s, 1, 3, -2);
			chainhook(w, 0, 6);
			chainhook(w, -4, 4);
			const out: string[] = [];
			for (let k = 0; k < 600; k++) {
				const inputs: InputFrame[] = [
					{ ...EMPTY_INPUT, moveX: k % 120 < 60 ? 400 : -400, buttons: k % 97 === 0 ? Button.ROLL : 0 },
					{ ...EMPTY_INPUT, aimX: -1000, aimZ: 1000, buttons: k % 9 < 3 ? Button.FIRE : 0 },
				];
				stepParty(w.s, inputs, w.config);
				for (let i = 0; i < 2; i++) playerAt(w.s, i).hearts = playerAt(w.s, i).heartsMax;
				out.push(hashState(w.s));
			}
			return out;
		}
		expect(play()).toEqual(play());
	});
});

describe("Chainhook: draws", () => {
	it("one draw in init, exactly one per throw (on the aim's start tick), none for drags or yanks", () => {
		const w = open();
		const rng0 = w.s.rngState;
		const a = spawnActor(ctxOf(w), KIND, 0, 5)!;
		const one = new Rng(0);
		one.setState(rng0);
		one.next();
		expect(w.s.rngState).toBe(one.getState());
		a.cooldown = 0;
		let draws = 0;
		let throws = 0;
		let prevAttack = 0;
		let prevState = a.aiState;
		const t = tally();
		for (let k = 0; k < 1500; k++) {
			const p = playerAt(w.s, 0);
			p.hearts = p.heartsMax;
			if (a.aiState === CHAINHOOK_KEEP) put(w.s, 0, a.x, a.z - 5);
			const before = w.s.rngState;
			run(w, 1, t, a);
			const started =
				a.aiState === AiState.TELEGRAPH &&
				a.attack === CHAINHOOK_ATTACK_THROW &&
				!(prevState === AiState.TELEGRAPH && prevAttack === CHAINHOOK_ATTACK_THROW);
			if (started) throws++;
			if (w.s.rngState !== before) {
				draws++;
				const probe = new Rng(0);
				probe.setState(before);
				probe.next();
				expect(w.s.rngState).toBe(probe.getState());
				expect(started).toBe(true);
			}
			prevState = a.aiState;
			prevAttack = a.attack;
		}
		expect(throws >= 3).toBe(true);
		expect(t.latches >= 3).toBe(true);
		expect(t.endReasons.filter((r) => r === HookEnd.ARRIVED).size() >= 3).toBe(true);
		expect(draws).toBe(throws);
	});
});
