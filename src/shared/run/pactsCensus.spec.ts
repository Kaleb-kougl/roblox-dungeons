// Pacts census (docs/FORTUNE.md PS5): measurements with sanity bounds, not a tuning tool (FO13 tunes in play).
//
//   1. Greed's deal by floor (simulated builds): drafts on the real offer function (drawCardOffers, BUILD_RULES, one
//      deal per floor, two after a boss floor), the greedy pick policy (buildOffers.ts pickOffer), each run its own Rng;
//      at floors 2 / 4 / 6 / 11 / 16 the player's build is dealt Greed's deal (drawLegendaryOffers, 3 cards): how often
//      Greed is available (a non-empty legendary pool), the legendary cards per deal, the deals of 3 legendaries, and
//      the deals with fewer than 3 cards.
//   2. Horde on real floors (a sword bot, solo): per run seed, the first floor in 1..6 with altars (earlier floors
//      debug-skipped, drafts dismissed); the bot walks onto the Horde's altar and takes it (no surgery), then walks into
//      the floor's nearest enemy room and fights it until it clears; a twin of the same run that walks the same way
//      without taking the Horde fights the same room. Test-only: hearts topped up every tick (hits are counted), drafts
//      dismissed. Logged per seed and in sum: the room's first wave and wave 2 (telegraphed, spawned), the ticks from the
//      engagement to the trigger, the clear time, hits taken and PERFECT with and without the Horde, the room's points
//      (every award while it was fought) and the HORDE source's share of them.
import { describe, expect, it } from "@rbxts/jest-globals";
import { bulletBlocker, gridToWorld, isBossFloor, lineOfSight, worldToGrid } from "shared/dungeon";
import {
	BOON_COUNT,
	BUILD_RULES,
	Button,
	DEBUG_FLOOR_BUTTON,
	HORDE_NONE,
	NO_KIND,
	PactKind,
	Rng,
	SHRINE_BUTTON,
	SHRINE_RADIUS,
	SIM_HZ,
	ScoreSource,
	archetypeAt,
	cardBoon,
	cardDuo,
	createSimState,
	drawCardOffers,
	drawLegendaryOffers,
	isDraftOpen,
	legendaryPool,
	step,
	type ActorState,
	type InputFrame,
	type SimState,
} from "shared/sim";
import { buildEndlessRunConfig, type EndlessRunSetup } from "shared/run";
import { dismissDraft, distanceField, frame, pickOffer, walkDir, type Field } from "shared/run/testing";

// --- 1. Greed's deal by floor ------------------------------------------------------------------------------

const DEAL_RUNS = 400;
const DEAL_CHECKPOINTS: ReadonlyArray<number> = [2, 4, 6, 11, 16];
const DEAL_SEED_MUL = 0x85ebca6b;
const LEGENDARY_CARDS = 3;

interface DealTally {
	readonly floor: number;
	runs: number;
	available: number;
	legendary: number;
	full: number;
	short: number;
	cards: number;
}

