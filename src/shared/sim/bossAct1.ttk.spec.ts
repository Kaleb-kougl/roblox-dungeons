// 'boss.act1' time to kill with the real E1.8 weapons (source: `src/sim/actors/archetypes/boss/act1.test.ts` @ 42897e2,
// "TTK with the real weapons"; split out of bossAct1.spec.ts only to keep each spec file's Lune runtime short): scripted
// players with the sword only or the bow only, 60 % and 75 % uptime, seeds 1337 / 42 / 7, god mode: 2..4 minutes.
// The harness is the same as bossAct1.spec.ts (copied: specs cannot import each other). The bots press exactly the web
// build's inputs (hypot2 = V8's Math.hypot, jsRound = Math.round), so the measured TTKs are the web build's too: they
// are also checked against the table in the source's boss/README.md "Time to kill" (rounded seconds).
import { afterAll, describe, expect, it } from "@rbxts/jest-globals";
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
import { hypot2, jsRound } from "shared/jsmath";
import {
	AXIS_MAX,
	AiState,
	BOSS_ACT1_DATA,
	BOSS_ACT1_ID,
	BossState,
	Button,
	PLAYER_RADIUS,
	Rng,
	SIM_DT,
	SIM_HZ,
	SimCtx,
	createSimState,
	step,
	type ActorState,
	type InputFrame,
	type SimConfig,
	type SimState,
	WEB_SWORD_TIMINGS,
	setSwordTimings,
	type SwordTimings,
} from "shared/sim";

// The golden runs (and the source's measured tables) were recorded with the web build's sword; the port's is 20%
// slower (CLAUDE.md decision log), so this file replays under WEB_SWORD_TIMINGS. Set at load, not in a beforeAll:
// describe bodies may replay while the specs are collected.
const portSword: SwordTimings = setSwordTimings(WEB_SWORD_TIMINGS);
afterAll(() => {
	setSwordTimings(portSword);
});

const SECONDS = (ticks: number) => ticks / SIM_HZ;

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

type Bot = (s: SimState, boss: ActorState) => InputFrame;

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

interface WeaponBotOptions {
	/** Attack this many ticks of every `cycle` (FIRE held, in range), dodge the rest. */
	duty: number;
	cycle: number;
	/** Distance from the boss's center while attacking / while dodging. */
	attackDist: number;
	dodgeDist: number;
	/** Chance per dodging tick to roll. */
	rollChance: number;
}

/**
 * A "decent player" with one real weapon: attack windows of `duty` x `cycle` ticks (holding FIRE at attackDist from
 * the boss, aimed at it) alternate with dodge windows (strafing at dodgeDist, rolling now and then, no FIRE). The
 * sword player steps into melee range for its windows; the bow player stays at mid-range the whole time.
 */
function makeWeaponBot(seed: number, o: WeaponBotOptions): Bot {
	const rng = new Rng(seed);
	let strafe = 1;
	let n = 0;
	let lastX = 0 / 0;
	let lastZ = 0 / 0;
	let stuck = 0;
	return (s, boss) => {
		const p = s.player;
		const dx = boss.x - p.x;
		const dz = boss.z - p.z;
		const dist = lenOr1(dx, dz);
		const ux = dx / dist;
		const uz = dz / dist;
		let mx = ux;
		let mz = uz;
		let buttons = 0;
		if (boss.aiState !== BossState.DORMANT) {
			n++;
			const attacking = n % o.cycle < o.duty * o.cycle;
			if (hypot2(p.x - lastX, p.z - lastZ) < 0.02) stuck++;
			else stuck = 0;
			if (stuck > 10 || rng.next() < 1 / 240) {
				strafe = -strafe;
				stuck = 0;
			}
			const want = attacking ? o.attackDist : o.dodgeDist;
			const radial = clamp1((dist - want) * 0.8);
			const tangential = attacking ? 0.35 : 0.9;
			mx = -uz * strafe * tangential + ux * radial;
			mz = ux * strafe * tangential + uz * radial;
			const m = lenOr1(mx, mz);
			mx /= m;
			mz /= m;
			if (attacking) buttons = bit32.bor(buttons, Button.FIRE);
			else if (rng.next() < o.rollChance) buttons = bit32.bor(buttons, Button.ROLL);
		}
		lastX = p.x;
		lastZ = p.z;
		return {
			moveX: jsRound(mx * AXIS_MAX),
			moveZ: jsRound(mz * AXIS_MAX),
			aimX: jsRound(ux * AXIS_MAX),
			aimZ: jsRound(uz * AXIS_MAX),
			buttons,
		};
	};
}

