// 'boss.demonlord' (Roblox port, docs/BOSS_DEMONLORD.md D4; no web source): the GDD boss rules on real fights in M1
// dungeons (seeds 1337 and 42) through the full sim, the same way bossAct1.spec.ts checks Mother Mayhem:
//   - registry: band PORT_BAND_BOSSES, index 8; every web index (0..6) and the dummy (7) unchanged
//   - Mother Mayhem's budget: BOSS_HP (270) hp, cap 6/s, phases at 66 % / 33 %, heavy contact damage
//   - every attack telegraphs >= 30 ticks, and bullets only leave from a running attack after its wind-up
//   - phases 1 -> 2 -> 3 never skipped (hp stops on the threshold, immune roar, own bullets cleared), each phase opens
//     with its new attack, attacks only from the phase's table, never 3 in a row
//   - each attack's geometry (cleave arcs, the 3-gap hellfire with a gap on the player, the charge's impact tick and
//     shockwave, the double cleave's half-lane offset and lunge)
//   - summons: 3 engaged swarmers, at most 3 alive in the arena, the hellfire fallback at the cap and with a full pool
//   - determinism: live play with irregular frames == runReplay, two runs give one hash
// Time to kill with the real weapons: demonlord.ttk.spec.ts. The harness is bossAct1.spec.ts's (copied: specs cannot
// import each other).
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	KALEB_VALE_MVP_PARAMS,
	actorMover,
	bossDoorSpawn,
	bulletBlocker,
	circleMover,
	generateDungeon,
	placeEncounter,
	type Dungeon,
} from "shared/dungeon";
import { hypot2, jsRound, stableSort } from "shared/jsmath";
import {
	ARC_SHAPES,
	AXIS_MAX,
	AiState,
	BOSS_ACT1_DATA,
	BOSS_DEMONLORD,
	BOSS_DEMONLORD_ID,
	BOSS_MAX_REPEAT,
	BulletKind,
	Button,
	CHARGE_SHOCKWAVE,
	CHARGE_SHOCK_GAP,
	CLEAVE,
	DAMAGE_CAP_BUCKETS,
	DAMAGE_CAP_BUCKET_TICKS,
	DAMAGE_CAP_WINDOW_SECONDS,
	DEMONLORD_ATTACK_NAMES,
	DEMONLORD_DATA,
	DEMONLORD_PHASE_ATTACKS,
	DEMONLORD_PHASE_FIRST_ATTACK,
	DEMONLORD_SUMMON,
	DEMONLORD_TELEGRAPH_TICKS,
	DEMONLORD_V_AUX_X,
	DEMONLORD_V_AUX_Z,
	DEMONLORD_V_DIR_X,
	DEMONLORD_V_DIR_Z,
	DEMONLORD_V_MARK,
	DEMONLORD_V_SIGN,
	DOUBLE_CLEAVE_DELAY_TICKS,
	DOUBLE_CLEAVE_STEP,
	DUMMY_KIND,
	DemonlordAttack,
	DemonlordState,
	EMPTY_INPUT,
	ENEMY_BULLET_RADIUS,
	FixedStepLoop,
	HALF_LANE_COS,
	HALF_LANE_SIN,
	HELLFIRE_ARC,
	HELLFIRE_GAP,
	HELLFIRE_MAX_TURNS,
	MAX_ACTORS,
	NO_KIND,
	PLAYER_RADIUS,
	PORT_ARC_SHAPES,
	PORT_BAND_BOSSES,
	Recorder,
	Rng,
	SIM_DT,
	SIM_HZ,
	SimCtx,
	TURN_COS,
	TURN_SIN,
	V_AGGRO,
	archetypeAt,
	archetypeIds,
	archetypeIndex,
	arcTrig,
	createSimState,
	hasArchetype,
	hashState,
	runReplay,
	step,
	webArchetypeIds,
	type ActorState,
	type BurstSpec,
	type InputFrame,
	type SimConfig,
	type SimState,
	BOSS_HP,
	WEB_BOSS_HP,
} from "shared/sim";

const D = DEMONLORD_DATA;
const A = DemonlordAttack;
const SECONDS = (ticks: number) => ticks / SIM_HZ;
const TURN_ANGLE = math.atan2(TURN_SIN, TURN_COS);
/** Room the player needs to slip between two bullets: its diameter plus this margin, world units. */
const GAP_MARGIN = 0.2;
/** Float slack on angles measured from bullet velocities. */
const ANGLE_EPS = 1e-6;

const clamp1 = (v: number) => math.max(-1, math.min(1, v));
const lenOr1 = (x: number, z: number) => {
	const h = hypot2(x, z);
	return h !== 0 && h === h ? h : 1;
};
/** Signed angle from (ax, az) to (bx, bz), radians in (-PI, PI] (headings: x = sin, z = cos). */
const angleBetween = (ax: number, az: number, bx: number, bz: number) =>
	math.atan2(ax * bz - az * bx, ax * bx + az * bz) * -1;

// ---------------------------------------------------------------------------------------------
// Harness (bossAct1.spec.ts's)

interface Fight {
	d: Dungeon;
	config: SimConfig;
	state: SimState;
	boss: ActorState;
	spawn: { x: number; z: number };
}

const GUN_LOADOUT: ReadonlyArray<string> = ["weapon.test", "weapon.test.melee"];

