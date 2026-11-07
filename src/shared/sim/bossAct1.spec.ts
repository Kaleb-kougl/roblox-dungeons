// 'boss.act1' (E1.8; source: `src/sim/actors/archetypes/boss/act1.test.ts` @ 42897e2): the GDD boss rules checked on
// real fights in real dungeons (seed 1337 and 42), driven by scripted players through the full sim (step(), the game's
// SimConfig with dungeon collision; the rules with the placeholder gun weapon.test pinned as the loadout):
//   - engage on entering the boss room (bossEngaged, phase 1), immune while dormant, the arena seal
//   - phases at 66% / 33% hp: bossPhase 2 / 3, hp stops on the threshold, immune roar, own bullets cleared
//   - every attack telegraphs >= 30 ticks (events.telegraphs on its start) and no bullet leaves outside an attack
//   - every burst leaves a gap wider than the player (diameter + margin) at the player's distance
//   - each phase adds one pattern and remixes one; never the same attack 3 times in a row (10 minutes of fight)
//   - the per-second damage cap holds
//   - time to kill for a decent player with the placeholder gun: 1.5..4 minutes (TTK with the real sword / bow:
//     bossAct1.ttk.spec.ts)
//   - phase-3 slams summon up to 3 engaged swarmers (the game's encounter, MAX_ACTORS respected), replays identical
//   - bossDefeated on the death tick
//   - live play (irregular frames) == runReplay, with the boss engaged, debug boss hits (J) included
//
// Port notes: the bots use V8's Math.hypot (`hypot2`) and JS Math.round (`jsRound`), so they press exactly the same
// inputs as the web build's bots. The playtest telemetry is not part of this workspace: the telemetry test checks the
// event stream it is fed from (same order) instead. `spawnFromQuery` (a URL query parser) has no Roblox counterpart:
// `runSpawn(d, atBossDoor)` is checked instead. The per-tick "new bullet" scan tracks live slots in a map instead of
// refilling a capacity-sized array every tick (same result, much faster under Lune).
import { afterAll, describe, expect, it } from "@rbxts/jest-globals";
import {
	DEFAULT_ENCOUNTER,
	ENEMY_BUDGET,
	KALEB_VALE_MVP_PARAMS,
	TileType,
	actorMover,
	bossDoorSpawn,
	bulletBlocker,
	circleMover,
	entranceSpawn,
	generateDungeon,
	placeEncounter,
	runSpawn,
	tileAt,
	worldToGrid,
	type Dungeon,
} from "shared/dungeon";
import { hypot2, jsRound, stableSort } from "shared/jsmath";
import {
	AXIS_MAX,
	AiState,
	BOSS_ACT1_DATA,
	BOSS_ACT1_ID,
	BOSS_TELEGRAPH_TICKS,
	BossAttack,
	BossState,
	BulletKind,
	BulletPayload,
	Button,
	CORPSE_TICKS,
	DAMAGE_CAP_BUCKETS,
	DAMAGE_CAP_BUCKET_TICKS,
	DAMAGE_CAP_WINDOW_SECONDS,
	EMPTY_INPUT,
	ENEMY_BULLET_RADIUS,
	FixedStepLoop,
	MAX_ACTORS,
	MAX_REPEAT,
	NO_KIND,
	PHASE_ATTACKS,
	PHASE_FIRST_ATTACK,
	PLAYER_RADIUS,
	Recorder,
	Rng,
	SIM_DT,
	SIM_HZ,
	SUMMON_COUNT,
	SUMMON_MAX_ALIVE,
	SimCtx,
	V_AGGRO,
	createSimState,
	hasArchetype,
	hashState,
	runReplay,
	step,
	type ActorState,
	type InputFrame,
	type SimConfig,
	type SimState,
	WEB_BOSS_HP,
	WEB_SWARMER_HP,
	setBossHp,
	setSwarmerHp,
} from "shared/sim";

// The boss's adds are swarmers; these fights, TTKs and summon counts were tuned with the web build's 2-hp swarmers
// (the port's are 1 hp, CLAUDE.md decision log), so this file runs under WEB_SWARMER_HP. Set at load, not in a
// beforeAll: describe bodies may run fights while the specs are collected.
const portSwarmerHp = setSwarmerHp(WEB_SWARMER_HP);
const portBossHp = setBossHp(WEB_BOSS_HP); // the web boss's 540 hp (port: 270)
afterAll(() => {
	setSwarmerHp(portSwarmerHp);
	setBossHp(portBossHp);
});

const D = BOSS_ACT1_DATA;
/** The tuned hp (README: "Time to kill"). */
const BOSS_HP = 540;
const BOSS_CAP = 6;
const SECONDS = (ticks: number) => ticks / SIM_HZ;
/** Room the player needs to slip between two bullets: its diameter plus this margin, world units. */
const GAP_MARGIN = 0.2;

const clamp1 = (v: number) => math.max(-1, math.min(1, v));
/** `Math.hypot(x, z) || 1`. */
const lenOr1 = (x: number, z: number) => {
	const h = hypot2(x, z);
	return h !== 0 && h === h ? h : 1;
};

// ---------------------------------------------------------------------------------------------
// Harness

interface Fight {
	d: Dungeon;
	config: SimConfig;
	state: SimState;
	boss: ActorState;
	spawn: { x: number; z: number };
}

/** The E1.6 placeholder gun (+ swing on SWAP) these rules were first written against. */
const GUN_LOADOUT: ReadonlyArray<string> = ["weapon.test", "weapon.test.melee"];

function setupFight(seed: number, loadout: ReadonlyArray<string | undefined> = GUN_LOADOUT): Fight {
	const d = generateDungeon({ ...KALEB_VALE_MVP_PARAMS, seed });
	const config: SimConfig = {
		moveResolver: circleMover(d, PLAYER_RADIUS),
		isBulletBlocked: bulletBlocker(d),
		actorMover: actorMover(d),
		encounter: placeEncounter(d, { boss: BOSS_ACT1_ID }),
		loadout,
	};
	const spawn = bossDoorSpawn(d)!;
	const state = createSimState(seed, spawn.x, spawn.z, config);
	return { d, config, state, boss: state.combat.actors[0], spawn };
}

interface BotOptions {
	/** Fraction of each 1 s cycle with FIRE held (1 = always). */
	duty: number;
	/** Stop firing once the boss reaches this phase (keeps it alive for long fights). */
	holdFireAtPhase?: number;
	/** Chance per tick to start a dodge roll. */
	rollChance: number;
	/** Chance per tick to press DEBUG_BOSS (J). */
	debugChance?: number;
	/** Drink a flask at <= 3 half hearts, use an Ember at <= 2 (for runs without god mode). */
	heal?: boolean;
	/** Tap FIRE once every this many ticks instead of holding it (one volley per tap: a slower weapon's DPS). */
	tapEvery?: number;
}

type Bot = (s: SimState, boss: ActorState) => InputFrame;

/**
 * A scripted "decent player": walks into the room, then circle-strafes the boss at mid-range (~6 units), always aiming
 * at it, holding FIRE for `duty` of every second, rolling now and then.
 */
