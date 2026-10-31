// M2 in-run progression in co-op (M4): personal modifiers apply to the right player (the bullet's owner, the swinging
// player, the hit player, the killer), team-wide rules (Lingering / Composure: any living owner; Haste / Impatience:
// once for the world however many players took them; the Hourglass slow: global while any timer runs), per-player
// drafts (own offers drawn in player index order, own input, the world frozen until every present player confirmed,
// leavers skipped), pedestals (first player in index order) and the shrine (the presser takes the curse, then it is
// used for everyone). Measured in an open endless ARENA like progression.spec.ts, with a party of two (both spawn at
// the origin). The scripted 2-player run with drafts, a relic and a curse is shared/run partyProgression.spec.ts.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	CLASSIC_BOON_COUNT,
	BOW_DATA,
	Boon,
	BulletKind,
	Button,
	COMBO_WINDOW_TICKS,
	CURSE_COUNT,
	Curse,
	DEBUG_FLOOR_BUTTON,
	DEFAULT_BOUNDS,
	DRAFT_CONFIRM_BUTTON,
	DRAFT_MIN_OPEN_TICKS,
	DRAFT_OFFER_COUNT,
	EMPTY_INPUT,
	HOURGLASS_TICKS,
	HOURGLASS_TIME_SCALE,
	PARTY_LEFT_BUTTON,
	RELIC_COUNT,
	Relic,
	SHRINE_BUTTON,
	SIM_DT,
	SWORD_DATA,
	ScoreSource,
	SimCtx,
	acceptCurse,
	createSimState,
	curseMultiplier,
	drawBoonOffers,
	fireBurstRaw,
	grantBoon,
	grantRelic,
	hashState,
	isDraftOpen,
	packPayload,
	playerAt,
	rngInt,
	runMods,
	stepParty,
	teamComboWindowTicks,
	teammatesDrafting,
	type ActorSpawn,
	type ActorState,
	type BulletSimulation,
	type EncounterRoom,
	type EncounterRoomType,
	type EndlessFloorWorld,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { frame } from "shared/run/testing";

const SEED = 42;
const N = 2;

// ---------------------------------------------------------------------------------------------
// The arena (as progression.spec.ts): an open greybox square, a treasure room (pedestal at (3, 0)), a shrine room
// (zone at (-3, 0)), a combat room around (0, 5); floors end by the debug skip only.

function room(id: number, kind: EncounterRoomType, cx: number, cz: number): EncounterRoom {
	const h = 1;
	return { id, type: kind, depth: 1, cx, cz, minX: cx - h, maxX: cx + h, minZ: cz - h, maxZ: cz + h, floorTiles: 9 };
}

const ROOMS: EncounterRoom[] = [room(0, "treasure", 3, 0), room(1, "shrine", -3, 0), room(2, "combat", 0, 5)];
const ROOM_SPAWNS: ActorSpawn[][] = [[], [], [{ kind: "swarmer", x: 0, z: 5.5 }]];
const TREASURE = ROOMS[0];
const SHRINE = ROOMS[1];

const arenaWorlds = new Map<number, EndlessFloorWorld>();
function arenaWorld(floor: number): EndlessFloorWorld {
	let w = arenaWorlds.get(floor);
	if (w === undefined) {
		w = {
			floor,
			config: {
				bounds: DEFAULT_BOUNDS,
				encounter: { spawns: [], rooms: ROOMS, entranceRoom: -1, bossRoom: -1 },
			},
			bossFloor: false,
			spawnX: 0,
			spawnZ: 0,
			stairX: 1000,
			stairZ: 1000,
			roomSpawns: ROOM_SPAWNS,
			roomIdAt: (x, z) => {
				for (const r of ROOMS) if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) return r.id;
				return -1;
			},
		};
		arenaWorlds.set(floor, w);
	}
	return w;
}

const PARTY_ARENA: SimConfig = {
	endless: { runSeed: SEED, worldForFloor: arenaWorld },
	scoring: { partySize: N },
	party: { size: N },
};

interface Run {
	readonly s: SimState;
}

function arena(): Run {
	return { s: createSimState(SEED, 0, 0, PARTY_ARENA) };
}

function idle(): InputFrame[] {
	const f: InputFrame[] = [];
	for (let i = 0; i < N; i++) f.push({ ...EMPTY_INPUT });
	return f;
}