function setupFight(seed: number, loadout: ReadonlyArray<string | undefined> = GUN_LOADOUT): Fight {
	const d = generateDungeon({ ...KALEB_VALE_MVP_PARAMS, seed });
	const config: SimConfig = {
		moveResolver: circleMover(d, PLAYER_RADIUS),
		isBulletBlocked: bulletBlocker(d),
		actorMover: actorMover(d),
		encounter: placeEncounter(d, { boss: BOSS_DEMONLORD_ID }),
		loadout,
	};
	const spawn = bossDoorSpawn(d)!;
	const state = createSimState(seed, spawn.x, spawn.z, config);
	return { d, config, state, boss: state.combat.actors[0], spawn };
}

interface BotOptions {
	duty: number;
	holdFireAtPhase?: number;
	rollChance: number;
	debugChance?: number;
	heal?: boolean;
}

type Bot = (s: SimState, boss: ActorState) => InputFrame;

/** A "decent player": walks in, then circle-strafes at ~6 units, aiming at the boss, FIRE for `duty` of each second. */
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
		if (boss.aiState === DemonlordState.DORMANT) {
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
		if (firing) buttons = bit32.bor(buttons, Button.FIRE);
		if (opts.heal === true && p.hearts <= 3 && n % 2 === 0) buttons = bit32.bor(buttons, Button.FLASK);
		if (opts.heal === true && p.hearts <= 2 && n % 2 === 1) buttons = bit32.bor(buttons, Button.EMBER);
		if (boss.aiState !== DemonlordState.DORMANT && rng.next() < opts.rollChance)
			buttons = bit32.bor(buttons, Button.ROLL);
		if (opts.debugChance !== undefined && rng.next() < opts.debugChance)
			buttons = bit32.bor(buttons, Button.DEBUG_BOSS);
		return {
			moveX: jsRound(mx * AXIS_MAX),
			moveZ: jsRound(mz * AXIS_MAX),
			aimX: jsRound(ux * AXIS_MAX),
			aimZ: jsRound(uz * AXIS_MAX),
			buttons,
		};
	};
}

interface NewBullet {
	dx: number;
	dz: number;
	speed: number;
	ox: number;
	oz: number;
}

/** The boss's bullets that appeared this tick (slot not live last tick, or its life went up). Updates `prevLife`. */
function newBossBullets(state: SimState, boss: ActorState, prevLife: Map<number, number>): NewBullet[] {
	const snap: number[] = [];
	state.combat.enemyBullets.writeStateHash(snap);
	const cur = new Map<number, number>();
	const out: NewBullet[] = [];
	for (let k = 0; k < snap.size(); k += 10) {
		const idx = snap[k];
		const life = snap[k + 7];
		cur.set(idx, life);
		if (snap[k + 9] !== boss.emitterId) continue;
		const before = prevLife.get(idx);
		if (before === undefined || life > before) {
			const vx = snap[k + 4];
			const vz = snap[k + 6];
			const v = hypot2(vx, vz);
			out.push({
				dx: vx / v,
				dz: vz / v,
				speed: v,
				ox: snap[k + 1] - vx * SIM_DT,
				oz: snap[k + 3] - vz * SIM_DT,
			});
		}
	}
	prevLife.clear();
	for (const [i, l] of cur) prevLife.set(i, l);
	return out;
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
	addsBefore: number;
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

/** Runs a fight tick by tick with the player refilled to full hearts ("god mode"). */
function runFight(seed: number, maxTicks: number, bot: Bot, god = true): FightLog {
	const fight = setupFight(seed);
	const { state, boss, config } = fight;
	const ticks: TickLog[] = [];
	const prevLife = new Map<number, number>();
	let deathTick = -1;
	let engageTick = -1;
	for (let i = 0; i < maxTicks && deathTick < 0; i++) {
		const prevState = boss.aiState;
		const prevAttack = boss.attack;
		const addsBefore = liveAdds(state, boss);
		step(state, bot(state, boss), config);
		if (god) state.player.hearts = state.player.heartsMax;
		const e = state.events;
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
			newBullets: newBossBullets(state, boss, prevLife),
			addsBefore,
			swarmers: liveSwarmers(state),
			actorsSpawned: e.actorsSpawned,
		});
		if (e.bossEngaged !== 0) engageTick = state.tick - 1;
		if (boss.alive === 0 && deathTick < 0) deathTick = state.tick - 1;
	}
	return { fight, ticks, deathTick, engageTick };
}

interface TelegraphRun {
	attack: number;
	phase: number;
	start: number;
	length: number;
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
			if (cur !== undefined && t.state === DemonlordState.TRANSITION) cur.interrupted = true;
			cur = undefined;
		}
	}
	return out;
}

function failures(): { check(ok: boolean, what: string): void; list: string[] } {
	const list: string[] = [];
	return {
		list,
		check(ok, what) {
			if (!ok && list.size() < 20) list.push(what);
		},
	};
}

/** Sorted bullet headings (radians, atan2(x, z)) and the angular gaps between neighbours (wrapping). */
function headingGaps(b: ReadonlyArray<NewBullet>): { angles: number[]; gaps: { from: number; width: number }[] } {
	const angles = stableSort(
		b.map((x) => math.atan2(x.dx, x.dz)),
		(p, q) => p - q,
	);
	const gaps: { from: number; width: number }[] = [];
	for (let i = 0; i < angles.size(); i++) {
		const nxt = i + 1 < angles.size() ? angles[i + 1] : angles[0] + 2 * math.pi;
		gaps.push({ from: angles[i], width: nxt - angles[i] });
	}
	return { angles, gaps };
}

// ---------------------------------------------------------------------------------------------
// One forced attack, the player standing still

interface Forced {
	fight: Fight;
	/** Per tick after the forcing: boss state / attack / position / v[], new bullets, spawned actors. */
	ticks: {
		state: number;
		attack: number;
		x: number;
		z: number;
		v: number[];
		bullets: NewBullet[];
		spawned: number;
		telegraphs: number;
	}[];
	/** Direction boss -> player when the forced attack was picked (the end of the intro). */
	px: number;
	pz: number;
}