function makeBot(seed: number, opts: BotOptions): Bot {
	const rng = new Rng(seed);
	let strafe = 1;
	let lastX = 0 / 0;
	let lastZ = 0 / 0;
	let stuck = 0;
	let n = 0;
	return (s, boss) => {
		n++;
		const p = s.player;
		const dx = boss.x - p.x;
		const dz = boss.z - p.z;
		const dist = lenOr1(dx, dz);
		const ux = dx / dist;
		const uz = dz / dist;
		let mx: number;
		let mz: number;
		if (boss.aiState === BossState.DORMANT) {
			mx = ux;
			mz = uz;
		} else {
			if (hypot2(p.x - lastX, p.z - lastZ) < 0.02) stuck++;
			else stuck = 0;
			if (stuck > 10 || rng.next() < 1 / 240) {
				strafe = -strafe;
				stuck = 0;
			}
			const radial = clamp1((dist - 6) * 0.5);
			mx = -uz * strafe * 0.8 + ux * radial;
			mz = ux * strafe * 0.8 + uz * radial;
			const m = lenOr1(mx, mz);
			mx /= m;
			mz /= m;
		}
		lastX = p.x;
		lastZ = p.z;
		let buttons = 0;
		const firing =
			n % SIM_HZ < opts.duty * SIM_HZ &&
			!(opts.holdFireAtPhase !== undefined && boss.phase >= opts.holdFireAtPhase);
		if (firing && (opts.tapEvery === undefined || opts.tapEvery === 0 || n % opts.tapEvery === 0)) {
			buttons = bit32.bor(buttons, Button.FIRE);
		}
		if (opts.heal === true && p.hearts <= 3 && n % 2 === 0) buttons = bit32.bor(buttons, Button.FLASK);
		if (opts.heal === true && p.hearts <= 2 && n % 2 === 1) buttons = bit32.bor(buttons, Button.EMBER);
		if (boss.aiState !== BossState.DORMANT && rng.next() < opts.rollChance)
			buttons = bit32.bor(buttons, Button.ROLL);
		if (opts.debugChance !== undefined && opts.debugChance !== 0 && rng.next() < opts.debugChance) {
			buttons = bit32.bor(buttons, Button.DEBUG_BOSS);
		}
		return {
			moveX: jsRound(mx * AXIS_MAX),
			moveZ: jsRound(mz * AXIS_MAX),
			aimX: jsRound(ux * AXIS_MAX),
			aimZ: jsRound(uz * AXIS_MAX),
			buttons,
		};
	};
}

/** One new bullet of this tick: direction (unit) and its origin (position one step back). */
interface NewBullet {
	dx: number;
	dz: number;
	ox: number;
	oz: number;
}

interface TickLog {
	tick: number;
	prevState: number;
	prevAttack: number;
	state: number;
	attack: number;
	phase: number;
	hp: number;
	x: number;
	z: number;
	px: number;
	pz: number;
	telegraphs: number;
	bossPhase: number;
	bossEngaged: number;
	bossDefeated: number;
	damageDealt: number;
	enemyHits: number;
	bossBullets: number;
	newBullets: NewBullet[];
	/** Live actors other than the boss before the tick (its swarmer adds): their telegraphs share events.telegraphs. */
	addsBefore: number;
	/** Live swarmers after the tick, and how many actors were spawned in it. */
	swarmers: number;
	actorsSpawned: number;
}

function liveAdds(s: SimState, boss: ActorState): number {
	let n = 0;
	for (const o of s.combat.actors) if (o !== boss && o.alive !== 0) n++;
	return n;
}

function liveSwarmers(s: SimState): number {
	const kind = new SimCtx().kindOf("swarmer");
	let n = 0;
	for (const o of s.combat.actors) if (o.alive !== 0 && o.kind === kind) n++;
	return n;
}

interface FightLog {
	fight: Fight;
	ticks: TickLog[];
	deathTick: number;
	engageTick: number;
}

/** Runs a fight tick by tick (no frame loop) with the player refilled to full hearts ("god mode": TTK only). */
function runFight(
	seed: number,
	maxTicks: number,
	bot: Bot,
	god = true,
	loadout: ReadonlyArray<string | undefined> = GUN_LOADOUT,
): FightLog {
	const fight = setupFight(seed, loadout);
	const { state, boss, config } = fight;
	const ticks: TickLog[] = [];
	// Life of every live boss-or-other bullet by slot, last tick / this tick (absent = not live).
	let prevLife = new Map<number, number>();
	const snap: number[] = [];
	let deathTick = -1;
	let engageTick = -1;
	let lostOnSpawn = 0;
	/** Ticks where more new bullets were seen than spawned (the source asserts this per tick). */
	const tooMany: number[] = [];
	for (let i = 0; i < maxTicks && deathTick < 0; i++) {
		const prevState = boss.aiState;
		const prevAttack = boss.attack;
		const spawnedBefore = state.combat.enemySpawned;
		const addsBefore = liveAdds(state, boss);
		step(state, bot(state, boss), config);
		if (god) state.player.hearts = state.player.heartsMax;
		const e = state.events;
		// New bullets: slots that were not live last tick, or whose life went up (slot reused).
		snap.clear();
		state.combat.enemyBullets.writeStateHash(snap);
		const curLife = new Map<number, number>();
		const newBullets: NewBullet[] = [];
		for (let k = 0; k < snap.size(); k += 10) {
			const idx = snap[k];
			const life = snap[k + 7];
			curLife.set(idx, life);
			if (snap[k + 9] !== boss.emitterId) continue;
			const before = prevLife.get(idx);
			if (before === undefined || life > before) {
				const vx = snap[k + 4];
				const vz = snap[k + 6];
				const v = hypot2(vx, vz);
				newBullets.push({
					dx: vx / v,
					dz: vz / v,
					ox: snap[k + 1] - vx * SIM_DT,
					oz: snap[k + 3] - vz * SIM_DT,
				});
			}
		}
		prevLife = curLife;
		// Bullets fired this tick are all still here, except: a phase transition on this tick clears them, and a bullet
		// can land on the player or in a wall within its first step (a slam next to either), and a sword swing or guard
		// can delete them on the tick they appear (point-blank melee).
		const spawned = state.combat.enemySpawned - spawnedBefore;
		if (newBullets.size() > spawned) tooMany.push(state.tick - 1);
		if (newBullets.size() < spawned && e.bossPhase === 0 && e.bulletsDeleted === 0) lostOnSpawn++;
		ticks.push({
			tick: state.tick - 1,
			prevState,
			prevAttack,
			state: boss.aiState,
			attack: boss.attack,
			phase: boss.phase,
			hp: boss.hp,
			x: boss.x,
			z: boss.z,
			px: state.player.x,
			pz: state.player.z,
			telegraphs: e.telegraphs,
			bossPhase: e.bossPhase,
			bossEngaged: e.bossEngaged,
			bossDefeated: e.bossDefeated,
			damageDealt: e.damageDealt,
			enemyHits: e.enemyHits,
			bossBullets: state.combat.enemyBullets.activeCountFor(boss.emitterId),
			newBullets,
			addsBefore,
			swarmers: liveSwarmers(state),
			actorsSpawned: e.actorsSpawned,
		});
		if (e.bossEngaged !== 0) engageTick = state.tick - 1;
		if (boss.alive === 0 && deathTick < 0) deathTick = state.tick - 1;
	}
	expect(tooMany).toEqual([]);
	// Rare (slams only): the gap checks below see almost every burst whole.
	expect(lostOnSpawn).toBeLessThanOrEqual(math.max(3, ticks.size() / 3000));
	return { fight, ticks, deathTick, engageTick };
}

/** The sequence of telegraphed attacks (attack id, phase, tick, telegraph length). */
interface TelegraphRun {
	attack: number;
	phase: number;
	start: number;
	length: number;
	/** Cut short by a phase transition (the hit that crossed a threshold): no attack follows. */
	interrupted: boolean;
}