/** One tick: player `who` sends `input`, everyone else idles (who = -1: everyone idles). */
function tick(r: Run, who = -1, input: Readonly<InputFrame> = EMPTY_INPUT): void {
	const f = idle();
	if (who >= 0) f[who] = { ...input };
	stepParty(r.s, f, PARTY_ARENA);
}

function ctxOf(r: Run): SimCtx {
	return new SimCtx().bind(r.s, arenaWorld(r.s.endless!.floor).config, EMPTY_INPUT);
}

function spawnAt(r: Run, kind: string, x: number, z: number): ActorState {
	return ctxOf(r).spawnActor(kind, x, z)!;
}

function onlyBullet(sim: BulletSimulation): number {
	let slot = -1;
	sim.forEachActive((i) => {
		slot = i;
		return false;
	});
	return slot;
}

function place(s: SimState, i: number, x: number, z: number): void {
	const p = playerAt(s, i);
	p.x = x;
	p.z = z;
	p.prevX = x;
	p.prevZ = z;
}

const rp = (s: SimState, i: number) => s.run!.players[i];

// ---------------------------------------------------------------------------------------------

describe("co-op: personal modifiers apply to the right player", () => {
	it("one run entry per player, hashed; the solo-only player 0 rules stay player 0's", () => {
		const r = arena();
		expect(r.s.run!.players.size()).toBe(N);
		const before = hashState(r.s);
		grantBoon(r.s, 1, Boon.SHARPENED);
		expect(hashState(r.s)).never.toBe(before);
		expect([runMods(r.s, 0).damagePercent, runMods(r.s, 1).damagePercent]).toEqual([100, 125]);
	});

	it("player 1's Sharpened changes only player 1's bullet damage (the bullet's owner) and sword damage", () => {
		/** Player `who` (bow: SWAP first) fires one arrow at a bruiser two units east; damage dealt. */
		const arrow = (who: number) => {
			const r = arena();
			grantBoon(r.s, 1, Boon.SHARPENED);
			spawnAt(r, "bruiser", 2, 0);
			tick(r, who, frame(0, 0, Button.SWAP));
			let dealt = 0;
			for (let i = 0; i < 20 && dealt === 0; i++) {
				tick(r, who, frame(0, 0, i === 0 ? Button.FIRE : 0, 1, 0));
				dealt = r.s.events.damageDealt;
			}
			return dealt;
		};
		expect([arrow(0), arrow(1)]).toEqual([BOW_DATA.damage, 1.25]);
		const swing = (who: number) => {
			const r = arena();
			grantBoon(r.s, 1, Boon.SHARPENED);
			const p = playerAt(r.s, who);
			spawnAt(r, "bruiser", p.faceX, p.faceZ);
			tick(r, who, frame(0, 0, Button.FIRE));
			return r.s.events.damageDealt;
		};
		expect([swing(0), swing(1)]).toEqual([SWORD_DATA.damage, 3.75]);
	});

	it("Swift Strikes and Slippery: the acting / rolling player's own", () => {
		const r = arena();
		grantBoon(r.s, 1, Boon.SWIFT_STRIKES);
		grantBoon(r.s, 0, Boon.SLIPPERY);
		const f = idle();
		f[0] = frame(1, 0, Button.ROLL);
		f[1] = frame(0, 0, Button.SWAP);
		stepParty(r.s, f, PARTY_ARENA);
		expect([playerAt(r.s, 0).iframeTicks, playerAt(r.s, 1).iframeTicks]).toEqual([18, 0]);
		const g = idle();
		g[1] = frame(0, 0, Button.FIRE, 1, 0);
		stepParty(r.s, g, PARTY_ARENA);
		expect(r.s.party!.weapons[1].sets[1].cooldown).toBe(10); // bow stream 12 -> 10
	});

	it("Hearty / Frailty write the grantee's PlayerState only", () => {
		const r = arena();
		grantBoon(r.s, 1, Boon.HEARTY);
		acceptCurse(r.s, 0, Curse.FRAILTY);
		const p0 = playerAt(r.s, 0);
		const p1 = playerAt(r.s, 1);
		expect([p0.heartsMax, p1.heartsMax]).toEqual([4, 8]);
	});

	it("Bounty and Vampire Fang follow the killer (ctx.playerIndex)", () => {
		const points = (killer: number) => {
			const r = arena();
			grantBoon(r.s, 1, Boon.BOUNTY);
			const ctx = ctxOf(r);
			const a = spawnAt(r, "swarmer", 4, 4);
			ctx.actingPlayer(killer);
			ctx.killActor(a);
			return r.s.score!.points[ScoreSource.KILLS];
		};
		expect([points(0), points(1)]).toEqual([50, 55]);
		const r = arena();
		grantRelic(r.s, 0, Relic.VAMPIRE_FANG);
		playerAt(r.s, 0).hearts = 3;
		playerAt(r.s, 1).hearts = 3;
		const ctx = ctxOf(r);
		ctx.actingPlayer(1);
		for (let i = 0; i < 25; i++) ctx.killActor(spawnAt(r, "swarmer", 4, -4));
		expect([rp(r.s, 0).fangKills, playerAt(r.s, 0).hearts, playerAt(r.s, 1).hearts]).toEqual([0, 3, 3]);
		ctx.actingPlayer(0);
		for (let i = 0; i < 25; i++) ctx.killActor(spawnAt(r, "swarmer", 4, -4));
		expect([playerAt(r.s, 0).hearts, playerAt(r.s, 1).hearts, rp(r.s, 0).events.fangHealed]).toEqual([4, 3, 1]);
	});

	it("Second Wind saves only its holder", () => {
		const r = arena();
		grantRelic(r.s, 1, Relic.SECOND_WIND);
		for (const i of [0, 1]) {
			playerAt(r.s, i).hearts = 1;
			playerAt(r.s, i).armor = 0;
		}
		const f = idle();
		f[0] = frame(0, 0, Button.DEBUG_HIT);
		f[1] = frame(0, 0, Button.DEBUG_HIT);
		stepParty(r.s, f, PARTY_ARENA);
		expect([playerAt(r.s, 0).dead, playerAt(r.s, 1).dead, playerAt(r.s, 1).hearts]).toEqual([1, 0, 1]);
		expect([rp(r.s, 0).events.secondWind, rp(r.s, 1).events.secondWind]).toEqual([0, 1]);
	});

	it("Hourglass: a hit on its holder slows enemy bullets globally; a hit on the other player does not", () => {
		const run = (hit: number) => {
			const r = arena();
			grantRelic(r.s, 1, Relic.HOURGLASS);
			const c = r.s.combat;
			c.enemySpawned += fireBurstRaw(
				c.enemyBullets,
				0,
				6,
				4,
				0,
				1,
				1,
				0,
				3,
				5,
				packPayload(1, BulletKind.ENEMY, 0),
			);
			const sim = c.enemyBullets;
			const slot = onlyBullet(sim);
			const z0 = sim.positionAt(slot).z;
			tick(r, hit, frame(0, 0, Button.DEBUG_HIT));
			return { dz: sim.positionAt(slot).z - z0, ticks: [rp(r.s, 0).hourglassTicks, rp(r.s, 1).hourglassTicks] };
		};
		const a = run(0);
		expect(a.dz).toBeCloseTo(3 * SIM_DT, 12);
		expect(a.ticks).toEqual([0, 0]);
		const b = run(1);
		expect(b.dz).toBeCloseTo(3 * SIM_DT * HOURGLASS_TIME_SCALE, 12);
		expect(b.ticks).toEqual([0, HOURGLASS_TICKS - 1]);
	});
});