function dealCensus(): DealTally[] {
	const tallies: DealTally[] = DEAL_CHECKPOINTS.map((floor) => ({
		floor,
		runs: 0,
		available: 0,
		legendary: 0,
		full: 0,
		short: 0,
		cards: 0,
	}));
	const last = DEAL_CHECKPOINTS[DEAL_CHECKPOINTS.size() - 1];
	for (let run = 1; run <= DEAL_RUNS; run++) {
		const rng = new Rng(run * DEAL_SEED_MUL);
		const policyRng = new Rng(run);
		const levels: number[] = [];
		for (let b = 0; b < BOON_COUNT; b++) levels.push(0);
		const duos: number[] = [];
		for (let floor = 1; floor <= last; floor++) {
			// the build a player walks onto `floor` with: Greed's deal there
			for (const t of tallies) {
				if (t.floor !== floor) continue;
				t.runs++;
				const pool = legendaryPool(levels, duos);
				if (pool.size() === 0) continue;
				t.available++;
				const deal = drawLegendaryOffers(new Rng(run * 7 + floor), levels, duos, LEGENDARY_CARDS);
				let legendary = 0;
				for (const c of deal) if (pool.includes(c)) legendary++;
				t.legendary += legendary;
				t.cards += deal.size();
				if (legendary === LEGENDARY_CARDS) t.full++;
				if (deal.size() < LEGENDARY_CARDS) t.short++;
			}
			// the floor's draft(s)
			const deals = isBossFloor(floor) ? BUILD_RULES.bossFloorDrafts : BUILD_RULES.floorDrafts;
			for (let d = 0; d < deals; d++) {
				const offers = drawCardOffers(rng, BUILD_RULES, levels, duos, floor, isBossFloor(floor) && d === 0);
				if (offers.size() === 0) continue;
				const card = offers[pickOffer("greedy", levels, offers, policyRng)];
				const duo = cardDuo(card);
				if (duo >= 0) duos.push(duo);
				else levels[cardBoon(card)]++;
			}
		}
	}
	return tallies;
}

const pct = (a: number, b: number) => (b > 0 ? string.format("%.1f%%", (100 * a) / b) : "-");
const mean = (a: number, b: number) => (b > 0 ? string.format("%.2f", a / b) : "-");

describe("pacts census (PS5): Greed's deal by floor", () => {
	it("logs availability and the legendary share of the deal", () => {
		const tallies = dealCensus();
		print(
			`[PS5 Greed deal] ${DEAL_RUNS} simulated runs (greedy picks); by floor: available, legendary / deal, 3 of 3, short`,
		);
		for (const t of tallies) {
			print(
				`  floor ${t.floor}: available ${pct(t.available, t.runs)}, legendary cards ${mean(
					t.legendary,
					t.available,
				)}, ` +
					`all legendary ${pct(t.full, t.available)}, under 3 cards ${pct(t.short, t.available)}, ` +
					`cards ${mean(t.cards, t.available)}`,
			);
			expect(t.runs).toBe(DEAL_RUNS);
			// the two legendary boons are unowned early, so Greed is (nearly) always available
			expect(t.available > 0).toBe(true);
		}
		// floor 2: a build of 1 card; the pool is the two legendaries (one when the first pick was one of them)
		expect(tallies[0].legendary / tallies[0].available > 1.5).toBe(true);
	});
});

// --- 2. Horde on real floors ------------------------------------------------------------------------------

const HORDE_SEEDS: ReadonlyArray<number> = [1337, 4242, 90210, 7, 11, 23, 31, 47];
const ALTAR_FLOORS = 6;
const WALK_TICKS = 40 * SIM_HZ;
const FIGHT_TICKS = 90 * SIM_HZ;
const MELEE_RANGE = 1.2;
const CHASE_RANGE = 8;
const WALK_STUCK_TICKS = 20;
const WALK_STUCK_ATTACK_TICKS = 30;
const WALK_STUCK_EPS = 1e-3;

function dist2(ax: number, az: number, bx: number, bz: number): number {
	const dx = ax - bx;
	const dz = az - bz;
	return dx * dx + dz * dz;
}

function unit(dx: number, dz: number): [number, number] {
	const len = math.sqrt(dx * dx + dz * dz);
	return len > 1e-9 ? [dx / len, dz / len] : [0, 0];
}

/** The census sword bot (pelletsCensus.spec.ts's fight, no pellets). */
class HordeBot {
	readonly state: SimState;
	private readonly fields = new Map<string, Field>();
	hits = 0;

	constructor(readonly setup: EndlessRunSetup, readonly seed: number) {
		const spawn = setup.spawn!;
		this.state = createSimState(seed, spawn.x, spawn.z, setup.config);
	}

	floor(): number {
		return this.state.endless!.floor;
	}

	world() {
		return this.setup.endlessFloor(this.floor());
	}