function telegraphRuns(log: FightLog): TelegraphRun[] {
	const out: TelegraphRun[] = [];
	let cur: TelegraphRun | undefined;
	for (const t of log.ticks) {
		if (t.state === AiState.TELEGRAPH) {
			if (cur === undefined || t.prevState !== AiState.TELEGRAPH) {
				cur = { attack: t.attack, phase: t.phase, start: t.tick, length: 0, interrupted: false };
				out.push(cur);
			}
			cur.length++;
		} else {
			if (cur !== undefined && t.state === BossState.TRANSITION) cur.interrupted = true;
			cur = undefined;
		}
	}
	return out;
}

/**
 * Per-tick checks are collected (one `expect` at the end instead of one per tick: jest's expect is slow under Lune).
 * A failure lists every offending tick, so nothing is weaker than the source's per-tick assertions.
 */
function failures(): { check(ok: boolean, what: string): void; list: string[] } {
	const list: string[] = [];
	return {
		list,
		check(ok, what) {
			if (!ok && list.size() < 20) list.push(what);
		},
	};
}

function contains(arr: ReadonlyArray<number>, v: number): boolean {
	return arr.includes(v);
}

function walkInput(dx: number, dz: number, buttons = 0): InputFrame {
	const m = hypot2(dx, dz);
	return { ...EMPTY_INPUT, moveX: jsRound((dx / m) * AXIS_MAX), moveZ: jsRound((dz / m) * AXIS_MAX), buttons };
}

// ---------------------------------------------------------------------------------------------
// Data-level rules

describe("boss.act1 data", () => {
	it("is a registered boss with a damage cap, heavy contact damage and a theme sprite", () => {
		expect(hasArchetype(BOSS_ACT1_ID)).toBe(true);
		expect(D.boss).toBe(true);
		expect(D.damageCapPerSecond).toBe(BOSS_CAP);
		expect(D.hp / D.damageCapPerSecond!).toBeGreaterThanOrEqual(90);
		expect(D.hp).toBe(BOSS_HP);
		expect(D.contactDamage).toBe(2);
		expect(D.spriteId).toBe("boss.act1");
		expect([...D.phaseHp]).toEqual([0.66, 0.33]);
	});

	it("every attack winds up for at least 0.5 s (30 ticks)", () => {
		for (const phase of [1, 2, 3]) {
			for (const a of PHASE_ATTACKS[phase]) expect(BOSS_TELEGRAPH_TICKS[a]).toBeGreaterThanOrEqual(30);
		}
	});

	it("three phases: each adds exactly one new pattern and remixes exactly one old one", () => {
		const p1 = PHASE_ATTACKS[1];
		const p2 = PHASE_ATTACKS[2];
		const p3 = PHASE_ATTACKS[3];
		const minus = (a: ReadonlyArray<number>, b: ReadonlyArray<number>) => a.filter((x) => !contains(b, x));
		expect([...p1]).toEqual([BossAttack.FAN, BossAttack.RING]);
		// Phase 2: + spiral (new), ring -> double ring (remix).
		expect(minus(p2, p1)).toEqual([BossAttack.DOUBLE_RING, BossAttack.SPIRAL]);
		expect(minus(p1, p2)).toEqual([BossAttack.RING]);
		// Phase 3: + slam (new), fan -> fast fan (remix).
		expect(minus(p3, p2)).toEqual([BossAttack.FAST_FAN, BossAttack.SLAM]);
		expect(minus(p2, p3)).toEqual([BossAttack.FAN]);
		expect([PHASE_FIRST_ATTACK[1], PHASE_FIRST_ATTACK[2], PHASE_FIRST_ATTACK[3]]).toEqual([
			BossAttack.FAN,
			BossAttack.SPIRAL,
			BossAttack.SLAM,
		]);
		expect(PHASE_FIRST_ATTACK.size()).toBe(4);
	});

	it("time to kill can never drop under 1.5 minutes: hp / cap + the immune roars (a flawless 100%-uptime floor)", () => {
		const floorSeconds = D.hp / D.damageCapPerSecond! + SECONDS(D.introTicks + 2 * D.transitionTicks);
		expect(floorSeconds).toBeGreaterThanOrEqual(90);
	});
});

// ---------------------------------------------------------------------------------------------
// Engagement, seal, immunity

describe("boss.act1 engagement", () => {
	for (const seed of [1337, 42, 1, 7]) {
		it(`seed ${seed}: dormant and immune until the player walks in, then bossEngaged + phase 1 once`, () => {
			const fight = setupFight(seed);
			const { state, boss, config } = fight;
			const room = config.encounter!.rooms[config.encounter!.bossRoom];
			expect(boss.kind).toBe(new SimCtx().kindOf(BOSS_ACT1_ID));
			expect(boss.x).toBe(room.cx);
			expect(boss.z).toBe(room.cz);
			// The spawn is outside the room: a few dormant ticks first.
			for (let i = 0; i < 20; i++) step(state, EMPTY_INPUT, config);
			expect(boss.aiState).toBe(BossState.DORMANT);
			expect(boss.phase).toBe(0);
			expect(state.combat.enemySpawned).toBe(0);
			// Immune while dormant (no sniping from the corridor).
			const ctx = new SimCtx().bind(state, config, EMPTY_INPUT);
			expect(ctx.damageActor(boss, 50)).toBe(0);
			expect(boss.hp).toBe(D.hp);
			// Walk in.
			let engaged = 0;
			let engageTick = -1;
			for (let i = 0; i < 600 && engaged === 0; i++) {
				step(state, walkInput(boss.x - state.player.x, boss.z - state.player.z), config);
				engaged += state.events.bossEngaged;
				if (state.events.bossEngaged !== 0) {
					engageTick = state.tick;
					expect(state.events.bossPhase).toBe(1);
				}
			}
			expect(engaged).toBe(1);
			const p = state.player;
			expect(p.x).toBeGreaterThanOrEqual(room.minX + D.engageInset);
			expect(p.x).toBeLessThanOrEqual(room.maxX - D.engageInset);
			expect(p.z).toBeGreaterThanOrEqual(room.minZ + D.engageInset);
			expect(p.z).toBeLessThanOrEqual(room.maxZ - D.engageInset);
			expect(boss.phase).toBe(1);
			expect(boss.aiState).toBe(BossState.TRANSITION); // intro roar
			// Never again in this run.
			for (let i = 0; i < 300; i++) {
				step(state, EMPTY_INPUT, config);
				expect(state.events.bossEngaged).toBe(0);
			}
			expect(engageTick).toBeGreaterThan(20);
		});
	}

	it("the arena is sealed while the fight is on: walking back out the door is impossible", () => {
		const fight = setupFight(1337);
		const { state, boss, config, spawn } = fight;
		const room = config.encounter!.rooms[config.encounter!.bossRoom];
		// In, until engaged.
		for (let i = 0; i < 600 && boss.aiState === BossState.DORMANT; i++) {
			step(state, walkInput(boss.x - state.player.x, boss.z - state.player.z), config);
		}
		expect(boss.aiState).never.toBe(BossState.DORMANT);
		// Back toward the door spawn (outside), rolling too, for 6 s.
		for (let i = 0; i < 360; i++) {
			state.player.hearts = state.player.heartsMax;
			const dx = spawn.x - state.player.x;
			const dz = spawn.z - state.player.z;
			const m = lenOr1(dx, dz);
			step(
				state,
				{
					...EMPTY_INPUT,
					moveX: jsRound((dx / m) * AXIS_MAX),
					moveZ: jsRound((dz / m) * AXIS_MAX),
					buttons: i % 30 === 0 ? Button.ROLL : 0,
				},
				config,
			);
			const p = state.player;
			expect(p.x).toBeGreaterThanOrEqual(room.minX + PLAYER_RADIUS - 1e-9);
			expect(p.x).toBeLessThanOrEqual(room.maxX - PLAYER_RADIUS + 1e-9);
			expect(p.z).toBeGreaterThanOrEqual(room.minZ + PLAYER_RADIUS - 1e-9);
			expect(p.z).toBeLessThanOrEqual(room.maxZ - PLAYER_RADIUS + 1e-9);
			expect(tileAt(fight.d, worldToGrid(p.x), worldToGrid(p.z))).toBe(TileType.FLOOR);
		}
	});
});

