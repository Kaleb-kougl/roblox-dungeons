// The Jackal (docs/NEW_ENEMIES_3.md NT4): circling, the one-at-a-time token per target (solo and across two targets in
// co-op), the front-cone rule (jackalBehind: no sqrt), the wind-up, the spook (a hop back, no draw), the lunge (one hit
// per player), the recover, NTD9's guard stop (a stagger, no damage, ONE parry-feed entry, no score; a guard from
// straight behind or a rolling player's guard is no stop), NTD10 (a lone Jackal keeps the back-only rule), the draws
// (one in init, one per lunge, checked tick by tick in every scenario), and determinism on real endless floors (solo
// and a party of two, every tick hashed twice).
import { describe, expect, it } from "@rbxts/jest-globals";
import { TileType, tileAt } from "shared/dungeon";
import { endlessRunFloor } from "shared/run";
import {
	AXIS_MAX,
	AiState,
	EMPTY_INPUT,
	JACKAL,
	JACKAL_ATTACK_LUNGE,
	JACKAL_CIRCLE,
	JACKAL_HIT_BITS,
	JACKAL_HOP,
	JACKAL_LUNGE,
	JACKAL_PHASE,
	JACKAL_RECOVER,
	JACKAL_STAGGER,
	JACKAL_TARGET,
	NO_KIND,
	PLAYER_RADIUS,
	Rng,
	SWORD_V_GUARD,
	ScoreSource,
	SimCtx,
	activeWeaponSlot,
	archetypeIndex,
	createSimState,
	engage,
	hashNumbers,
	hashState,
	jackalBehind,
	jackalHoldsToken,
	nearestLivingPlayer,
	partySize,
	playerAt,
	spawnActor,
	step,
	stepParty,
	weaponIndex,
	weaponsAt,
	writeScoreHash,
	type ActorState,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";

const D = JACKAL.data;
const KIND = archetypeIndex(JACKAL.id);
const BOUNDS = { minX: -24, maxX: 24, minZ: -24, maxZ: 24 };

/** The rng word after exactly `n` draws from `from`. */
function after(from: number, n: number): number {
	const r = new Rng(0);
	r.setState(from);
	for (let i = 0; i < n; i++) r.next();
	return r.getState();
}

function put(s: SimState, i: number, x: number, z: number): void {
	const p = playerAt(s, i);
	p.x = x;
	p.z = z;
	p.prevX = x;
	p.prevZ = z;
}

/** How player `i` turns before a tick: toward / away from / across (90 degrees off) the nearest Jackal, or as it is. */
type Facing = "watch" | "away" | "across" | "keep";

interface World {
	s: SimState;
	config: SimConfig;
	jackals: ActorState[];
	/** Per player. */
	facing: Facing[];
	/** Hold the sword guard up every tick (spec write of v[SWORD_V_GUARD] before the tick), per player. */
	guard: boolean[];
}

function ctxOf(w: World): SimCtx {
	return new SimCtx().bind(w.s, w.config, EMPTY_INPUT);
}

function world(party = 1, extra: Partial<SimConfig> = {}): World {
	const config: SimConfig = { bounds: BOUNDS, party: party > 1 ? { size: party } : undefined, ...extra };
	const s = createSimState(11, 0, 0, config);
	for (let i = 0; i < party; i++) put(s, i, 0, 0);
	const facing: Facing[] = [];
	const guard: boolean[] = [];
	for (let i = 0; i < party; i++) {
		facing.push("keep");
		guard.push(false);
	}
	return { s, config, jackals: [], facing, guard };
}

/** An engaged Jackal at (x, z), its cooldown out (it may act on the first tick). */
function jackal(w: World, x: number, z: number): ActorState {
	const a = spawnActor(ctxOf(w), KIND, x, z)!;
	a.spawnTick = -1;
	engage(a);
	a.cooldown = 0;
	w.jackals.push(a);
	return a;
}

function nearestJackal(w: World, x: number, z: number): ActorState | undefined {
	let best: ActorState | undefined;
	let bd = 0;
	for (const a of w.jackals) {
		if (a.alive === 0) continue;
		const d2 = (a.x - x) * (a.x - x) + (a.z - z) * (a.z - z);
		if (best === undefined || d2 < bd) {
			best = a;
			bd = d2;
		}
	}
	return best;
}

function face(w: World, i: number): void {
	const p = playerAt(w.s, i);
	const how = w.facing[i];
	if (how === "keep") return;
	const a = nearestJackal(w, p.x, p.z);
	if (a === undefined) return;
	const dx = a.x - p.x;
	const dz = a.z - p.z;
	const len = math.sqrt(dx * dx + dz * dz);
	if (len < 1e-9) return;
	const ux = dx / len;
	const uz = dz / len;
	if (how === "watch") {
		p.faceX = ux;
		p.faceZ = uz;
	} else if (how === "away") {
		p.faceX = -ux;
		p.faceZ = -uz;
	} else {
		p.faceX = -uz;
		p.faceZ = ux;
	}
}

interface Tally {
	ticks: number;
	/** Hits a Jackal landed (events.playerHits with lastHitSource the Jackal). */
	hits: number;
	lunges: number;
	spooks: number;
	starts: number;
	staggers: number;
	/** Parry-feed entries (guardPlayer) and the ticks they came on. */
	feed: number[];
	feedTicks: number[];
	/** A tick on which two different targets each had a Jackal winding up or lunging. */
	twoAtOnce: number;
}

function tally(): Tally {
	return { ticks: 0, hits: 0, lunges: 0, spooks: 0, starts: 0, staggers: 0, feed: [], feedTicks: [], twoAtOnce: 0 };
}

/**
 * One tick, asserting the invariants: the rng moved by exactly one draw per lunge started (nothing else draws here);
 * at most one Jackal per target (its locked v[JACKAL_TARGET]) winds up or lunges; a wind-up only ever starts from
 * outside its target's front cone; every player's hearts are topped up so the run never ends.
 */
function tick(w: World, t: Tally, inputs?: InputFrame[]): void {
	const s = w.s;
	const n = partySize(s);
	for (let i = 0; i < n; i++) {
		const p = playerAt(s, i);
		p.hearts = p.heartsMax;
		p.armor = 0;
		face(w, i);
		if (w.guard[i]) activeWeaponSlot(weaponsAt(s, i)).v[SWORD_V_GUARD] = 3;
	}
	const states: number[] = [];
	for (const a of w.jackals) states.push(a.aiState);
	const before = s.rngState;
	if (n > 1) {
		const all: InputFrame[] = [];
		for (let i = 0; i < n; i++) all.push(inputs !== undefined ? inputs[i] : EMPTY_INPUT);
		stepParty(s, all, w.config);
	} else step(s, inputs !== undefined ? inputs[0] : EMPTY_INPUT, w.config);
	t.ticks++;
	expect([s.tick, s.rngState]).toEqual([s.tick, after(before, s.events.lunges)]);
	t.lunges += s.events.lunges;
	t.spooks += s.events.spooks;
	if (s.events.playerHits > 0 && s.events.lastHitSource === KIND) t.hits += s.events.playerHits;
	if (s.score !== undefined) {
		for (const k of s.score.events.guardPlayer) {
			t.feed.push(k);
			t.feedTicks.push(s.tick);
		}
	}
	const holders: number[] = [];
	for (let i = 0; i < n; i++) holders.push(0);
	for (let k = 0; k < w.jackals.size(); k++) {
		const a = w.jackals[k];
		if (a.alive === 0) continue;
		if (jackalHoldsToken(a)) holders[a.v[JACKAL_TARGET]] += 1;
		if (a.aiState === JACKAL_STAGGER && states[k] !== JACKAL_STAGGER) t.staggers++;
		if (a.aiState === AiState.TELEGRAPH && a.attack === JACKAL_ATTACK_LUNGE && a.aiTicks === D.windupTicks) {
			t.starts++;
			// Locked on its nearest living player at the start (the actor phase's; nobody moves after it here).
			expect(a.v[JACKAL_TARGET]).toBe(nearestLivingPlayer(s, a.x, a.z));
			const p = playerAt(s, a.v[JACKAL_TARGET]);
			expect(jackalBehind(p.faceX, p.faceZ, a.x - p.x, a.z - p.z, D.frontCos)).toBe(true);
		}
	}
	let busy = 0;
	for (let i = 0; i < n; i++) {
		expect(holders[i] <= 1).toBe(true);
		if (holders[i] === 1) busy++;
	}
	if (busy >= 2) t.twoAtOnce++;
}

function run(w: World, ticks: number): Tally {
	const t = tally();
	for (let k = 0; k < ticks; k++) tick(w, t);
	return t;
}

describe("jackal: the front-cone helper (no sqrt)", () => {
	it("is dot(face, offset) < cos x |offset|, for positive and negative cosines", () => {
		// Facing +Z; points at 0, 60, 70.1, 90, 180 degrees off it (cos 1, 0.5, ~0.34, 0, -1), 2 units out.
		expect(jackalBehind(0, 1, 0, 2, 0.34)).toBe(false);
		expect(jackalBehind(0, 1, 2 * 0.8660254037844386, 1, 0.34)).toBe(false); // cos 0.5
		expect(jackalBehind(0, 1, 2 * 0.9486832980505138, 2 * 0.31622776601683794, 0.34)).toBe(true); // cos ~0.316
		expect(jackalBehind(0, 1, 2, 0, 0.34)).toBe(true);
		expect(jackalBehind(0, 1, 0, -2, 0.34)).toBe(true);
		expect(jackalBehind(0, 1, 2, 0, -0.2)).toBe(false); // cos 0 >= -0.2
		expect(jackalBehind(0, 1, 2 * 0.9486832980505138, -2 * 0.31622776601683794, -0.2)).toBe(true); // cos ~-0.316
		expect(jackalBehind(0, 1, 0, 0, 0.34)).toBe(false); // on the player: never behind
		// It agrees with the sqrt form on a sweep of points.
		for (let k = 0; k < 64; k++) {
			const x = ((k * 37) % 23) - 11;
			const z = ((k * 53) % 19) - 9;
			for (const c of [0.34, 0.5, -0.2, 0]) {
				const len = math.sqrt(x * x + z * z);
				if (len === 0) continue;
				expect([x, z, c, jackalBehind(0.6, 0.8, x, z, c)]).toEqual([x, z, c, 0.6 * x + 0.8 * z < c * len]);
			}
		}
	});
});

describe("jackal: circling and the lunge", () => {
	it("circles its target inside the band and never lunges at a player who keeps facing it (no wind-up at all)", () => {
		const w = world();
		w.facing[0] = "watch";
		const a = jackal(w, 0, -6);
		const t = run(w, 1800);
		expect([t.starts, t.lunges, t.hits]).toEqual([0, 0, 0]);
		const d = math.sqrt(a.x * a.x + a.z * a.z);
		expect(d > D.circleMin - 0.2 && d < D.circleMax + 0.2).toBe(true);
		expect(a.aiState).toBe(JACKAL_CIRCLE);
	});

	it("a player who faces away is lunged at and hit, once per lunge; then it recovers", () => {
		const w = world();
		w.facing[0] = "away";
		const a = jackal(w, 0, -3.3);
		let recovered = 0;
		const t = tally();
		for (let k = 0; k < 1200; k++) {
			const was = a.aiState;
			tick(w, t);
			if (was === JACKAL_LUNGE && a.aiState === JACKAL_RECOVER) {
				recovered++;
				expect(a.v[JACKAL_PHASE]).toBe(D.recoverTicks);
			}
		}
		expect(t.lunges >= 5).toBe(true);
		expect(t.hits).toBe(t.lunges); // every lunge from behind lands (the player stands, hurt i-frames long over)
		expect(recovered).toBe(t.lunges);
		expect(t.spooks).toBe(0);
	});

	it("turning to face it during the wind-up spooks it: a hop back, never a hit, no draw", () => {
		const w = world();
		w.facing[0] = "away";
		const a = jackal(w, 0, -3.3);
		const t = tally();
		let hops = 0;
		for (let k = 0; k < 1500; k++) {
			// Faces away until a wind-up starts, then turns onto it.
			w.facing[0] = a.aiState === AiState.TELEGRAPH ? "watch" : "away";
			const was = a.aiState;
			const x0 = a.x;
			const z0 = a.z;
			tick(w, t);
			if (was !== JACKAL_HOP && a.aiState === JACKAL_HOP) {
				hops++;
				expect(a.v[JACKAL_PHASE]).toBe(D.hopTicks);
				expect([a.x, a.z]).toEqual([x0, z0]); // the call-off tick stands; the hop moves from the next
			}
		}
		expect(t.starts >= 5).toBe(true);
		expect(t.spooks).toBe(t.starts);
		expect(hops).toBe(t.spooks);
		expect([t.lunges, t.hits]).toEqual([0, 0]);
	});

	it("the hop moves hopDistance straight back along the locked heading, then the cooldown is the fixed spook one", () => {
		const w = world();
		const a = jackal(w, 0, -3.3);
		const p = playerAt(w.s, 0);
		p.faceX = 0;
		p.faceZ = 1; // away from the Jackal (it stands at -Z)
		const t = tally();
		tick(w, t);
		expect(a.aiState).toBe(AiState.TELEGRAPH);
		const hx = a.x;
		const hz = a.z;
		p.faceZ = -1; // turns onto it
		tick(w, t);
		expect([a.aiState, t.spooks]).toEqual([JACKAL_HOP, 1]);
		for (let k = 0; k < D.hopTicks; k++) tick(w, t);
		expect(a.aiState).toBe(JACKAL_CIRCLE);
		expect(math.abs(a.x - hx) < 1e-9).toBe(true);
		expect(math.abs(a.z - (hz - D.hopDistance)) < 1e-9).toBe(true);
		expect(a.cooldown).toBe(D.spookCooldownTicks);
		expect(t.lunges).toBe(0);
	});

	it("a pack of three never has two on one target at once, and still lunges from behind (a spinning player)", () => {
		const w = world();
		jackal(w, 0, -4);
		jackal(w, 3.5, 2);
		jackal(w, -3.5, 2);
		const p = playerAt(w.s, 0);
		// Spins 2 degrees a tick (a literal rotation).
		const c = 0.9993908270190958;
		const sn = 0.03489949670250097;
		const t = tally();
		for (let k = 0; k < 2400; k++) {
			const fx = p.faceX * c - p.faceZ * sn;
			const fz = p.faceX * sn + p.faceZ * c;
			p.faceX = fx;
			p.faceZ = fz;
			tick(w, t);
		}
		expect(t.lunges >= 10).toBe(true);
		expect(t.hits >= 1).toBe(true);
		for (const a of w.jackals) expect(a.alive).toBe(1);
	});

	it("separation: a stacked pack spreads out and no pair stays within 0.5 for long (a crossing passes)", () => {
		const w = world();
		w.facing[0] = "watch";
		jackal(w, 0, -5);
		jackal(w, 0, -5);
		jackal(w, 0.05, -5);
		const t = tally();
		const runs = [0, 0, 0];
		const longest = [0, 0, 0];
		for (let k = 0; k < 900; k++) {
			tick(w, t);
			let pair = 0;
			for (let i = 0; i < 3; i++)
				for (let j = i + 1; j < 3; j++) {
					const a = w.jackals[i];
					const b = w.jackals[j];
					const near = (a.x - b.x) * (a.x - b.x) + (a.z - b.z) * (a.z - b.z) < 0.25;
					runs[pair] = near ? runs[pair] + 1 : 0;
					if (runs[pair] > longest[pair]) longest[pair] = runs[pair];
					pair++;
				}
		}
		for (const n of longest) expect(n < 40).toBe(true);
	});

	it("NTD10: a lone Jackal still never starts a wind-up inside its target's front cone (a slowly turning player)", () => {
		const w = world();
		jackal(w, 2, -2.5);
		const p = playerAt(w.s, 0);
		const c = 0.9998476951563913; // 1 degree a tick
		const sn = 0.01745240643728351;
		const t = tally();
		for (let k = 0; k < 3000; k++) {
			const fx = p.faceX * c - p.faceZ * sn;
			const fz = p.faceX * sn + p.faceZ * c;
			p.faceX = fx;
			p.faceZ = fz;
			tick(w, t); // asserts the cone at every start
		}
		expect(t.starts >= 5).toBe(true);
	});

	it("co-op: the token is per target (two Jackals on two players lunge at the same time; never two on one)", () => {
		const w = world(2);
		put(w.s, 1, 16, 0);
		w.facing[0] = "away";
		w.facing[1] = "away";
		jackal(w, 0, -3.3);
		jackal(w, 16, -3.3);
		jackal(w, 3, 0.5); // a second Jackal on player 0
		const t = run(w, 1800);
		expect(t.twoAtOnce >= 1).toBe(true);
		expect(t.lunges >= 6).toBe(true);
	});
});

describe("jackal: NTD9, the guard stop", () => {
	function guarded(facing: Facing, scored = true): { w: World; a: ActorState; t: Tally; staggerTicks: number[] } {
		const w = world(1, scored ? { scoring: {} } : {});
		const slot = activeWeaponSlot(weaponsAt(w.s, 0));
		expect(slot.weapon).toBe(weaponIndex("weapon.sword"));
		w.facing[0] = facing;
		w.guard[0] = true;
		const a = jackal(w, 0, -3.3);
		const t = tally();
		const staggerTicks: number[] = [];
		let run = 0;
		for (let k = 0; k < 900; k++) {
			tick(w, t);
			if (a.aiState === JACKAL_STAGGER) run++;
			else if (run > 0) {
				staggerTicks.push(run);
				run = 0;
			}
		}
		return { w, a, t, staggerTicks };
	}

	it("a guard into a lunge (the player turned across it) staggers it 1.0 s, no damage, one parry entry per stop", () => {
		const { w, t, staggerTicks } = guarded("across");
		expect(t.lunges >= 3).toBe(true);
		expect(t.staggers).toBe(t.lunges);
		expect(t.hits).toBe(0);
		expect(t.feed.size()).toBe(t.staggers);
		for (const k of t.feed) expect(k).toBe(0);
		// One entry per stop, each on its own tick.
		for (let i = 1; i < t.feedTicks.size(); i++) expect(t.feedTicks[i] > t.feedTicks[i - 1]).toBe(true);
		for (const n of staggerTicks) expect(n).toBe(D.staggerTicks);
		// No points, no guard cancels, no score change: the parry is the unhashed feed only.
		const sc = w.s.score!;
		expect([sc.points[ScoreSource.GUARD], sc.counts[ScoreSource.GUARD]]).toEqual([0, 0]);
	});

	it("the hashed score never moves on a stop (no kills, no rooms: it stays the start's every tick)", () => {
		const w = world(1, { scoring: {} });
		w.facing[0] = "across";
		w.guard[0] = true;
		jackal(w, 0, -3.3);
		const scoreHash = (): string => {
			const out: number[] = [];
			writeScoreHash(w.s.score!, out);
			return hashNumbers(out);
		};
		const start = scoreHash();
		const t = tally();
		for (let k = 0; k < 600; k++) {
			tick(w, t);
			expect(scoreHash()).toBe(start);
			expect(w.s.score!.events.guardCancels).toBe(0);
		}
		expect(t.feed.size() >= 2).toBe(true);
	});

	it("the feed's entry is the contact point on the player's rim toward the Jackal", () => {
		const w = world(1, { scoring: {} });
		w.facing[0] = "across";
		w.guard[0] = true;
		const a = jackal(w, 0, -3.3);
		for (let k = 0; k < 600; k++) {
			tick(w, tally());
			const e = w.s.score!.events;
			if (e.guardPlayer.size() === 0) continue;
			const p = playerAt(w.s, 0);
			const dx = a.x - p.x;
			const dz = a.z - p.z;
			const k2 = PLAYER_RADIUS / (a.radius + PLAYER_RADIUS);
			expect(math.abs(e.guardX[0] - (p.x + dx * k2)) < 1e-9).toBe(true);
			expect(math.abs(e.guardZ[0] - (p.z + dz * k2)) < 1e-9).toBe(true);
			return;
		}
		error("no stop", 0);
	});

	it("an unscored run staggers it the same and has no feed", () => {
		const { w, t } = guarded("across", false);
		expect(w.s.score).toBe(undefined);
		expect(t.staggers >= 3).toBe(true);
		expect(t.hits).toBe(0);
	});

	it("a guard from straight behind (the Jackal outside the guard cone) does not stop the lunge", () => {
		const { t } = guarded("away");
		expect(t.lunges >= 3).toBe(true);
		expect(t.hits).toBe(t.lunges);
		expect([t.staggers, t.feed.size()]).toEqual([0, 0]);
	});

	it("a rolling player's guard is no parry (no stagger, no feed; the roll's i-frames take the hit)", () => {
		const w = world(1, { scoring: {} });
		w.facing[0] = "across";
		w.guard[0] = true;
		const a = jackal(w, 0, -3.3);
		const p = playerAt(w.s, 0);
		const t = tally();
		let overlaps = 0;
		for (let k = 0; k < 900; k++) {
			if (a.aiState === JACKAL_LUNGE) {
				// Rolling in place (no direction: no dash, the facing zero: the guard cone holds every direction).
				p.rollTicks = 5;
				p.rollDirX = 0;
				p.rollDirZ = 0;
				p.iframeTicks = 5;
			}
			const was = a.aiState;
			tick(w, t);
			if (was === JACKAL_LUNGE && a.v[JACKAL_HIT_BITS] !== 0) overlaps++;
		}
		expect(t.lunges >= 3).toBe(true);
		expect(overlaps >= t.lunges).toBe(true);
		expect([t.staggers, t.feed.size(), t.hits]).toEqual([0, 0, 0]);
	});
});

// ---------------------------------------------------------------------------------------------
// Real endless floors (run WITHOUT endless mode, the floor's breakables as config pieces): a pack of three Jackals on
// neighbouring tiles of a combat room, wandering ghost players. The invariants hold every tick and two runs hash
// identically every tick.

interface Scene {
	readonly config: SimConfig;
	readonly players: ReadonlyArray<readonly [number, number]>;
}

function scene(runSeed: number, floor: number, party: number): Scene | undefined {
	const fl = endlessRunFloor(runSeed, floor, party);
	const d = fl.dungeon;
	const rooms = fl.config.encounter!.rooms;
	const rng = new Rng(runSeed * 41 + floor);
	for (let tries = 0; tries < 40; tries++) {
		const r = rooms[rng.int(0, rooms.size() - 1)];
		if (r.type !== "combat" && r.type !== "elite") continue;
		const tiles: Array<readonly [number, number]> = [];
		const open = new Set<number>();
		for (let gy = 0; gy < d.H; gy++)
			for (let gx = 0; gx < d.W; gx++)
				if (d.roomId[gy * d.W + gx] === r.id && tileAt(d, gx, gy) === TileType.FLOOR) {
					tiles.push([gx, gy]);
					open.add(gy * d.W + gx);
				}
		if (tiles.size() < 30) continue;
		const me = tiles[rng.int(0, tiles.size() - 1)];
		const pack: Array<readonly [number, number]> = [me];
		for (const [dx, dy] of [
			[1, 0],
			[0, 1],
		]) {
			const gx = me[0] + dx;
			const gy = me[1] + dy;
			if (open.has(gy * d.W + gx)) pack.push([gx, gy]);
		}
		if (pack.size() < 3) continue;
		const players: Array<readonly [number, number]> = [];
		for (let k = 0; k < 20 && players.size() < party; k++) {
			const p = tiles[rng.int(0, tiles.size() - 1)];
			const dd = (p[0] - me[0]) * (p[0] - me[0]) + (p[1] - me[1]) * (p[1] - me[1]);
			if (dd >= 9 && dd <= 49) players.push(p);
		}
		if (players.size() < party) continue;
		const config: SimConfig = {
			...fl.config,
			encounter: { ...fl.config.encounter!, spawns: pack.map((t) => ({ kind: JACKAL.id, x: t[0], z: t[1] })) },
			party: party > 1 ? { size: party } : undefined,
		};
		return { config, players };
	}
	return undefined;
}

function wanderer(seed: number): () => InputFrame {
	const rng = new Rng(seed);
	let hold = 0;
	let cur: InputFrame = EMPTY_INPUT;
	const axes = [-AXIS_MAX, 0, AXIS_MAX];
	return () => {
		if (hold <= 0) {
			hold = rng.int(10, 40);
			cur = { ...EMPTY_INPUT, moveX: axes[rng.int(0, 2)], moveZ: axes[rng.int(0, 2)] };
		}
		hold--;
		return cur;
	};
}

interface Played {
	readonly lunges: number;
	readonly starts: number;
	readonly hashes: string[];
}

function play(sc: Scene, seed: number, ticks: number): Played {
	const party = sc.players.size();
	const s = createSimState(seed, sc.players[0][0], sc.players[0][1], sc.config);
	for (let i = 0; i < party; i++) put(s, i, sc.players[i][0], sc.players[i][1]);
	const w: World = { s, config: sc.config, jackals: [], facing: [], guard: [] };
	for (let i = 0; i < party; i++) {
		w.facing.push("keep");
		w.guard.push(false);
	}
	for (const a of s.combat.actors)
		if (a.kind === KIND) {
			engage(a);
			w.jackals.push(a);
		}
	expect(w.jackals.size()).toBe(3);
	const walkers: Array<() => InputFrame> = [];
	for (let i = 0; i < party; i++) walkers.push(wanderer(seed * 7 + i));
	const t = tally();
	const hashes: string[] = [];
	for (let k = 0; k < ticks; k++) {
		const inputs: InputFrame[] = [];
		for (let i = 0; i < party; i++) inputs.push(walkers[i]());
		tick(w, t, inputs);
		hashes.push(hashState(s));
		for (const o of s.combat.actors) if (o.kind !== NO_KIND) expect(o.alive === 0 || o.hp > 0).toBe(true);
	}
	return { lunges: t.lunges, starts: t.starts, hashes };
}

describe("jackal: real endless floors", () => {
	it("solo (8 floors) and co-op (2, 4 floors): packs wind up and lunge, the invariants hold every tick", () => {
		let lunges = 0;
		let starts = 0;
		let scenes = 0;
		for (let rs = 1; rs <= 8; rs++) {
			const sc = scene(rs, 2 + (rs % 3), 1);
			if (sc === undefined) continue;
			scenes++;
			const r = play(sc, rs, 900);
			lunges += r.lunges;
			starts += r.starts;
		}
		for (let rs = 21; rs <= 24; rs++) {
			const sc = scene(rs, 3, 2);
			if (sc === undefined) continue;
			scenes++;
			const r = play(sc, rs, 900);
			lunges += r.lunges;
			starts += r.starts;
		}
		expect(scenes).toBeGreaterThanOrEqual(10);
		expect(starts).toBeGreaterThanOrEqual(10);
		expect(lunges).toBeGreaterThanOrEqual(5);
	});

	it("is deterministic: two identical runs hash identically every tick (solo and a party of two)", () => {
		for (const [rs, party] of [
			[4, 1],
			[23, 2],
		]) {
			const first = play(scene(rs, 3, party)!, rs, 600);
			const second = play(scene(rs, 3, party)!, rs, 600);
			expect(first.hashes.size()).toBe(600);
			expect(second.hashes).toEqual(first.hashes);
		}
	});
});