describe("co-op: team-wide rules", () => {
	it("Lingering: the combo window is longer if ANY living player owns it (not when the owner is dead)", () => {
		const timer = (ownerDead: boolean) => {
			const r = arena();
			grantBoon(r.s, 1, Boon.LINGERING);
			if (ownerDead) playerAt(r.s, 1).dead = 1;
			ctxOf(r).killActor(spawnAt(r, "swarmer", 4, 4)); // credited to player 0
			return r.s.score!.comboTimer;
		};
		expect([timer(false), timer(true)]).toEqual([540, COMBO_WINDOW_TICKS]);
		// Nobody alive: every player's boons count (a solo run's dead player keeps theirs).
		const r = arena();
		grantBoon(r.s, 1, Boon.LINGERING);
		playerAt(r.s, 0).dead = 1;
		playerAt(r.s, 1).dead = 1;
		expect(teamComboWindowTicks(r.s)).toBe(540);
	});

	it("Composure: any living owner halves the hit cut, whoever was hit", () => {
		const cut = (owner: number) => {
			const r = arena();
			if (owner >= 0) grantBoon(r.s, owner, Boon.COMPOSURE);
			r.s.score!.combo = 50;
			tick(r, 0, frame(0, 0, Button.DEBUG_HIT));
			return r.s.score!.combo;
		};
		expect([cut(-1), cut(0), cut(1)]).toEqual([25, 37, 37]);
	});

	it("world curses apply once with two acceptors: Haste x 1.15 (not x 1.3225), Impatience -1 s; score +0.25 each", () => {
		const speed = (acceptors: number[]) => {
			const r = arena();
			for (const i of acceptors) acceptCurse(r.s, i, Curse.HASTE);
			const shooter = spawnAt(r, "sniper", 4, 4);
			r.s.combat.enemyBullets.clear();
			ctxOf(r).fireEnemy(shooter, 0, 1, {
				count: 1,
				spread: 0,
				speed: 5,
				life: 1,
				damage: 1,
				kind: BulletKind.ENEMY,
			});
			const sim = r.s.combat.enemyBullets;
			return {
				vz: sim.velocityAt(onlyBullet(sim)).z,
				curses: r.s.score!.curses,
				mult: curseMultiplier(r.s.score!),
			};
		};
		expect(speed([])).toEqual({ vz: 5, curses: 0, mult: 1 });
		expect(speed([1])).toEqual({ vz: 5 * 1.15, curses: 1, mult: 1.25 });
		expect(speed([0, 1])).toEqual({ vz: 5 * 1.15, curses: 2, mult: 1.5 });
		const r = arena();
		acceptCurse(r.s, 0, Curse.IMPATIENCE);
		acceptCurse(r.s, 1, Curse.IMPATIENCE);
		expect(teamComboWindowTicks(r.s)).toBe(240);
		playerAt(r.s, 0).dead = 1; // a curse is world state: its taker's death does not lift it
		expect(teamComboWindowTicks(r.s)).toBe(240);
		grantBoon(r.s, 1, Boon.LINGERING);
		expect(teamComboWindowTicks(r.s)).toBe(420);
	});
});