/**
 * Engages the boss with the player `dist` units from it along the boss room's wider axis, forces `attack` as the first
 * one after the intro roar (ActorState.cooldown, the skeleton's forced pick), then steps `ticks` ticks standing still.
 * `before` runs right before the forced attack starts (fill the pool, add swarmers, ...).
 */
function forceAttack(
	seed: number,
	attack: number,
	dist: number,
	ticks: number,
	before?: (ctx: SimCtx, f: Fight) => void,
): Forced {
	const fight = setupFight(seed);
	const { state, boss, config } = fight;
	const room = config.encounter!.rooms[config.encounter!.bossRoom];
	const wide = room.maxX - room.minX >= room.maxZ - room.minZ;
	const half = (wide ? room.maxX - room.minX : room.maxZ - room.minZ) / 2;
	const r = math.min(dist, half - D.engageInset - 0.1);
	state.player.x = boss.x + (wide ? r : 0);
	state.player.z = boss.z + (wide ? 0 : r);
	step(state, EMPTY_INPUT, config);
	expect(boss.aiState).toBe(DemonlordState.TRANSITION);
	boss.cooldown = attack;
	while (boss.aiState === DemonlordState.TRANSITION && boss.aiTicks > 1) {
		step(state, EMPTY_INPUT, config);
		state.player.hearts = state.player.heartsMax;
	}
	if (before !== undefined) before(new SimCtx().bind(state, config, EMPTY_INPUT), fight);
	const px = state.player.x - boss.x;
	const pz = state.player.z - boss.z;
	const m = hypot2(px, pz);
	const out: Forced = { fight, ticks: [], px: px / m, pz: pz / m };
	const prevLife = new Map<number, number>();
	newBossBullets(state, boss, prevLife);
	for (let i = 0; i < ticks; i++) {
		step(state, EMPTY_INPUT, config);
		state.player.hearts = state.player.heartsMax;
		out.ticks.push({
			state: boss.aiState,
			attack: boss.attack,
			x: boss.x,
			z: boss.z,
			v: [...boss.v],
			bullets: newBossBullets(state, boss, prevLife),
			spawned: state.events.actorsSpawned,
			telegraphs: state.events.telegraphs,
		});
	}
	return out;
}

/** Index of the first tick with new bullets (-1 none). */
function firstVolley(f: Forced, from = 0): number {
	for (let i = from; i < f.ticks.size(); i++) if (f.ticks[i].bullets.size() > 0) return i;
	return -1;
}

// ---------------------------------------------------------------------------------------------
// Data-level rules