	tick(input: InputFrame): void {
		const p = this.state.player;
		p.hearts = p.heartsMax; // test-only: the census bot never dies
		step(this.state, input, this.setup.config);
		this.hits += this.state.events.playerHits;
		if (isDraftOpen(this.state)) dismissDraft(this.state);
	}

	private field(tx: number, tz: number): Field {
		const gx = worldToGrid(tx);
		const gz = worldToGrid(tz);
		const key = `${this.floor()}:${gx}:${gz}`;
		let f = this.fields.get(key);
		if (f === undefined) {
			const w = this.world();
			const blocked = new Set<number>();
			for (const b of w.breakables ?? []) blocked.add(b.y * w.dungeon.W + b.x);
			f = distanceField(w.dungeon, gridToWorld(gx), gridToWorld(gz), [w.stairX, w.stairZ], blocked);
			this.fields.set(key, f);
		}
		return f;
	}

	dirTo(tx: number, tz: number): [number, number] {
		const p = this.state.player;
		if (lineOfSight(bulletBlocker(this.world().dungeon), p.x, p.z, tx, tz)) return unit(tx - p.x, tz - p.z);
		return walkDir(this.field(tx, tz), p.x, p.z);
	}

	/**
	 * Walks the path field to (tx, tz) until done() or the budget runs out; rolls now and then; pinned against a body (a
	 * breakable, an enemy) for WALK_STUCK_TICKS it attacks along its walk for WALK_STUCK_ATTACK_TICKS (the endless
	 * bot's walk).
	 */
	walkTo(tx: number, tz: number, done: () => boolean, maxTicks: number): void {
		const startFloor = this.floor();
		const p = this.state.player;
		let n = 0;
		let still = 0;
		let attack = 0;
		let lastX = p.x;
		let lastZ = p.z;
		while (n < maxTicks && !done() && this.floor() === startFloor) {
			const [mx, mz] = walkDir(this.field(tx, tz), p.x, p.z);
			if (still >= WALK_STUCK_TICKS) {
				attack = WALK_STUCK_ATTACK_TICKS;
				still = 0;
			}
			let buttons: number = n % 50 === 25 ? Button.ROLL : 0;
			const attacking = attack > 0;
			if (attacking) {
				buttons = bit32.bor(buttons, Button.FIRE);
				attack--;
			}
			this.tick(frame(mx, mz, buttons, attacking ? mx : 0, attacking ? mz : 0));
			const moved = math.abs(p.x - lastX) + math.abs(p.z - lastZ) > WALK_STUCK_EPS;
			still = moved || (mx === 0 && mz === 0) ? 0 : still + 1;
			lastX = p.x;
			lastZ = p.z;
			n++;
		}
	}

	skipTo(floor: number): void {
		while (this.floor() < floor) {
			this.tick(frame(0, 0, DEBUG_FLOOR_BUTTON));
			this.tick(frame(0, 0));
		}
	}

	private target(roomId: number): ActorState | undefined {
		const p = this.state.player;
		const w = this.world();
		let best: ActorState | undefined;
		let bestD = math.huge;
		for (const a of this.state.combat.actors) {
			if (a.kind === NO_KIND || a.alive === 0 || archetypeAt(a.kind).data.boss === true) continue;
			const d = dist2(a.x, a.z, p.x, p.z);
			if (w.roomIdAt(a.x, a.z) !== roomId && d > CHASE_RANGE * CHASE_RANGE) continue;
			if (d < bestD) {
				bestD = d;
				best = a;
			}
		}
		return best;
	}