// ---------------------------------------------------------------------------------------------
// A full fight: the decent player with the placeholder gun

for (const seed of [1337, 42]) {
	describe(`boss.act1 full fight (seed ${seed}), decent player with weapon.test`, () => {
		// Fires 70% of every second (the rest: dodging), rolls about every 2.5 s.
		const log = runFight(seed, 4 * 60 * SIM_HZ + 600, makeBot(seed, { duty: 0.7, rollChance: 1 / 150 }));
		const ticks = log.ticks;

		it("dies within 1.5..4 minutes of sim time after engaging (TTK; the 20 dps placeholder gun sits near the cap floor)", () => {
			expect(log.engageTick).toBeGreaterThan(0);
			expect(log.deathTick).toBeGreaterThan(0);
			const ttk = SECONDS(log.deathTick - log.engageTick);
			print(
				`[boss.act1] seed ${seed}: decent player (70% fire duty, weapon.test) TTK ${string.format(
					"%.1f",
					ttk,
				)} s`,
			);
			expect(ttk).toBeGreaterThanOrEqual(90);
			expect(ttk).toBeLessThanOrEqual(240);
			// Port: the source's boss/README.md "Time to kill" table measured 96 / 94 s (the bot replays exactly).
			// (The README rounds the printed one-decimal TTK: within 0.55 s of the table.)
			expect(math.abs(ttk - (seed === 1337 ? 96 : 94))).toBeLessThan(0.55);
		});

		it("phases 1 -> 2 -> 3 at 66% / 33% hp; each transition is an immune roar that clears its bullets", () => {
			const phaseIdx: number[] = [];
			for (let k = 0; k < ticks.size(); k++) if (ticks[k].bossPhase > 0) phaseIdx.push(k);
			expect(phaseIdx.map((k) => ticks[k].bossPhase)).toEqual([1, 2, 3]);
			expect(ticks[phaseIdx[0]].bossEngaged).toBe(1);
			const thresholds: Array<[number, number]> = [
				[1, D.phaseHp[0]],
				[2, D.phaseHp[1]],
			];
			for (const [i, frac] of thresholds) {
				const at = phaseIdx[i];
				const t = ticks[at];
				expect(t.hp).toBe(D.hp * frac); // stopped exactly on the threshold (no phase skipping)
				expect(t.state).toBe(BossState.TRANSITION);
				expect(t.attack).toBe(BossAttack.ROAR);
				expect(t.bossBullets).toBe(0); // its bullets were cleared
				// Immune for the whole roar (after the hit that reached the threshold), even while bullets keep hitting it.
				let hitsDuring = 0;
				const f = failures();
				for (let k = at; k < at + D.transitionTicks; k++) {
					f.check(ticks[k].hp === t.hp, `tick ${ticks[k].tick}: hp ${ticks[k].hp}`);
					f.check(ticks[k].state === BossState.TRANSITION, `tick ${ticks[k].tick}: state ${ticks[k].state}`);
					if (k > at)
						f.check(ticks[k].damageDealt === 0, `tick ${ticks[k].tick}: damage ${ticks[k].damageDealt}`);
					hitsDuring += ticks[k].enemyHits;
				}
				expect(f.list).toEqual([]);
				expect(hitsDuring).toBeGreaterThan(0);
				expect(ticks[at + D.transitionTicks].state).toBe(AiState.TELEGRAPH);
				expect(ticks[at + D.transitionTicks].attack).toBe(PHASE_FIRST_ATTACK[i + 1]);
			}
			// Before the threshold the phase never changes on its own.
			const f = failures();
			for (const t of ticks) {
				if (t.phase === 1) f.check(t.hp >= D.hp * D.phaseHp[0], `tick ${t.tick}: phase 1 hp ${t.hp}`);
				if (t.phase === 2) f.check(t.hp >= D.hp * D.phaseHp[1], `tick ${t.tick}: phase 2 hp ${t.hp}`);
			}
			expect(f.list).toEqual([]);
		});

		it("respects the damage cap (any 110-tick window <= cap x 2 s)", () => {
			const window = (DAMAGE_CAP_BUCKETS - 1) * DAMAGE_CAP_BUCKET_TICKS;
			const budget = D.damageCapPerSecond! * DAMAGE_CAP_WINDOW_SECONDS;
			let max = 0;
			for (let i = window; i < ticks.size(); i++) max = math.max(max, ticks[i - window].hp - ticks[i].hp);
			expect(max).toBeLessThanOrEqual(budget + 1e-9);
			expect(max).toBeGreaterThan(budget * 0.9); // the cap is what limits the gun
		});

		it("bossDefeated on the death tick only; the event stream the playtest telemetry reads has the attempt, phases and the victory", () => {
			const defeated = ticks.filter((t) => t.bossDefeated > 0);
			expect(defeated.size()).toBe(1);
			expect(defeated[0].tick).toBe(log.deathTick);
			expect(ticks.filter((t) => t.bossEngaged > 0).size()).toBe(1);
			// Port: PlaytestTelemetry is not in this workspace. Its taps (bossPhase first, then bossEngaged, then
			// bossDefeated -> boss.defeated + run.victory) see exactly this marker stream.
			const markers: string[] = [];
			const phases: number[] = [];
			let victoryTick = -1;
			for (const t of ticks) {
				if (t.bossPhase > 0) {
					markers.push("boss.phase");
					phases.push(t.bossPhase);
				}
				if (t.bossEngaged > 0) markers.push("boss.engaged");
				if (t.bossDefeated > 0) {
					markers.push("boss.defeated");
					victoryTick = t.tick + 1;
				}
			}
			// (Engaging and phase 1 land on the same tick; the taps run bossPhase first.)
			expect(markers).toEqual(["boss.phase", "boss.engaged", "boss.phase", "boss.phase", "boss.defeated"]);
			expect(phases).toEqual([1, 2, 3]);
			expect(victoryTick).toBe(log.deathTick + 1);
		});
	});
}

describe("boss.act1 TTK with a bow-like damage rate", () => {
	for (const seed of [1337, 42]) {
		it(`seed ${seed}: one 3-damage volley per 0.67 s (4.5 dps raw, like the bow), 75 percent uptime: about 3 minutes`, () => {
			const log = runFight(
				seed,
				5 * 60 * SIM_HZ,
				makeBot(seed + 3, { duty: 0.75, rollChance: 1 / 150, tapEvery: 40 }),
			);
			const ttk = SECONDS(log.deathTick - log.engageTick);
			print(
				`[boss.act1] seed ${seed}: bow-rate player (4.5 dps raw, 75% uptime) TTK ${string.format(
					"%.1f",
					ttk,
				)} s`,
			);
			expect(log.deathTick).toBeGreaterThan(0);
			expect(ttk).toBeGreaterThanOrEqual(120);
			expect(ttk).toBeLessThanOrEqual(225);
		});
	}
});

describe("boss.act1 TTK at full fire (the cap floor)", () => {
	it("a player firing 100% of the time cannot beat 1.5 minutes (the cap floor)", () => {
		const log = runFight(1337, 4 * 60 * SIM_HZ, makeBot(5, { duty: 1, rollChance: 0 }));
		const ttk = SECONDS(log.deathTick - log.engageTick);
		print(`[boss.act1] seed 1337: always firing (weapon.test, capped) TTK ${string.format("%.1f", ttk)} s`);
		expect(log.deathTick).toBeGreaterThan(0);
		expect(ttk).toBeGreaterThanOrEqual(90);
		expect(ttk).toBeLessThan(115);
	});
});