describe("boss.demonlord registry and data", () => {
	it("is band PORT_BAND_BOSSES, index 8, after the web table (0..6) and the dummy (7), which keep their indices", () => {
		const web = ["boss.act1", "bruiser", "sniper", "swarmer", "turret.caster", "turret.sniper", "turret.sprayer"];
		expect(hasArchetype(BOSS_DEMONLORD_ID)).toBe(true);
		expect(BOSS_DEMONLORD.band).toBe(PORT_BAND_BOSSES);
		expect(PORT_BAND_BOSSES).toBe(2);
		expect([...webArchetypeIds()]).toEqual(web);
		for (let i = 0; i < web.size(); i++) expect([web[i], archetypeIndex(web[i])]).toEqual([web[i], i]);
		expect(archetypeIndex(DUMMY_KIND)).toBe(7);
		expect(archetypeIndex(BOSS_DEMONLORD_ID)).toBe(8);
		expect([...archetypeIds()]).toEqual([
			...web,
			DUMMY_KIND,
			BOSS_DEMONLORD_ID,
			"imp",
			"slime",
			"slime.small",
			"summoner",
			"bomber", // band PORT_BAND_ENEMIES_2 (docs/NEW_ENEMIES.md): indices 13-17
			"charger",
			"reaper",
			"stormcaller",
			"warbanner",
			"golden", // band PORT_BAND_FORTUNE (docs/FORTUNE.md): index 18
			// band PORT_BAND_ENEMIES_3 (docs/NEW_ENEMIES_2.md): indices 19-23
			"bulwark",
			"chainhook",
			"pyre",
			"pyrekeeper",
			"snatcher",
			// band PORT_BAND_ENEMIES_4 (docs/NEW_ENEMIES_3.md): indices 24-26
			"jackal",
			"mender",
			"mortar",
		]); // band-3 room enemies (docs/ENEMY_VARIANTS.md), then band 4
		expect(archetypeAt(8)).toBe(BOSS_DEMONLORD);
	});

	it("has Mother Mayhem's budget: 270 hp, cap 6/s (hp / cap = 45 s), phases at 66 % / 33 %, heavy contact", () => {
		const b = BOSS_ACT1_DATA;
		expect(D.boss).toBe(true);
		expect(D.spriteId).toBe("boss.demonlord");
		expect([D.hp, D.damageCapPerSecond, D.contactDamage, D.radius, D.corpseTicks]).toEqual([
			b.hp,
			b.damageCapPerSecond,
			b.contactDamage,
			b.radius,
			b.corpseTicks,
		]);
		// The flawless floor (100 % uptime at the cap): hp / cap = 45 s (90 s at the web build's 540), plus the roars.
		expect(D.hp).toBe(BOSS_HP);
		expect(D.hp / D.damageCapPerSecond!).toBe(b.hp / b.damageCapPerSecond!);
		expect(D.hp / D.damageCapPerSecond!).toBe(45);
		expect([...D.phaseHp]).toEqual([...b.phaseHp]);
		expect([D.introTicks, D.transitionTicks, D.engageInset, D.debugDamage]).toEqual([
			b.introTicks,
			b.transitionTicks,
			b.engageInset,
			b.debugDamage,
		]);
		expect(DEMONLORD_ATTACK_NAMES.size()).toBe(A.ROAR + 1);
		expect(DEMONLORD_TELEGRAPH_TICKS.size()).toBe(A.ROAR + 1);
	});

	it("every attack winds up for at least 0.5 s (30 ticks)", () => {
		for (const phase of [1, 2, 3]) {
			for (const a of DEMONLORD_PHASE_ATTACKS[phase])
				expect(DEMONLORD_TELEGRAPH_TICKS[a]).toBeGreaterThanOrEqual(30);
		}
	});

	it("each phase opens with an attack new to it; the plan's table (cleave / hellfire, + charge, double cleave / charge / summon)", () => {
		expect([...DEMONLORD_PHASE_ATTACKS[1]]).toEqual([A.CLEAVE, A.HELLFIRE]);
		expect([...DEMONLORD_PHASE_ATTACKS[2]]).toEqual([A.CLEAVE, A.HELLFIRE, A.CHARGE]);
		expect([...DEMONLORD_PHASE_ATTACKS[3]]).toEqual([A.DOUBLE_CLEAVE, A.CHARGE, A.SUMMON]);
		for (const phase of [1, 2, 3]) {
			const first = DEMONLORD_PHASE_FIRST_ATTACK[phase];
			expect(DEMONLORD_PHASE_ATTACKS[phase]).toContain(first);
			if (phase > 1) expect(DEMONLORD_PHASE_ATTACKS[phase - 1].includes(first)).toBe(false);
		}
	});

	it("fires only BOSS bullets of shapes the arc table holds (the cleave and hellfire arcs are port shapes)", () => {
		const specs: BurstSpec[] = [CLEAVE, HELLFIRE_ARC, CHARGE_SHOCKWAVE];
		for (const s of specs) {
			expect(s.kind).toBe(BulletKind.BOSS);
			expect(arcTrig(s.count, s.spread).count).toBe(s.count);
		}
		const isPort = (s: BurstSpec) => PORT_ARC_SHAPES.some((p) => p === arcTrig(s.count, s.spread));
		expect([isPort(CLEAVE), isPort(HELLFIRE_ARC), isPort(CHARGE_SHOCKWAVE)]).toEqual([true, true, false]);
		expect(ARC_SHAPES.some((p) => p === arcTrig(CHARGE_SHOCKWAVE.count, CHARGE_SHOCKWAVE.spread))).toBe(true);
	});

	it("half a cleave lane is an exact rotation (no trig): twice it is the lane between two cleave bullets", () => {
		const shape = arcTrig(CLEAVE.count, CLEAVE.spread);
		const lane = math.atan2(shape.sin[4], shape.cos[4]);
		expect(math.abs(2 * math.atan2(HALF_LANE_SIN, HALF_LANE_COS) - lane)).toBeLessThan(1e-12);
		expect(math.abs(HALF_LANE_COS * HALF_LANE_COS + HALF_LANE_SIN * HALF_LANE_SIN - 1)).toBeLessThan(1e-15);
	});
});

// ---------------------------------------------------------------------------------------------
// The attacks, one at a time