	/** Fights until record `rec` cleared (or the budget runs out); returns the ticks fought. */
	fight(roomId: number, rec: number): number {
		const s = this.state;
		let n = 0;
		while (n < FIGHT_TICKS && s.score!.rooms[rec].cleared === 0) {
			const a = this.target(roomId);
			const p = s.player;
			if (a !== undefined) {
				const near = dist2(a.x, a.z, p.x, p.z) <= MELEE_RANGE * MELEE_RANGE;
				const [ax, az] = unit(a.x - p.x, a.z - p.z);
				const [mx, mz] = near ? [0, 0] : this.dirTo(a.x, a.z);
				this.tick(frame(mx, mz, Button.FIRE, ax, az));
			} else {
				// between the waves (the telegraph): back to the room's centre
				const r = this.world().config.encounter!.rooms[roomId];
				const [mx, mz] = this.dirTo(r.cx, r.cz);
				this.tick(frame(mx, mz));
			}
			n++;
		}
		return n;
	}
}

interface HordeRow {
	readonly seed: number;
	readonly floor: number;
	readonly room: number;
	planned: number;
	firstWave: number;
	telegraphed: number;
	spawned: number;
	triggerTicks: number;
	clearTicks: number;
	cleared: boolean;
	hits: number;
	perfect: boolean;
	points: number;
	horde: number;
	twinClearTicks: number;
	twinCleared: boolean;
	twinHits: number;
	twinPerfect: boolean;
	twinPoints: number;
}

/** One seed: the Horde run and its twin (see the file comment); undefined when no floor 1..6 has altars. */
function hordeSeed(seed: number): HordeRow | undefined {
	const setup = buildEndlessRunConfig(seed);
	let floor = -1;
	for (let f = 1; f <= ALTAR_FLOORS && floor < 0; f++) if (setup.endlessFloor(f).pactAltars !== undefined) floor = f;
	if (floor < 0) return undefined;
	const play = (take: boolean) => {
		const bot = new HordeBot(buildEndlessRunConfig(seed), seed);
		bot.skipTo(floor);
		const w = bot.world();
		const altar = w.pactAltars!.altars[PactKind.HORDE];
		const p = bot.state.player;
		const onAltar = () => dist2(p.x, p.z, altar.x, altar.z) < SHRINE_RADIUS * SHRINE_RADIUS * 0.25;
		bot.walkTo(altar.x, altar.z, onAltar, WALK_TICKS);
		expect(onAltar()).toBe(true);
		if (take) bot.tick(frame(0, 0, SHRINE_BUTTON));
		else bot.tick(frame(0, 0));
		bot.tick(frame(0, 0));
		// the nearest enemy room not entered yet (by its first planned spawn), walked into
		const rooms = w.config.encounter!.rooms;
		let room = -1;
		let best = math.huge;
		for (let id = 0; id < w.roomSpawns.size(); id++) {
			if (w.roomSpawns[id].size() === 0 || id === w.config.encounter!.bossRoom) continue;
			if (bot.state.endless!.roomsEntered[id] !== 0) continue;
			const d = dist2(rooms[id].cx, rooms[id].cz, p.x, p.z);
			if (d < best) {
				best = d;
				room = id;
			}
		}
		expect(room >= 0).toBe(true);
		const sp = w.roomSpawns[room][0];
		const total0 = bot.state.score!.total;
		const horde0 = bot.state.score!.points[ScoreSource.HORDE];
		const hits0 = bot.hits;
		const perfect0 = bot.state.score!.counts[ScoreSource.PERFECT];
		// walk in; the first room entered on the way is the one fought (and, with the Horde, the horde room)
		let entered = -1;
		bot.walkTo(
			sp.x,
			sp.z,
			() => {
				const e = bot.state.events.roomEntered;
				if (e !== 0 && w.roomSpawns[e - 1].size() > 0) entered = e - 1;
				return entered >= 0;
			},
			WALK_TICKS,
		);
		expect(entered >= 0).toBe(true);
		const rec = bot.state.score!.rooms.findIndex((r) => r.room === entered);
		const engage = bot.state.tick;
		const firstWave = bot.state.score!.rooms[rec].memberSlots.size();
		let trigger = -1;
		const s = bot.state;
		const ticks = bot.fight(entered, rec);
		const h = s.pacts!.horde;
		if (take) {
			expect(h.room).toBe(entered);
			if (h.waveDueTick !== HORDE_NONE) trigger = h.waveDueTick - s.pacts!.config.waveTelegraphTicks - engage;
		}
		return {
			room: entered,
			planned: w.roomSpawns[entered].size(),
			firstWave,
			telegraphed: take ? h.waveKinds.size() : 0,
			spawned: take ? math.max(h.spawned, 0) : 0,
			trigger,
			ticks,
			cleared: s.score!.rooms[rec].cleared === 1,
			hits: bot.hits - hits0,
			perfect: s.score!.counts[ScoreSource.PERFECT] > perfect0,
			points: s.score!.total - total0,
			horde: s.score!.points[ScoreSource.HORDE] - horde0,
		};
	};
	const a = play(true);
	const b = play(false);
	expect(b.room).toBe(a.room);
	return {
		seed,
		floor,
		room: a.room,
		planned: a.planned,
		firstWave: a.firstWave,
		telegraphed: a.telegraphed,
		spawned: a.spawned,
		triggerTicks: a.trigger,
		clearTicks: a.ticks,
		cleared: a.cleared,
		hits: a.hits,
		perfect: a.perfect,
		points: a.points,
		horde: a.horde,
		twinClearTicks: b.ticks,
		twinCleared: b.cleared,
		twinHits: b.hits,
		twinPerfect: b.perfect,
		twinPoints: b.points,
	};
}