describe("co-op: drafts", () => {
	it("every present player gets their own offers (index order from the sim rng); the world waits for all", () => {
		const r = arena();
		const s = r.s;
		// Player 0 owns all but three boons: their offers are exactly those three (no rng); player 1 draws.
		for (let b = 0; b < CLASSIC_BOON_COUNT - DRAFT_OFFER_COUNT; b++) grantBoon(s, 0, b);
		const twin = { rngState: s.rngState };
		const want0 = drawBoonOffers(twin, rp(s, 0).boons, 1);
		const want1 = drawBoonOffers(twin, rp(s, 1).boons, 1);
		tick(r, 0, frame(0, 0, DEBUG_FLOOR_BUTTON));
		expect(s.endless!.floor).toBe(2);
		expect([rp(s, 0).draftOffers, rp(s, 1).draftOffers]).toEqual([want0, want1]);
		expect(want0).toEqual([CLASSIC_BOON_COUNT - 3, CLASSIC_BOON_COUNT - 2, CLASSIC_BOON_COUNT - 1]);
		expect(s.rngState).toBe(twin.rngState);
		expect([teammatesDrafting(s, 0), teammatesDrafting(s, 1)]).toEqual([1, 1]);

		// Player 0 confirms (left card); player 1 holds the stick right. The world stays frozen.
		const left = frame(-0.8, 0.8);
		const right = frame(0.8, -0.8);
		const both = (a: InputFrame, b: InputFrame) => stepParty(s, [a, b], PARTY_ARENA);
		while (rp(s, 0).draftTicks + 1 < DRAFT_MIN_OPEN_TICKS) both(left, right);
		both({ ...left, buttons: DRAFT_CONFIRM_BUTTON }, right);
		expect([rp(s, 0).draftOpen, rp(s, 1).draftOpen]).toEqual([0, 1]);
		expect(rp(s, 0).boons[rp(s, 0).boons.size() - 1]).toBe(want0[0]);
		expect(rp(s, 0).events.draftChosen).toBe(want0[0] + 1);
		expect([isDraftOpen(s), teammatesDrafting(s, 0), teammatesDrafting(s, 1)]).toEqual([true, 1, 0]);
		const steps = s.combat.enemyBullets.stepCount;
		const p0 = { ...playerAt(s, 0) };
		for (let i = 0; i < 10; i++) both(frame(1, 0), right); // player 0 walks: nothing moves
		expect([s.combat.enemyBullets.stepCount, playerAt(s, 0).x]).toEqual([steps, p0.x]);
		both(frame(0, 0), { ...right, buttons: DRAFT_CONFIRM_BUTTON });
		expect(isDraftOpen(s)).toBe(false);
		expect(rp(s, 1).boons).toEqual([want1[2]]);
		both(frame(1, 0), frame(0, 0));
		expect(s.combat.enemyBullets.stepCount).toBe(steps + 1); // the world runs again
		expect(playerAt(s, 0).x > p0.x).toBe(true);
	});

	it("offers exclude only that player's boons; a player who left gets no draft, one leaving mid-draft frees it", () => {
		const r = arena();
		const s = r.s;
		grantBoon(s, 1, Boon.SHARPENED);
		tick(r, 0, frame(0, 0, DEBUG_FLOOR_BUTTON));
		expect(rp(s, 1).draftOffers.includes(Boon.SHARPENED)).toBe(false);
		// Player 1 leaves while both drafts are open: theirs closes without a pick; player 0's still holds the world.
		tick(r, 1, frame(0, 0, PARTY_LEFT_BUTTON));
		expect([rp(s, 0).draftOpen, rp(s, 1).draftOpen, rp(s, 1).boons.size()]).toEqual([1, 0, 1]);
		const leftBit = { ...EMPTY_INPUT, buttons: PARTY_LEFT_BUTTON };
		while (rp(s, 0).draftTicks + 1 < DRAFT_MIN_OPEN_TICKS) stepParty(s, [frame(0, 0), leftBit], PARTY_ARENA);
		stepParty(s, [frame(0, 0, DRAFT_CONFIRM_BUTTON), leftBit], PARTY_ARENA);
		expect(isDraftOpen(s)).toBe(false);
		stepParty(s, [frame(0, 0), leftBit], PARTY_ARENA);
		// The next floor: only the player still in the run drafts.
		stepParty(s, [frame(0, 0, DEBUG_FLOOR_BUTTON), leftBit], PARTY_ARENA);
		expect(s.endless!.floor).toBe(3);
		expect([rp(s, 0).draftOpen, rp(s, 1).draftOpen]).toEqual([1, 0]);
	});
});