describe("boss.demonlord attacks (forced, player standing still)", () => {
	it("CLEAVE in range: no chase, 36-tick telegraph standing still, then 7 bullets over 2.4 rad on the player", () => {
		const f = forceAttack(1337, A.CLEAVE, 2.5, 80);
		expect(f.ticks[0].state).toBe(AiState.TELEGRAPH);
		expect(f.ticks[0].attack).toBe(A.CLEAVE);
		const k = firstVolley(f);
		expect(k).toBe(DEMONLORD_TELEGRAPH_TICKS[A.CLEAVE]);
		for (let i = 0; i < k; i++) expect([f.ticks[i].x, f.ticks[i].z]).toEqual([f.ticks[0].x, f.ticks[0].z]);
		const b = f.ticks[k].bullets;
		expect(b.size()).toBe(CLEAVE.count);
		const { angles } = headingGaps(b);
		expect(math.abs(angles[angles.size() - 1] - angles[0] - CLEAVE.spread)).toBeLessThan(ANGLE_EPS);
		const centre = math.atan2(f.px, f.pz);
		expect(math.abs(angles[3] - centre)).toBeLessThan(ANGLE_EPS);
		for (const x of b) expect(math.abs(x.speed - CLEAVE.speed)).toBeLessThan(1e-9);
		// One volley only, then RECOVER after the follow-through.
		expect(firstVolley(f, k + 1)).toBe(-1);
		expect(f.ticks.some((t) => t.state === DemonlordState.RECOVER)).toBe(true);
	});

	it("CLEAVE out of range: CHASE (move, no bullets, no telegraph cue) up to chaseTicks, then the telegraph", () => {
		const f = forceAttack(1337, A.CLEAVE, 6, 200);
		expect(f.ticks[0].state).toBe(DemonlordState.CHASE);
		let chase = 0;
		while (f.ticks[chase].state === DemonlordState.CHASE) {
			expect(f.ticks[chase].bullets.size()).toBe(0);
			expect(f.ticks[chase].telegraphs).toBe(0);
			expect(f.ticks[chase].attack).toBe(A.CLEAVE);
			chase++;
		}
		expect(chase).toBeGreaterThan(0);
		expect(chase).toBeLessThanOrEqual(D.chaseTicks + 1);
		expect(f.ticks[chase].state).toBe(AiState.TELEGRAPH);
		expect(f.ticks[chase].telegraphs).toBe(1);
		// He walked toward the player (from the room centre, where he stood).
		const p = f.fight.state.player;
		const room = f.fight.config.encounter!.rooms[f.fight.config.encounter!.bossRoom];
		const d0 = hypot2(p.x - room.cx, p.z - room.cz);
		const d1 = hypot2(p.x - f.ticks[chase].x, p.z - f.ticks[chase].z);
		expect(d1).toBeLessThan(d0);
		expect(firstVolley(f) - chase).toBe(DEMONLORD_TELEGRAPH_TICKS[A.CLEAVE]);
	});

	it("HELLFIRE: 24 slow bullets in 3 arcs with 3 gaps of HELLFIRE_GAP, one centred within a TURN of the player", () => {
		for (const seed of [1337, 42, 7]) {
			const f = forceAttack(seed, A.HELLFIRE, 4, 80);
			const k = firstVolley(f);
			expect(k).toBe(DEMONLORD_TELEGRAPH_TICKS[A.HELLFIRE]);
			const b = f.ticks[k].bullets;
			expect(b.size()).toBe(3 * HELLFIRE_ARC.count);
			const wide = headingGaps(b).gaps.filter((g) => g.width > HELLFIRE_GAP / 2);
			expect(wide.size()).toBe(3);
			for (const g of wide) expect(math.abs(g.width - HELLFIRE_GAP)).toBeLessThan(ANGLE_EPS);
			const centre = math.atan2(f.px, f.pz);
			let best = math.huge;
			for (const g of wide) {
				let off = g.from + g.width / 2 - centre;
				while (off > math.pi) off -= 2 * math.pi;
				while (off < -math.pi) off += 2 * math.pi;
				best = math.min(best, math.abs(off));
			}
			expect(best).toBeLessThanOrEqual(HELLFIRE_MAX_TURNS * TURN_ANGLE + ANGLE_EPS);
			// The player (standing still) is inside that gap: no bullet within the player's reach of its line.
			const p = f.fight.state.player;
			const dist = hypot2(p.x - f.fight.boss.x, p.z - f.fight.boss.z);
			for (const x of b) {
				const off = math.abs(angleBetween(f.px, f.pz, x.dx, x.dz));
				expect(dist * math.sin(math.min(off, math.pi / 2))).toBeGreaterThan(
					PLAYER_RADIUS + ENEMY_BULLET_RADIUS,
				);
			}
		}
	});

	it("DOUBLE_CLEAVE: an arc, a lunge along it, a second arc turned half a lane from the new spot", () => {
		const f = forceAttack(1337, A.DOUBLE_CLEAVE, 2.5, 120);
		const k = firstVolley(f);
		expect(k).toBe(DEMONLORD_TELEGRAPH_TICKS[A.DOUBLE_CLEAVE]);
		const k2 = firstVolley(f, k + 1);
		expect(k2 - k).toBe(DOUBLE_CLEAVE_DELAY_TICKS);
		expect(firstVolley(f, k2 + 1)).toBe(-1);
		const a1 = headingGaps(f.ticks[k].bullets).angles;
		const a2 = headingGaps(f.ticks[k2].bullets).angles;
		expect([a1.size(), a2.size()]).toEqual([CLEAVE.count, CLEAVE.count]);
		const sign = f.ticks[k].v[DEMONLORD_V_SIGN];
		expect(math.abs(sign)).toBe(1);
		const halfLane = math.atan2(HALF_LANE_SIN, HALF_LANE_COS);
		// atan2(x, z) grows toward +X; a positive sin turns from +Z toward +X.
		expect(math.abs(a2[3] - a1[3] - sign * halfLane)).toBeLessThan(ANGLE_EPS);
		const moved = hypot2(f.ticks[k2].x - f.ticks[k].x, f.ticks[k2].z - f.ticks[k].z);
		expect(moved).toBeLessThanOrEqual(DOUBLE_CLEAVE_STEP + 1e-9);
		expect(moved).toBeGreaterThan(0);
		// v[AUX] is v[DIR] turned by half a lane exactly as patterns.ts rotateDir turns it.
		const t = f.ticks[k];
		const nx = t.v[DEMONLORD_V_DIR_X] * HALF_LANE_COS + t.v[DEMONLORD_V_DIR_Z] * sign * HALF_LANE_SIN;
		const nz = t.v[DEMONLORD_V_DIR_Z] * HALF_LANE_COS - t.v[DEMONLORD_V_DIR_X] * sign * HALF_LANE_SIN;
		const inv = 1 / math.sqrt(nx * nx + nz * nz);
		expect([t.v[DEMONLORD_V_AUX_X], t.v[DEMONLORD_V_AUX_Z]]).toEqual([nx * inv, nz * inv]);
	});

	it("CHARGE: v[AUX] holds the target, v[MARK] = impact tick + 1 set on the impact tick with a 26-bullet shockwave", () => {
		const f = forceAttack(1337, A.CHARGE, 5, 160);
		const tele = DEMONLORD_TELEGRAPH_TICKS[A.CHARGE];
		for (let i = 0; i < tele; i++) {
			expect(f.ticks[i].state).toBe(AiState.TELEGRAPH);
			expect(f.ticks[i].v[DEMONLORD_V_MARK]).toBe(0);
		}
		const k = firstVolley(f);
		expect(k).toBeGreaterThan(tele - 1);
		expect(f.ticks[k - 1].v[DEMONLORD_V_MARK]).toBe(0);
		// Index `tele` is ACTIVE tick 0 (the tick the TELEGRAPH ran out): the impact's ACTIVE tick is k - tele.
		const activeTick = k - tele;
		expect(f.ticks[k].v[DEMONLORD_V_MARK]).toBe(activeTick + 1);
		const b = f.ticks[k].bullets;
		expect(b.size()).toBe(CHARGE_SHOCKWAVE.count);
		// The gap points back the way he came.
		const { gaps } = headingGaps(b);
		let widest = gaps[0];
		for (const g of gaps) if (g.width > widest.width) widest = g;
		expect(math.abs(widest.width - CHARGE_SHOCK_GAP)).toBeLessThan(ANGLE_EPS);
		const back = math.atan2(-f.ticks[k].v[DEMONLORD_V_DIR_X], -f.ticks[k].v[DEMONLORD_V_DIR_Z]);
		let off = widest.from + widest.width / 2 - back;
		while (off > math.pi) off -= 2 * math.pi;
		while (off < -math.pi) off += 2 * math.pi;
		expect(math.abs(off)).toBeLessThan(ANGLE_EPS);
		// It moved toward the target point while charging.
		const tx = f.ticks[0].v[DEMONLORD_V_AUX_X];
		const tz = f.ticks[0].v[DEMONLORD_V_AUX_Z];
		expect(hypot2(tx - f.ticks[k].x, tz - f.ticks[k].z)).toBeLessThan(hypot2(tx - f.ticks[0].x, tz - f.ticks[0].z));
		expect(f.ticks.some((t) => t.state === DemonlordState.RECOVER)).toBe(true);
	});

	it("SUMMON: 3 engaged swarmers on ACTIVE tick 0, no bullets", () => {
		const f = forceAttack(1337, A.SUMMON, 4, 100);
		const k = DEMONLORD_TELEGRAPH_TICKS[A.SUMMON];
		expect(f.ticks[k - 1].v[DEMONLORD_V_SIGN]).toBe(1);
		expect(f.ticks[k].spawned).toBe(DEMONLORD_SUMMON.count);
		expect(firstVolley(f)).toBe(-1);
		const kind = new SimCtx().kindOf("swarmer");
		const adds = f.fight.state.combat.actors.filter((o) => o.kind === kind && o.alive !== 0);
		expect(adds.size()).toBe(3);
		for (const o of adds) expect(o.v[V_AGGRO]).toBe(1);
	});

	it("SUMMON at the cap (3 swarmers alive in the arena): no add, the hellfire ring instead", () => {
		const f = forceAttack(1337, A.SUMMON, 4, 100, (ctx, fight) => {
			for (let i = 0; i < 3; i++) ctx.spawnActor("swarmer", fight.boss.x, fight.boss.z);
		});
		const k = DEMONLORD_TELEGRAPH_TICKS[A.SUMMON];
		expect(f.ticks[0].v[DEMONLORD_V_SIGN]).toBe(0);
		expect(f.ticks[k].spawned).toBe(0);
		expect(f.ticks[k].bullets.size()).toBe(3 * HELLFIRE_ARC.count);
	});

	it("SUMMON with a full actor pool: no throw, nothing spawned, the hellfire ring instead", () => {
		// Same setup, the pool filled with dummies (far outside the arena) right before ACTIVE tick 0.
		const fight = setupFight(1337);
		const { state, boss, config } = fight;
		const room = config.encounter!.rooms[config.encounter!.bossRoom];
		state.player.x = boss.x + math.min(4, (room.maxX - room.minX) / 2 - D.engageInset - 0.1);
		state.player.z = boss.z;
		step(state, EMPTY_INPUT, config);
		boss.cooldown = A.SUMMON;
		for (let i = 0; i < 600 && !(boss.aiState === AiState.TELEGRAPH && boss.aiTicks === 1); i++) {
			step(state, EMPTY_INPUT, config);
			state.player.hearts = state.player.heartsMax;
		}
		expect([boss.aiState, boss.attack, boss.aiTicks]).toEqual([AiState.TELEGRAPH, A.SUMMON, 1]);
		expect(boss.v[DEMONLORD_V_SIGN]).toBe(1);
		const ctx = new SimCtx().bind(state, config, EMPTY_INPUT);
		while (ctx.spawnActor(DUMMY_KIND, room.minX - 50, room.minZ - 50) !== undefined) {
			// fill every free slot
		}
		const prevLife = new Map<number, number>();
		newBossBullets(state, boss, prevLife);
		step(state, EMPTY_INPUT, config);
		expect(state.events.actorsSpawned).toBe(0);
		expect(boss.v[DEMONLORD_V_SIGN]).toBe(0);
		expect(newBossBullets(state, boss, prevLife).size()).toBe(3 * HELLFIRE_ARC.count);
		expect(state.combat.actors.filter((o) => o.kind !== NO_KIND).size()).toBe(MAX_ACTORS);
	});
});