/**
 * Measured TTK targets (README "Time to kill"): 2..4 minutes for both real weapons across a decent player's uptime
 * band (60 % and 75 % of the fight attacking), aiming for ~3 minutes.
 */
const BOW_BOT = { cycle: 180, attackDist: 6, dodgeDist: 6.5, rollChance: 1 / 45 };
const SWORD_BOT = { cycle: 180, attackDist: 2.3, dodgeDist: 4.5, rollChance: 1 / 45 };
const REAL_WEAPON_TTK = [
	{ weapon: "weapon.bow", label: "bow only, mid-range (6 u), 60% uptime", opts: { ...BOW_BOT, duty: 0.6 } },
	{ weapon: "weapon.bow", label: "bow only, mid-range (6 u), 75% uptime", opts: { ...BOW_BOT, duty: 0.75 } },
	{
		weapon: "weapon.sword",
		label: "sword only, melee (2.3 u), 60% uptime, dodging out to 4.5 u",
		opts: { ...SWORD_BOT, duty: 0.6 },
	},
	{
		weapon: "weapon.sword",
		label: "sword only, melee (2.3 u), 75% uptime, dodging out to 4.5 u",
		opts: { ...SWORD_BOT, duty: 0.75 },
	},
] as const;

/**
 * The source's boss/README.md "Time to kill" table (540 hp / cap 6, 2 s window, new sword), rounded seconds per seed
 * 1337 / 42 / 7, in REAL_WEAPON_TTK order. The port reproduces the web build's fights exactly, so these must match.
 */
const README_TTK: ReadonlyArray<ReadonlyArray<number>> = [
	[203, 193, 192],
	[148, 151, 148],
	[136, 136, 139],
	[136, 136, 139],
];
const TTK_SEEDS = [1337, 42, 7];

for (let w = 0; w < REAL_WEAPON_TTK.size(); w++) {
	const { weapon, label, opts } = REAL_WEAPON_TTK[w];
	describe(`boss.act1 TTK with the real weapons: ${label}`, () => {
		for (let k = 0; k < TTK_SEEDS.size(); k++) {
			const seed = TTK_SEEDS[k];
			it(`seed ${seed}: 2..4 minutes (README: ~${README_TTK[w][k]} s)`, () => {
				const log = runFight(seed, 6 * 60 * SIM_HZ, makeWeaponBot(seed + 11, opts), true, [weapon, undefined]);
				const ttk = SECONDS(log.deathTick - log.engageTick);
				let dealt = 0;
				for (const t of log.ticks) dealt += t.damageDealt;
				print(
					`[boss.act1] seed ${seed}: ${weapon} (${string.format("%.0f", opts.duty * 100)}% uptime) TTK ${
						log.deathTick > 0 ? string.format("%.1f", ttk) : "> 360"
					} s, hp dealt ${string.format("%.0f", dealt)}`,
				);
				expect(log.deathTick).toBeGreaterThan(0);
				expect(ttk).toBeGreaterThanOrEqual(120);
				expect(ttk).toBeLessThanOrEqual(240);
				// The README rounds the printed one-decimal TTK (202.5 -> 203): within 0.55 s of the table.
				expect(math.abs(ttk - README_TTK[w][k])).toBeLessThan(0.55);
			});
		}
	});
}