describe("co-op: pedestals and the shrine", () => {
	it("a pedestal goes to the first living player on it (index order), drawn from THEIR unowned relics", () => {
		const r = arena();
		const s = r.s;
		grantRelic(s, 1, Relic.HOURGLASS);
		place(s, 0, TREASURE.cx, TREASURE.cz);
		place(s, 1, TREASURE.cx + 0.2, TREASURE.cz);
		const twin = { rngState: s.rngState };
		const want = rngInt(twin, 0, RELIC_COUNT - 1);
		tick(r);
		expect([rp(s, 0).relics, rp(s, 1).relics]).toEqual([[want], [Relic.HOURGLASS]]);
		expect(rp(s, 0).events.relicCollected).toBe(want + 1);
		// Player 0 dead: player 1 gets the next floor's pedestal from their own unowned set.
		const r2 = arena();
		const s2 = r2.s;
		grantRelic(s2, 1, Relic.HOURGLASS);
		playerAt(s2, 0).dead = 1;
		place(s2, 0, TREASURE.cx, TREASURE.cz);
		place(s2, 1, TREASURE.cx, TREASURE.cz);
		const twin2 = { rngState: s2.rngState };
		const unowned = [Relic.MIRROR_CLOAK, Relic.VAMPIRE_FANG, Relic.SECOND_WIND];
		const want2 = unowned[rngInt(twin2, 0, unowned.size() - 1)];
		tick(r2);
		expect([rp(s2, 0).relics, rp(s2, 1).relics]).toEqual([[], [Relic.HOURGLASS, want2]]);
	});

	it("the player who presses SKILL1 in the zone takes the curse; the shrine is then used for everyone", () => {
		const r = arena();
		const s = r.s;
		place(s, 0, SHRINE.cx, SHRINE.cz);
		place(s, 1, SHRINE.cx + 0.3, SHRINE.cz);
		const twin = { rngState: s.rngState };
		const want = rngInt(twin, 0, CURSE_COUNT - 1);
		tick(r, 1, frame(0, 0, SHRINE_BUTTON));
		expect([rp(s, 0).curses, rp(s, 1).curses]).toEqual([[], [want]]);
		expect([s.run!.shrineUsed, s.score!.curses, rp(s, 1).events.curseAccepted]).toEqual([1, 1, want + 1]);
		tick(r);
		tick(r, 0, frame(0, 0, SHRINE_BUTTON));
		expect([rp(s, 0).curses.size(), s.score!.curses]).toEqual([0, 1]);
	});
});