// ---------------------------------------------------------------------------------------------
// A full fight: the decent player with the placeholder gun

for (const seed of [1337, 42]) {
	describe(`boss.demonlord full fight (seed ${seed}), decent player with weapon.test`, () => {
		const log = runFight(seed, 4 * 60 * SIM_HZ + 600, makeBot(seed, { duty: 0.7, rollChance: 1 / 150 }));
		const ticks = log.ticks;

		// 1.5..4 minutes at the web build's 540 hp, scaled to the port's halved BOSS_HP: 45 s..2 minutes.
		it("dies within 45 s..2 minutes of sim time after engaging", () => {
			expect(log.engageTick).toBeGreaterThan(0);
			expect(log.deathTick).toBeGreaterThan(0);
			const ttk = SECONDS(log.deathTick - log.engageTick);
			print(
				`[boss.demonlord] seed ${seed}: decent player (70% fire duty, weapon.test) TTK ${string.format(
					"%.1f",
					ttk,
				)} s`,
			);
			expect(ttk).toBeGreaterThanOrEqual((90 * BOSS_HP) / WEB_BOSS_HP);
			expect(ttk).toBeLessThanOrEqual((240 * BOSS_HP) / WEB_BOSS_HP);
		});

		it("phases 1 -> 2 -> 3 at 66% / 33% hp, never skipped; each change is an immune roar that clears its bullets", () => {
			const phaseIdx: number[] = [];
			for (let k = 0; k < ticks.size(); k++) if (ticks[k].bossPhase > 0) phaseIdx.push(k);
			expect(phaseIdx.map((k) => ticks[k].bossPhase)).toEqual([1, 2, 3]);
			for (const i of [1, 2]) {
				const at = phaseIdx[i];
				const t = ticks[at];
				expect(t.hp).toBe(D.hp * D.phaseHp[i - 1]);
				expect(t.state).toBe(DemonlordState.TRANSITION);
				expect(t.attack).toBe(A.ROAR);
				expect(t.bossBullets).toBe(0);
				const f = failures();
				for (let k = at; k < at + D.transitionTicks; k++) {
					f.check(ticks[k].hp === t.hp, `tick ${ticks[k].tick}: hp ${ticks[k].hp}`);
					f.check(ticks[k].state === DemonlordState.TRANSITION, `tick ${ticks[k].tick}: ${ticks[k].state}`);
				}
				expect(f.list).toEqual([]);
				const after = ticks[at + D.transitionTicks];
				expect(after.attack).toBe(DEMONLORD_PHASE_FIRST_ATTACK[i + 1]);
			}
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
		});

		it("bossEngaged once, bossDefeated on the death tick only; his bullets are gone and his adds die with him", () => {
			expect(ticks.filter((t) => t.bossEngaged > 0).size()).toBe(1);
			const defeated = ticks.filter((t) => t.bossDefeated > 0);
			expect(defeated.size()).toBe(1);
			expect(defeated[0].tick).toBe(log.deathTick);
			const last = ticks[ticks.size() - 1];
			expect(last.bossBullets).toBe(0);
			expect(last.swarmers).toBe(0);
		});
	});
}