// ---------------------------------------------------------------------------------------------
// Ten minutes of fight: telegraphs, gaps, attack choice

for (const seed of [1337, 42]) {
	describe(`boss.act1 over 10 minutes (seed ${seed})`, () => {
		// Fires until phase 3, then only dodges: the boss lives on in phase 3 for the rest of the 10 minutes.
		const log = runFight(
			seed,
			10 * 60 * SIM_HZ,
			makeBot(seed + 1, { duty: 1, holdFireAtPhase: 3, rollChance: 1 / 120 }),
		);
		const ticks = log.ticks;
		const runs = telegraphRuns(log);
		const lastTick = ticks[ticks.size() - 1].tick;

		it("stays alive in phase 3 and attacks the whole time", () => {
			expect(log.deathTick).toBe(-1);
			expect(ticks[ticks.size() - 1].phase).toBe(3);
			expect(runs.size()).toBeGreaterThan(150);
		});

		it("every telegraph lasts its wind-up (>= 30 ticks), starts with the audio cue event, and only then bullets fly", () => {
			let interrupted = 0;
			for (const r of runs) {
				if (r.interrupted) {
					interrupted++;
					continue;
				}
				if (r.start + r.length > lastTick) continue; // the log ends mid wind-up
				expect([r.attack, r.length]).toEqual([r.attack, BOSS_TELEGRAPH_TICKS[r.attack]]);
				expect(r.length).toBeGreaterThanOrEqual(30);
			}
			expect(interrupted).toBeLessThanOrEqual(2);
			let lastTelegraph = -1;
			let lastStart = -1;
			const f = failures();
			for (let i = 0; i < ticks.size(); i++) {
				const t = ticks[i];
				const at = `tick ${t.tick}`;
				// (Its summoned swarmers telegraph their lunges through the same counter: at most one each per tick.)
				if (t.state === AiState.TELEGRAPH && t.prevState !== AiState.TELEGRAPH) {
					// ctx.telegraph: the per-attack cue (attack id in boss.attack)
					f.check(t.telegraphs >= 1, `${at}: no cue`);
					f.check(t.telegraphs <= 1 + t.addsBefore, `${at}: ${t.telegraphs} cues`);
					lastStart = t.tick;
				} else if (t.state === BossState.TRANSITION && t.bossPhase > 0) {
					// A wind-up that started and was cut by the threshold hit on the same tick (cue, then the roar).
					f.check(t.telegraphs <= 1 + t.addsBefore, `${at}: ${t.telegraphs} cues at a roar`);
				} else f.check(t.telegraphs <= t.addsBefore, `${at}: ${t.telegraphs} cues outside a wind-up start`);
				if (t.prevState === AiState.TELEGRAPH && t.state !== AiState.TELEGRAPH)
					lastTelegraph = t.tick - lastStart;
				if (t.newBullets.size() > 0) {
					// Only from a running attack, right after (or during) its telegraphed wind-up.
					f.check(
						t.prevState === AiState.TELEGRAPH || t.prevState === BossState.ACTIVE,
						`${at}: bullets from state ${t.prevState}`,
					);
					f.check(lastTelegraph >= 30, `${at}: telegraph ${lastTelegraph}`);
				}
				// It only moves while charging (a slam, after its wind-up) or walking back to the center between attacks.
				const prev = i > 0 ? ticks[i - 1] : undefined;
				if (prev !== undefined && (prev.x !== t.x || prev.z !== t.z)) {
					const charging =
						t.prevAttack === BossAttack.SLAM &&
						(t.prevState === AiState.TELEGRAPH || t.prevState === BossState.ACTIVE);
					f.check(charging || t.prevState === BossState.REPOSITION, `${at}: moved in state ${t.prevState}`);
				}
			}
			expect(f.list).toEqual([]);
		});

		it("every burst leaves a gap wider than the player (diameter + margin) at the player's distance", () => {
			const need = 2 * PLAYER_RADIUS + GAP_MARGIN;
			const contact = D.radius + PLAYER_RADIUS;
			let rings = 0;
			for (const t of ticks) {
				const b = t.newBullets;
				if (b.size() === 0) continue;
				const angles = stableSort(
					b.map((x) => math.atan2(x.dx, x.dz)),
					(p, q) => p - q,
				);
				let gap = angles[0] + 2 * math.pi - angles[angles.size() - 1];
				for (let i = 1; i < angles.size(); i++) gap = math.max(gap, angles[i] - angles[i - 1]);
				const dist = math.max(contact, hypot2(t.px - b[0].ox, t.pz - b[0].oz));
				const room = 2 * dist * math.sin(math.min(math.pi, gap) / 2) - 2 * ENEMY_BULLET_RADIUS;
				expect(room).toBeGreaterThanOrEqual(need);
				// The same holds at the closest a player can stand (touching the boss).
				expect(
					2 * contact * math.sin(math.min(math.pi, gap) / 2) - 2 * ENEMY_BULLET_RADIUS,
				).toBeGreaterThanOrEqual(need);
				if (b.size() >= 20) rings++;
			}
			expect(rings).toBeGreaterThan(50);
		});

		it("draws attacks from its phase table, opens each phase with the new one, never 3 in a row", () => {
			for (const r of runs) expect(PHASE_ATTACKS[r.phase]).toContain(r.attack);
			for (const phase of [1, 2, 3]) {
				const first = runs.find((r) => r.phase === phase)!;
				expect(first.attack).toBe(PHASE_FIRST_ATTACK[phase]);
			}
			for (let i = MAX_REPEAT; i < runs.size(); i++) {
				let same = true;
				for (let k = i - MAX_REPEAT; k <= i; k++) if (runs[k].attack !== runs[i].attack) same = false;
				expect([`attacks ${i - MAX_REPEAT}..${i}`, same]).toEqual([`attacks ${i - MAX_REPEAT}..${i}`, false]);
			}
			// Phase 3 really uses its whole table.
			const p3 = new Set<number>();
			for (const r of runs) if (r.phase === 3) p3.add(r.attack);
			const used: number[] = [];
			for (const a of p3) used.push(a);
			expect(stableSort(used, (a, b) => a - b)).toEqual(stableSort([...PHASE_ATTACKS[3]], (a, b) => a - b));
		});

		it("stands still and vulnerable between attacks (0.8..1.2 s)", () => {
			let recover = 0;
			const f = failures();
			for (let i = 1; i < ticks.size(); i++) {
				if (ticks[i].state === BossState.RECOVER && ticks[i - 1].state !== BossState.RECOVER) {
					let k = i;
					while (k < ticks.size() && ticks[k].state === BossState.RECOVER) {
						f.check(ticks[k].x === ticks[i].x && ticks[k].z === ticks[i].z, `tick ${ticks[k].tick}: moved`);
						k++;
					}
					if (k < ticks.size() && ticks[k].state !== BossState.TRANSITION) {
						expect(SECONDS(k - i)).toBeGreaterThanOrEqual(0.8 - 1e-9);
						expect(SECONDS(k - i)).toBeLessThanOrEqual(1.2 + 1e-9);
						recover++;
					}
				}
			}
			expect(f.list).toEqual([]);
			expect(recover).toBeGreaterThan(100);
		});

		it("the slam summons swarmers 24 ticks after impact (swarmer is registered), at most 3 alive, no second shockwave", () => {
			expect(hasArchetype("swarmer")).toBe(true);
			const slams = runs.filter((r) => r.attack === BossAttack.SLAM && !r.interrupted).size();
			expect(slams).toBeGreaterThan(5);
			// Bullets from a slam: only its impact shockwave (the fallback second ring is gone).
			const shockTicks = ticks.filter((t) => t.prevAttack === BossAttack.SLAM && t.newBullets.size() > 0).size();
			expect(shockTicks).toBeLessThanOrEqual(slams);
			expect(shockTicks).toBeGreaterThanOrEqual(slams - 3);
			// The first slam brings 3; this bot never shoots them in phase 3, so they live on and later slams add none.
			const summons = ticks.filter((t) => t.actorsSpawned > 0);
			expect(summons.size()).toBeGreaterThanOrEqual(1);
			expect(summons[0].actorsSpawned).toBe(3);
			expect(summons[0].prevAttack).toBe(BossAttack.SLAM);
			let most = 0;
			for (const t of ticks) most = math.max(most, t.swarmers);
			expect(most).toBeLessThanOrEqual(3);
			expect(ticks[ticks.size() - 1].swarmers).toBe(3);
		});
	});
}