describe("pacts census (PS5): the Horde on real floors (sword bot, solo)", () => {
	it("logs each seed's horde room against its twin", () => {
		const rows: HordeRow[] = [];
		for (const seed of HORDE_SEEDS) {
			const row = hordeSeed(seed);
			if (row !== undefined) rows.push(row);
		}
		print(
			"[PS5 Horde] seed floor room: wave1 / wave2 (telegraphed, spawned), trigger s, clear s (twin), hits (twin), PERFECT (twin), points (twin), HORDE share",
		);
		let sumHorde = 0;
		let sumPoints = 0;
		let sumTwin = 0;
		let clears = 0;
		let twinClears = 0;
		for (const r of rows) {
			print(
				`  ${r.seed} f${r.floor} r${r.room}: ${r.firstWave} / ${r.telegraphed}, ${r.spawned}; trigger ` +
					`${
						r.triggerTicks >= 0 ? string.format("%.1f s", r.triggerTicks / SIM_HZ) : "none"
					}; clear ${string.format("%.1f", r.clearTicks / SIM_HZ)} s ` +
					`(${string.format("%.1f", r.twinClearTicks / SIM_HZ)} s)${r.cleared ? "" : " NOT CLEARED"}; hits ${
						r.hits
					} ` +
					`(${r.twinHits}); PERFECT ${r.perfect ? "yes" : "no"} (${r.twinPerfect ? "yes" : "no"}); points ` +
					`${r.points} (${r.twinPoints}); HORDE ${pct(r.horde, r.points)}`,
			);
			sumHorde += r.horde;
			sumPoints += r.points;
			sumTwin += r.twinPoints;
			if (r.cleared) clears++;
			if (r.twinCleared) twinClears++;
			expect(r.firstWave > 0).toBe(true);
			if (r.triggerTicks >= 0) expect(r.telegraphed).toBe(math.min(r.planned, 10));
			expect(r.spawned <= r.telegraphed).toBe(true);
		}
		print(
			`  sum: ${rows.size()} seeds, cleared ${clears} (twin ${twinClears}), points ${sumPoints} vs ${sumTwin} ` +
				`(x${string.format("%.2f", sumPoints / math.max(1, sumTwin))}), HORDE ${pct(
					sumHorde,
					sumPoints,
				)} of the horde rooms' points`,
		);
		expect(rows.size() >= 6).toBe(true);
		expect(clears > 0).toBe(true);
		expect(sumHorde > 0).toBe(true);
	});
});