// ---------------------------------------------------------------------------------------------
// Ten minutes of fight: telegraphs, gaps, attack choice, summons

for (const seed of [1337, 42]) {
	describe(`boss.demonlord over 10 minutes (seed ${seed})`, () => {
		// Fires until phase 3, then only dodges: he lives on in phase 3 for the rest of the 10 minutes.
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
			expect(runs.size()).toBeGreaterThan(100);
		});

		it("every telegraph lasts its wind-up (>= 30 ticks); bullets only leave from a running attack after one", () => {
			for (const r of runs) {
				if (r.interrupted || r.start + r.length > lastTick) continue;
				expect([r.attack, r.length]).toEqual([r.attack, DEMONLORD_TELEGRAPH_TICKS[r.attack]]);
				expect(r.length).toBeGreaterThanOrEqual(30);
			}
			let lastTelegraph = -1;
			let lastStart = -1;
			const f = failures();
			for (let i = 0; i < ticks.size(); i++) {
				const t = ticks[i];
				const at = `tick ${t.tick}`;
				if (t.state === AiState.TELEGRAPH && t.prevState !== AiState.TELEGRAPH) {
					f.check(t.telegraphs >= 1, `${at}: no cue`);
					lastStart = t.tick;
				} else if (!(t.state === DemonlordState.TRANSITION && t.bossPhase > 0)) {
					f.check(t.telegraphs <= t.addsBefore, `${at}: ${t.telegraphs} cues outside a wind-up start`);
				}
				if (t.prevState === AiState.TELEGRAPH && t.state !== AiState.TELEGRAPH)
					lastTelegraph = t.tick - lastStart;
				if (t.newBullets.size() > 0) {
					f.check(
						t.prevState === AiState.TELEGRAPH || t.prevState === DemonlordState.ACTIVE,
						`${at}: bullets from state ${t.prevState}`,
					);
					f.check(lastTelegraph >= 30, `${at}: telegraph ${lastTelegraph}`);
				}
				// He moves only while chasing, walking home, charging or lunging (both after their wind-up).
				const prev = i > 0 ? ticks[i - 1] : undefined;
				if (prev !== undefined && (prev.x !== t.x || prev.z !== t.z)) {
					const attacking =
						(t.prevAttack === A.CHARGE || t.prevAttack === A.DOUBLE_CLEAVE) &&
						t.prevState === DemonlordState.ACTIVE;
					f.check(
						attacking ||
							t.prevState === DemonlordState.CHASE ||
							t.prevState === DemonlordState.REPOSITION ||
							(t.prevState === AiState.TELEGRAPH && t.prevAttack === A.CHARGE),
						`${at}: moved in state ${t.prevState} attack ${t.prevAttack}`,
					);
				}
			}
			expect(f.list).toEqual([]);
		});

		it("every ring leaves a gap wider than the player (diameter + margin) at the player's distance", () => {
			const need = 2 * PLAYER_RADIUS + GAP_MARGIN;
			const contact = D.radius + PLAYER_RADIUS;
			let rings = 0;
			for (const t of ticks) {
				const b = t.newBullets;
				if (b.size() < 20) continue;
				let gap = 0;
				for (const g of headingGaps(b).gaps) gap = math.max(gap, g.width);
				const dist = math.max(contact, hypot2(t.px - b[0].ox, t.pz - b[0].oz));
				expect(
					2 * dist * math.sin(math.min(math.pi, gap) / 2) - 2 * ENEMY_BULLET_RADIUS,
				).toBeGreaterThanOrEqual(need);
				rings++;
			}
			expect(rings).toBeGreaterThan(20);
		});

		it("draws attacks from its phase table, opens each phase with the new one, never 3 in a row", () => {
			for (const r of runs) expect(DEMONLORD_PHASE_ATTACKS[r.phase]).toContain(r.attack);
			// The attack sequence as started (a chase starts a cleave; its telegraph is the same attack).
			const seq: { attack: number; phase: number }[] = [];
			for (const t of ticks) {
				const started =
					(t.state === AiState.TELEGRAPH || t.state === DemonlordState.CHASE) &&
					t.prevState !== AiState.TELEGRAPH &&
					t.prevState !== DemonlordState.CHASE;
				if (started) seq.push({ attack: t.attack, phase: t.phase });
			}
			for (const phase of [1, 2, 3]) {
				expect(seq.find((s) => s.phase === phase)!.attack).toBe(DEMONLORD_PHASE_FIRST_ATTACK[phase]);
			}
			for (let i = BOSS_MAX_REPEAT; i < seq.size(); i++) {
				let same = true;
				for (let k = i - BOSS_MAX_REPEAT; k <= i; k++) if (seq[k].attack !== seq[i].attack) same = false;
				expect([`attacks ${i - BOSS_MAX_REPEAT}..${i}`, same]).toEqual([
					`attacks ${i - BOSS_MAX_REPEAT}..${i}`,
					false,
				]);
			}
			const p3 = new Set<number>();
			for (const s of seq) if (s.phase === 3) p3.add(s.attack);
			const used: number[] = [];
			for (const a of p3) used.push(a);
			expect(stableSort(used, (a, b) => a - b)).toEqual(
				stableSort([...DEMONLORD_PHASE_ATTACKS[3]], (a, b) => a - b),
			);
		});

		it("summons 3 swarmers once, never more than 3 alive; at the cap a summon fires the hellfire ring instead", () => {
			const summons = ticks.filter((t) => t.actorsSpawned > 0);
			expect(summons.size()).toBeGreaterThanOrEqual(1);
			expect(summons[0].actorsSpawned).toBe(3);
			expect(summons[0].prevAttack).toBe(A.SUMMON);
			let most = 0;
			for (const t of ticks) most = math.max(most, t.swarmers);
			expect(most).toBeLessThanOrEqual(DEMONLORD_SUMMON.maxAlive);
			// This bot never shoots them in phase 3: later summons fall back to the ring.
			const fallbacks = ticks
				.filter((t) => t.prevAttack === A.SUMMON && t.newBullets.size() === 3 * HELLFIRE_ARC.count)
				.size();
			expect(fallbacks).toBeGreaterThan(0);
		});
	});
}