// ---------------------------------------------------------------------------------------------
// Payload (E1.8 integration: BulletPayload grew pierce / lastHit for the bow)

describe("boss.act1 bullet payloads after the pierce fields", () => {
	it("pack damage / kind / source with pierce and lastHit 0, inside the 31-bit payload", () => {
		expect(BulletPayload.bits).toBeLessThanOrEqual(31);
		const fight = setupFight(1337);
		const { state, boss, config } = fight;
		state.player.x = boss.x + 3;
		state.player.z = boss.z;
		for (let i = 0; i < 600 && state.combat.enemyBullets.activeCountFor(boss.emitterId) === 0; i++) {
			step(state, EMPTY_INPUT, config);
			state.player.hearts = state.player.heartsMax;
		}
		let n = 0;
		const seen: number[][] = [];
		state.combat.enemyBullets.forEachActive((_i, _pos, payload, emitter) => {
			if (emitter !== boss.emitterId) return false;
			n++;
			seen.push([
				BulletPayload.get(payload, "damage"),
				BulletPayload.get(payload, "kind"),
				BulletPayload.get(payload, "source"),
				BulletPayload.get(payload, "pierce"),
				BulletPayload.get(payload, "lastHit"),
			]);
			return false;
		});
		for (const f of seen) expect(f).toEqual([1, BulletKind.BOSS, boss.kind + 1, 0, 0]);
		expect(n).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------------------------
// Damage cap (direct)

describe("boss.act1 damage cap (direct hits)", () => {
	it("100 damage per tick still only removes the cap per second", () => {
		const fight = setupFight(1337);
		const { state, boss, config } = fight;
		// Engage by teleporting the player onto the room center row.
		state.player.x = boss.x + 3;
		state.player.z = boss.z;
		step(state, EMPTY_INPUT, config);
		expect(boss.phase).toBe(1);
		for (let i = 0; i < D.introTicks; i++) step(state, EMPTY_INPUT, config);
		const ctx = new SimCtx();
		const hp0 = boss.hp;
		const hp: number[] = [hp0];
		for (let i = 0; i < 600; i++) {
			ctx.bind(state, config, EMPTY_INPUT);
			ctx.damageActor(boss, 100);
			step(state, EMPTY_INPUT, config);
			state.player.hearts = state.player.heartsMax;
			hp.push(boss.hp);
		}
		// Any 110 ticks (at most 12 cap buckets): <= cap x 2 s; 10 s: <= 10 x the cap (+ one window of slack).
		const cap = D.damageCapPerSecond!;
		for (let i = 110; i < hp.size(); i++) {
			expect(hp[i - 110] - hp[i]).toBeLessThanOrEqual(cap * DAMAGE_CAP_WINDOW_SECONDS + 1e-9);
		}
		expect(hp0 - boss.hp).toBeLessThanOrEqual(12 * cap + 1e-9);
		expect(hp0 - boss.hp).toBeGreaterThan(9 * cap);
	});
});

// ---------------------------------------------------------------------------------------------
// Debug cheat, determinism

describe("boss.act1 DEBUG_BOSS (J) and determinism", () => {
	it("J presses take 10% each, stop at every threshold, and finish the fight", () => {
		const fight = setupFight(42);
		const { state, boss, config } = fight;
		state.player.x = boss.x + 3;
		state.player.z = boss.z;
		let phases = 0;
		let defeated = 0;
		for (let i = 0; i < 2400 && boss.alive !== 0; i++) {
			step(state, { ...EMPTY_INPUT, buttons: i % 20 === 10 ? Button.DEBUG_BOSS : 0 }, config);
			state.player.hearts = state.player.heartsMax;
			phases += state.events.bossPhase > 0 ? 1 : 0;
			defeated += state.events.bossDefeated;
			if (boss.phase === 1) expect(boss.hp).toBeGreaterThanOrEqual(D.hp * D.phaseHp[0]);
		}
		expect(boss.alive).toBe(0);
		expect(phases).toBe(3);
		expect(defeated).toBe(1);
		expect(state.combat.enemyBullets.activeCountFor(boss.emitterId)).toBe(0);
	});

	for (const seed of [1337, 42]) {
		it(`seed ${seed}: live play with irregular frames == runReplay, boss engaged, all phases`, () => {
			const fight = setupFight(seed);
			const { state, boss, config, spawn } = fight;
			// Not god mode: the recording must be the whole truth. A careful bot (fires, rolls) plus J presses so the
			// fight reaches every phase and ends within the run.
			const bot = makeBot(seed + 7, { duty: 0.8, rollChance: 1 / 90, debugChance: 1 / 300, heal: true });
			const recorder = new Recorder(seed, spawn.x, spawn.z);
			const loop = new FixedStepLoop();
			const deltas = new Rng(bit32.bxor(seed, 0xb055));
			const hashes = new Map<number, string>();
			let phases = 0;
			let engaged = 0;
			let telegraphs = 0;
			const bossHp: number[] = [];
			while (recorder.size() < 4800) {
				const r = deltas.next();
				const delta = r < 0.02 ? 0.2 + deltas.next() * 0.2 : (1 + deltas.next() * 7) / 240;
				const input = bot(state, boss);
				loop.advance(delta, () => {
					recorder.record(input);
					step(state, input, config);
					phases += state.events.bossPhase > 0 ? 1 : 0;
					engaged += state.events.bossEngaged;
					telegraphs += state.events.telegraphs;
					bossHp.push(boss.hp);
					if (state.tick % 600 === 0) hashes.set(state.tick, hashState(state));
				});
			}
			expect(engaged).toBe(1);
			expect(phases).toBeGreaterThanOrEqual(2);
			expect(telegraphs).toBeGreaterThan(5);
			expect(state.combat.enemySpawned).toBeGreaterThan(200);
			const rec = recorder.getRecording();
			expect(hashState(runReplay(rec, config))).toBe(hashState(state));
			for (const [t, h] of hashes) expect(hashState(runReplay(rec, config, t))).toBe(h);
			// One flipped input bit changes the outcome: the first J press that took hp off.
			const frames = [...rec.frames];
			const J = Button.DEBUG_BOSS;
			let k = -1;
			for (let i = 1; i < frames.size(); i++) {
				if (
					bit32.band(frames[i].buttons, J) !== 0 &&
					bit32.band(frames[i - 1].buttons, J) === 0 &&
					bossHp[i] < bossHp[i - 1] - 1
				) {
					k = i;
					break;
				}
			}
			expect(k).toBeGreaterThan(0);
			frames[k] = { ...frames[k], buttons: bit32.band(frames[k].buttons, bit32.bnot(J)) };
			expect(hashState(runReplay({ ...rec, frames }, config))).never.toBe(hashState(state));
		});
	}
});

// ---------------------------------------------------------------------------------------------
// Phase-3 slam summons in the game's own encounter (E1.8 integration: 'swarmer' exists now)

interface Summon {
	tick: number;
	count: number;
	landed: { x: number; z: number; engaged: boolean }[];
}

/**
 * The game's run (DEFAULT_ENCOUNTER: room enemies on the critical path + the boss), started at the boss door like
 * ?spawn=boss, so the rest of the floor is still full of idle room swarmers. The bot walks in, J-presses the boss to
 * phase 3, then strafes and shoots only at swarmers inside the arena (the boss lives on), in god mode.
 */
function runSummonFight(seed: number, phase3Ticks: number, fill?: (ctx: SimCtx, s: SimState) => void) {
	const d = generateDungeon({ ...KALEB_VALE_MVP_PARAMS, seed });
	const config: SimConfig = {
		moveResolver: circleMover(d, PLAYER_RADIUS),
		isBulletBlocked: bulletBlocker(d),
		actorMover: actorMover(d),
		encounter: placeEncounter(d, DEFAULT_ENCOUNTER),
		loadout: GUN_LOADOUT,
	};
	const spawn = bossDoorSpawn(d)!;
	const state = createSimState(seed, spawn.x, spawn.z, config);
	const bossKind = new SimCtx().kindOf(BOSS_ACT1_ID);
	const boss = state.combat.actors.find((a) => a.kind === bossKind)!;
	const room = config.encounter!.rooms[config.encounter!.bossRoom];
	const inArena = (x: number, z: number) => x >= room.minX && x <= room.maxX && z >= room.minZ && z <= room.maxZ;
	const swarmerKind = new SimCtx().kindOf("swarmer");
	const swarmersIn = () =>
		state.combat.actors.filter((o) => o.kind === swarmerKind && o.alive !== 0 && inArena(o.x, o.z));
	const swarmersOut = () =>
		state.combat.actors.filter((o) => o.kind === swarmerKind && o.alive !== 0 && !inArena(o.x, o.z)).size();
	const presentCount = () => state.combat.actors.filter((o) => o.kind !== NO_KIND).size();
	const recorder = new Recorder(seed, spawn.x, spawn.z);
	const rng = new Rng(bit32.bxor(seed, 0x5a));
	let strafe = 1;
	let phase3At = -1;
	const summons: Summon[] = [];
	let maxIn = 0;
	let slams = 0;
	/** Most occupied actor slots (live actors and corpses) after any tick. */
	let peakSlots = 0;
	const outsideAtStart = swarmersOut();
	for (let i = 0; i < 6000 && (phase3At < 0 || state.tick - phase3At < phase3Ticks) && boss.alive !== 0; i++) {
		if (boss.phase >= 3 && phase3At < 0) phase3At = state.tick;
		// (Called every tick of the first slam's charge and shockwave, so corpses freeing their slots are topped up too.)
		if (fill && summons.size() === 0 && boss.attack === BossAttack.SLAM && boss.aiState === BossState.ACTIVE) {
			fill(new SimCtx().bind(state, config, EMPTY_INPUT), state);
		}
		const p = state.player;
		const targets = swarmersIn();
		let tx = boss.x;
		let tz = boss.z;
		let best = math.huge;
		for (const o of targets) {
			const dd = hypot2(o.x - p.x, o.z - p.z);
			if (dd < best) {
				best = dd;
				tx = o.x;
				tz = o.z;
			}
		}
		const bx = boss.x - p.x;
		const bz = boss.z - p.z;
		const bd = lenOr1(bx, bz);
		if (rng.next() < 1 / 200) strafe = -strafe;
		const dormant = boss.aiState === BossState.DORMANT;
		const radial = dormant ? 1 : clamp1((bd - 5) * 0.5);
		const mx = dormant ? bx / bd : (-bz / bd) * strafe * 0.8 + (bx / bd) * radial;
		const mz = dormant ? bz / bd : (bx / bd) * strafe * 0.8 + (bz / bd) * radial;
		const ax = tx - p.x;
		const az = tz - p.z;
		const am = lenOr1(ax, az);
		let buttons = 0;
		if (boss.phase > 0 && boss.phase < 3 && i % 20 === 10) buttons = bit32.bor(buttons, Button.DEBUG_BOSS);
		if (boss.phase >= 3 && targets.size() > 0) buttons = bit32.bor(buttons, Button.FIRE);
		const mm = lenOr1(mx, mz);
		const input: InputFrame = {
			moveX: jsRound((mx / mm) * AXIS_MAX),
			moveZ: jsRound((mz / mm) * AXIS_MAX),
			aimX: jsRound((ax / am) * AXIS_MAX),
			aimZ: jsRound((az / am) * AXIS_MAX),
			buttons,
		};
		const prevAttack = boss.attack;
		const prevState = boss.aiState;
		recorder.record(input);
		const before = new Set<number>();
		for (const o of state.combat.actors) if (o.kind !== NO_KIND) before.add(o.id);
		step(state, input, config);
		state.player.hearts = state.player.heartsMax;
		peakSlots = math.max(peakSlots, presentCount());
		if (prevState === AiState.TELEGRAPH && boss.aiState === BossState.ACTIVE && prevAttack === BossAttack.SLAM)
			slams++;
		if (state.events.actorsSpawned > 0) {
			const born = state.combat.actors.filter((o) => o.kind !== NO_KIND && !before.has(o.id));
			expect(born.every((o) => o.kind === swarmerKind)).toBe(true);
			expect(prevAttack).toBe(BossAttack.SLAM);
			summons.push({
				tick: state.tick - 1,
				count: born.size(),
				landed: born.map((o) => ({ x: o.x, z: o.z, engaged: o.v[V_AGGRO] === 1 })),
			});
			// Right after a summon: at most 3 swarmers in the arena (room packs that chased the player in count too).
			maxIn = math.max(maxIn, swarmersIn().size());
		}
	}
	return {
		d,
		config,
		state,
		boss,
		recorder,
		summons,
		maxIn,
		slams,
		phase3At,
		outsideAtStart,
		swarmersOut,
		peakSlots,
	};
}

for (const seed of [1337, 42]) {
	describe(`boss.act1 phase-3 slam summons in the game encounter (seed ${seed})`, () => {
		const run = runSummonFight(seed, 75 * SIM_HZ);

		it("the floor holds room swarmers elsewhere (they do not count against the arena's 3)", () => {
			expect(run.outsideAtStart).toBeGreaterThanOrEqual(3);
			expect(run.config.encounter!.spawns.size()).toBeLessThanOrEqual(ENEMY_BUDGET + 1);
		});

		it("slams summon up to 3 swarmers, engaged, on the arena floor; never more than 3 alive in the arena", () => {
			print(
				`[boss.act1] seed ${seed}: ${run.slams} slams, summons ${run.summons
					.map((s) => tostring(s.count))
					.join(",")} in ${string.format("%.0f", SECONDS(run.state.tick - run.phase3At))} s of phase 3`,
			);
			expect(run.phase3At).toBeGreaterThan(0);
			expect(run.slams).toBeGreaterThanOrEqual(3);
			expect(run.summons.size()).toBeGreaterThanOrEqual(2);
			expect(run.summons[0].count).toBe(3);
			expect(run.maxIn).toBeLessThanOrEqual(3);
			const room = run.config.encounter!.rooms[run.config.encounter!.bossRoom];
			for (const s of run.summons) {
				expect(s.count).toBeGreaterThan(0);
				expect(s.count).toBeLessThanOrEqual(3);
				for (const l of s.landed) {
					expect(l.engaged).toBe(true);
					expect(tileAt(run.d, worldToGrid(l.x), worldToGrid(l.z))).toBe(TileType.FLOOR);
					expect(l.x).toBeGreaterThanOrEqual(room.minX);
					expect(l.x).toBeLessThanOrEqual(room.maxX);
					expect(l.z).toBeGreaterThanOrEqual(room.minZ);
					expect(l.z).toBeLessThanOrEqual(room.maxZ);
				}
			}
			expect(run.state.combat.actors.size()).toBeLessThanOrEqual(MAX_ACTORS);
		});

		it("replays bit for bit (summons included)", () => {
			// The recorded input re-stepped from scratch (with the same god-mode refill after every tick) ...
			const rec = run.recorder.getRecording();
			const spawn = bossDoorSpawn(run.d)!;
			const s = createSimState(seed, spawn.x, spawn.z, run.config);
			let mid = "";
			const midTick = run.summons[1].tick + 1;
			for (const f of rec.frames) {
				step(s, f, run.config);
				s.player.hearts = s.player.heartsMax;
				if (s.tick === midTick) mid = hashState(s);
			}
			expect(hashState(s)).toBe(hashState(run.state));
			expect(mid).never.toBe("");
			// ... and the whole bot-driven fight run again: same hash.
			expect(hashState(runSummonFight(seed, 75 * SIM_HZ).state)).toBe(hashState(run.state));
		});
	});
}

const run0d = generateDungeon({ ...KALEB_VALE_MVP_PARAMS, seed: 1337 });
const run1d = generateDungeon({ ...KALEB_VALE_MVP_PARAMS, seed: 42 });

const freeSlots = (s: SimState) => {
	let n = MAX_ACTORS - s.combat.actors.size();
	for (const o of s.combat.actors) if (o.kind === NO_KIND) n++;
	return n;
};

describe("boss.act1 summons respect MAX_ACTORS", () => {
	it("with one free slot left, a slam adds one swarmer and drops the rest (no throw)", () => {
		let dropped0 = -1;
		const run = runSummonFight(1337, 30 * SIM_HZ, (ctx, s) => {
			// Fill the pool with snipers at the boss door (outside the arena) until one slot is free.
			const at = bossDoorSpawn(run0d)!;
			while (freeSlots(s) > 1) expect(ctx.spawnActor("sniper", at.x, at.z)).never.toBe(undefined);
			if (dropped0 < 0) dropped0 = s.combat.actorsDropped;
		});
		expect(run.summons.size()).toBeGreaterThanOrEqual(1);
		expect(run.summons[0].count).toBe(1);
		expect(run.state.combat.actors.size()).toBe(MAX_ACTORS);
		expect(run.state.combat.actorsDropped).toBeGreaterThanOrEqual(dropped0 + 2);
	});
});

/**
 * The actor budget (E1.8 integration): room enemies (populateEnemies, at most ENEMY_BUDGET on a floor) + the boss + its
 * summons must fit MAX_ACTORS. Summons are at most SUMMON_MAX_ALIVE alive in the arena, plus at most as many corpses
 * still holding their slots (a corpse frees its slot after CORPSE_TICKS = 0.5 s, far shorter than the time between two
 * slams), and only the boss spawns at runtime: worst case ENEMY_BUDGET + 1 + 2 x SUMMON_MAX_ALIVE = 47 of 64.
 */
describe("actor budget: room enemies + boss + summons <= MAX_ACTORS", () => {
	const WORST = ENEMY_BUDGET + 1 + 2 * SUMMON_MAX_ALIVE;

	it("the worst case fits the pool (no summon cap needed beyond SUMMON_MAX_ALIVE)", () => {
		expect(SUMMON_COUNT).toBeLessThanOrEqual(SUMMON_MAX_ALIVE);
		expect(CORPSE_TICKS).toBeLessThan(BOSS_TELEGRAPH_TICKS[BossAttack.SLAM]); // a summon's corpse is gone before the next slam lands
		expect(WORST).toBeLessThanOrEqual(MAX_ACTORS);
	});

	it("the default encounter never places more than ENEMY_BUDGET room enemies + the boss (60 seeds)", () => {
		let most = 0;
		for (let seed = 1; seed <= 60; seed++) {
			const d = generateDungeon({ ...KALEB_VALE_MVP_PARAMS, seed });
			const spawns = placeEncounter(d, DEFAULT_ENCOUNTER).spawns;
			expect(spawns.filter((sp) => sp.kind === BOSS_ACT1_ID).size()).toBe(1);
			expect(spawns.size()).toBeLessThanOrEqual(ENEMY_BUDGET + 1);
			most = math.max(most, spawns.size());
		}
		print(
			`[actor budget] most actors placed on a floor (seeds 1..60): ${most} (budget ${ENEMY_BUDGET} + boss; pool ${MAX_ACTORS})`,
		);
	});

	it("a full floor (ENEMY_BUDGET room enemies + boss) and 75 s of phase-3 slams, summons killed as they come: nothing dropped", () => {
		let filled = 0;
		const run = runSummonFight(42, 75 * SIM_HZ, (ctx, s) => {
			// Pad the floor up to exactly ENEMY_BUDGET room enemies + the boss (snipers at the boss door, outside the arena).
			const at = bossDoorSpawn(run1d)!;
			while (s.combat.actors.filter((o) => o.kind !== NO_KIND).size() < ENEMY_BUDGET + 1) {
				expect(ctx.spawnActor("sniper", at.x, at.z)).never.toBe(undefined);
				filled++;
			}
		});
		let total = 0;
		for (const x of run.summons) total += x.count;
		print(
			`[actor budget] seed 42 full floor: ${run.summons.size()} summons (${run.summons
				.map((x) => tostring(x.count))
				.join(",")}), peak ${run.peakSlots} slots of ${MAX_ACTORS}`,
		);
		expect(run.summons.size()).toBeGreaterThanOrEqual(2);
		expect(total).toBeGreaterThan(3); // the bot kills them, later slams call more
		expect(run.peakSlots).toBeGreaterThanOrEqual(ENEMY_BUDGET + 1 + 3);
		expect(run.peakSlots).toBeLessThanOrEqual(WORST);
		expect(run.state.combat.actorsDropped).toBe(0);
		expect(filled).toBeGreaterThan(0); // the floor really was padded to the budget
	});
});

// ---------------------------------------------------------------------------------------------
// ?spawn=boss

describe("?spawn=boss (debug run setup)", () => {
	for (const seed of [1337, 42, 1, 7, 99, 2024]) {
		it(`seed ${seed}: just outside the boss room, on floor, a few steps from the fight`, () => {
			const d = generateDungeon({ ...KALEB_VALE_MVP_PARAMS, seed });
			const s = bossDoorSpawn(d);
			expect(s).never.toBe(undefined);
			const gx = worldToGrid(s!.x);
			const gz = worldToGrid(s!.z);
			expect(tileAt(d, gx, gz)).toBe(TileType.FLOOR);
			expect(d.roomId[gz * d.W + gx]).never.toBe(d.boss);
			const room = placeEncounter(d, {}).rooms[d.boss];
			const dist = hypot2(s!.x - room.cx, s!.z - room.cz);
			expect(dist).toBeLessThan(16);
		});
	}

	it("the boss-door spawn is used only when asked for (runSpawn; the URL query parser is web-only)", () => {
		const d = generateDungeon({ ...KALEB_VALE_MVP_PARAMS, seed: 1337 });
		expect(runSpawn(d, true)).toEqual(bossDoorSpawn(d));
		expect(runSpawn(d, false)).toEqual(entranceSpawn(d));
	});
});