// ---------------------------------------------------------------------------------------------
// Debug cheat, determinism

describe("boss.demonlord DEBUG_BOSS (J) and determinism", () => {
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
			if (boss.phase === 2) expect(boss.hp).toBeGreaterThanOrEqual(D.hp * D.phaseHp[1]);
		}
		expect(boss.alive).toBe(0);
		expect(phases).toBe(3);
		expect(defeated).toBe(1);
		expect(state.combat.enemyBullets.activeCountFor(boss.emitterId)).toBe(0);
	});

	it("two runs of the same fight end on the same hash", () => {
		const a = runFight(1337, 3000, makeBot(9, { duty: 0.8, rollChance: 1 / 90, debugChance: 1 / 200 }), false);
		const b = runFight(1337, 3000, makeBot(9, { duty: 0.8, rollChance: 1 / 90, debugChance: 1 / 200 }), false);
		expect(hashState(a.fight.state)).toBe(hashState(b.fight.state));
		expect(a.fight.state.combat.enemySpawned).toBeGreaterThan(50); // 92 at BOSS_HP (the fight ends sooner)
	});

	for (const seed of [1337, 42]) {
		it(`seed ${seed}: live play with irregular frames == runReplay, boss engaged, all phases`, () => {
			const fight = setupFight(seed);
			const { state, boss, config, spawn } = fight;
			const bot = makeBot(seed + 7, { duty: 0.8, rollChance: 1 / 90, debugChance: 1 / 300, heal: true });
			const recorder = new Recorder(seed, spawn.x, spawn.z);
			const loop = new FixedStepLoop();
			const deltas = new Rng(bit32.bxor(seed, 0xb055));
			const hashes = new Map<number, string>();
			let phases = 0;
			let engaged = 0;
			while (recorder.size() < 4800) {
				const r = deltas.next();
				const delta = r < 0.02 ? 0.2 + deltas.next() * 0.2 : (1 + deltas.next() * 7) / 240;
				const input = bot(state, boss);
				loop.advance(delta, () => {
					recorder.record(input);
					step(state, input, config);
					phases += state.events.bossPhase > 0 ? 1 : 0;
					engaged += state.events.bossEngaged;
					if (state.tick % 600 === 0) hashes.set(state.tick, hashState(state));
				});
			}
			expect(engaged).toBe(1);
			expect(phases).toBeGreaterThanOrEqual(2);
			expect(state.combat.enemySpawned).toBeGreaterThan(100);
			const rec = recorder.getRecording();
			expect(hashState(runReplay(rec, config))).toBe(hashState(state));
			for (const [t, h] of hashes) expect(hashState(runReplay(rec, config, t))).toBe(h);
		});
	}
});
