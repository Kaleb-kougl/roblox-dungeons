/**
 * Test support for specs (never imported by the game): the tutorial bot (docs/TUTORIAL.md T4). It plays
 * buildTutorialRunConfig() through the real client loop (shared/play LiveRun, one SIM_DT frame per tick) and feeds the
 * TutorialDirector every frame exactly as the client will (state, LiveRun.frameEvents, the frame's raw buttons, dt).
 *
 * The route: Continue on the objective card (a FIRE press once the card has been up long enough), walk, drink the
 * flask, then each floor-1 lesson room in `order` (default: the tour, TUTORIAL_ROOMS): attack the dummies / swarmers
 * with the sword, roll once for the sniper, guard the bruiser's ring (ALT when a bullet comes close), swap to the bow
 * and release a heavy arrow at the turret sniper, burn an Ember in the sprayer storm, take the relic, accept the curse
 * (SHRINE_BUTTON), take the stairwell, confirm the centre draft card, then melee Mother Bramble on floor 2 (the player
 * is harmless, so it tanks; optionally with the debug boss damage, J) and take the stairwell she opens. It records the
 * boss fight's milestones (engaged, phases with the HUD bar's fill, dead) for the fast-boss spec.
 *
 * Walking: straight at the target when it is in the same room with a clear line (three parallel lines of sight, a
 * player radius apart: tutorial floors have solid pillars), else a BFS distance field over FLOOR tiles to the target
 * (endlessBot's, which walks round pillars), avoiding the open floor-1 stairwell until it is the target. The bow
 * only shoots with a line of sight (else it walks the field round the pillar). Every tick checks the harmless rule: hearts never fall below the start, and never fall at
 * all except when the max falls (a curse).
 */
import { TUTORIAL } from "shared/config";
import { bulletBlocker, gridToWorld, lineOfSight, worldToGrid } from "shared/dungeon";
import { LiveRun, findBoss, takeSnapshot } from "shared/play";
import {
	BOW,
	Button,
	DRAFT_CONFIRM_BUTTON,
	DRAFT_MIN_OPEN_TICKS,
	NO_KIND,
	PLAYER_RADIUS,
	SHRINE_BUTTON,
	SIM_DT,
	SIM_HZ,
	SOLO_PLAYER,
	ScoreSource,
	archetypeAt,
	atShrine,
	isDraftOpen,
	weaponIndex,
	type ActorState,
	type InputFrame,
	type SimState,
} from "shared/sim";
import { TUTORIAL_STEPS, TutorialDirector, type TutorialView } from "shared/tutorial";
import { TUTORIAL_ROOMS, buildTutorialRunConfig, tutorialRoom, type TutorialLessonId } from "../tutorial";
import type { EndlessRunSetup } from "../endless";
import { distanceField, frame, walkDir, type Field } from "./endlessBot";

export interface TutorialBotOptions {
	/** Floor-1 lesson rooms after the entrance, in visit order (default: the tour). */
	readonly order?: ReadonlyArray<TutorialLessonId>;
	/** Drink the flask after this lesson room instead of in the entrance (an out-of-order run). */
	readonly flaskAfter?: TutorialLessonId;
	/** Press the debug boss damage (J, DEBUG_BOSS) every this many ticks of the boss fight (0 / absent: never). */
	readonly bossDebugEvery?: number;
	/** Give up after this many ticks in total (default 20 minutes of sim time). */
	readonly maxTicks?: number;
}

export interface TutorialBotResult {
	readonly setup: EndlessRunSetup;
	readonly run: LiveRun;
	readonly director: TutorialDirector;
	readonly view: Readonly<TutorialView>;
	/** Per step (TUTORIAL_STEPS order): the tick it was first reported done, -1 never. */
	readonly stepDoneTicks: ReadonlyArray<number>;
	/** Every TutorialView.newFunnelSteps entry, in the order reported. */
	readonly funnelSteps: ReadonlyArray<number>;
	/** Every callout key fired, in order. */
	readonly callouts: ReadonlyArray<string>;
	/** Distinct prompt ids shown, in first-shown order. */
	readonly prompts: ReadonlyArray<string>;
	/** Broken harmless-rule checks (empty = hearts behaved). */
	readonly heartProblems: ReadonlyArray<string>;
	readonly startHearts: number;
	/** Ticks played when the director reported finished (or when the bot gave up). */
	readonly ticks: number;
	/** Milestones (tick, floor, hearts) for the spec log. */
	readonly log: ReadonlyArray<string>;
	/** The Mother Bramble fight: engaged (events.bossEngaged) to dead (events.bossDefeated), ticks; -1 when unfinished. */
	readonly bossEngagedTick: number;
	readonly bossDefeatedTick: number;
	/** Her hpMax at the engage (the tutorial's bossHpPercent of her Depth 1 hp). */
	readonly bossHpMax: number;
	/** Per phase number (index; 0 unused): the tick it started (events.bossPhase), -1 never. */
	readonly bossPhaseTicks: ReadonlyArray<number>;
	/**
	 * Per phase number: the HUD boss bar's fill (takeSnapshot bossHp / bossHpMax) on the tick it started, -1 never.
	 * Phases 2 and 3 start on the phase marks (the bar's notches), so these are the notch fractions.
	 */
	readonly bossPhaseFill: ReadonlyArray<number>;
}

const DEFAULT_MAX_TICKS = 20 * 60 * SIM_HZ;
/** Per-phase tick budgets (a stuck phase gives up instead of spinning to the global cap). */
const WALK_BUDGET = 60 * SIM_HZ;
const FIGHT_BUDGET = 90 * SIM_HZ;
const BOSS_BUDGET = 8 * 60 * SIM_HZ;
/** Sword targets within this range get swung at (SWORD_DATA.reach 1.955 minus a margin, centre to centre). */
const MELEE_RANGE = 1.2;
/** Enemies this close to the player count as the room's (a swarmer that followed it out). */
const CHASE_RANGE = 4;
/** Guard when an enemy bullet is this close (SWORD_DATA.guardReach 1.9). */
const GUARD_TRIGGER = 1.8;
/** Hold ALT this many ticks for a heavy arrow (BOW_DATA.chargeTicks 36, plus a margin). */
const CHARGE_TICKS = 42;
/** Stand-off distance with the bow. */
const BOW_RANGE = 5;
/** Ticks to wait for enemy bullets before burning the Ember anyway. */
const EMBER_WAIT = 4 * SIM_HZ;
/** "Arrived" at a walk target, world units. */
const ARRIVE = 0.6;

function dist2(ax: number, az: number, bx: number, bz: number): number {
	const dx = ax - bx;
	const dz = az - bz;
	return dx * dx + dz * dz;
}

function unit(dx: number, dz: number): [number, number] {
	const len = math.sqrt(dx * dx + dz * dz);
	return len > 1e-9 ? [dx / len, dz / len] : [0, 0];
}

class TutorialBot {
	readonly setup = buildTutorialRunConfig();
	readonly run: LiveRun;
	readonly state: SimState;
	readonly director = new TutorialDirector();
	view: Readonly<TutorialView>;
	readonly stepDoneTicks: number[] = [];
	readonly funnelSteps: number[] = [];
	readonly callouts: string[] = [];
	readonly prompts: string[] = [];
	readonly heartProblems: string[] = [];
	readonly log: string[] = [];
	readonly startHearts: number;
	bossEngagedTick = -1;
	bossDefeatedTick = -1;
	bossHpMax = 0;
	readonly bossPhaseTicks: number[] = [-1, -1, -1, -1];
	readonly bossPhaseFill: number[] = [-1, -1, -1, -1];
	private prevHearts: number;
	private prevMax: number;
	private readonly fields = new Map<string, Field>();
	private readonly bowIndex = weaponIndex(BOW.id);

	constructor(readonly maxTicks: number) {
		const spawn = this.setup.spawn!;
		this.run = new LiveRun({
			seed: TUTORIAL.runSeed,
			spawnX: spawn.x,
			spawnZ: spawn.z,
			config: this.setup.config,
			atBossDoor: false,
		});
		this.state = this.run.state;
		for (let i = 0; i < TUTORIAL_STEPS.size(); i++) this.stepDoneTicks.push(-1);
		this.startHearts = this.run.state.player.hearts;
		this.prevHearts = this.startHearts;
		this.prevMax = this.run.state.player.heartsMax;
		this.view = this.director.getView();
	}

	floor(): number {
		return this.state.endless!.floor;
	}

	world() {
		return this.setup.endlessFloor(this.floor());
	}

	finished(): boolean {
		return this.view.finished;
	}

	out(): boolean {
		return this.finished() || this.state.tick >= this.maxTicks;
	}

	note(what: string): void {
		const p = this.state.player;
		this.log.push(`${what}: tick ${this.state.tick} floor ${this.floor()} hearts ${p.hearts}/${p.heartsMax}`);
	}

	/** One frame = one tick (LiveRun with dt = SIM_DT), then the director. */
	tick(input: InputFrame): void {
		this.run.frame(SIM_DT, input);
		const v = this.director.update({
			state: this.run.state,
			config: this.setup.config,
			events: this.run.frameEvents,
			buttons: input.buttons,
			dt: SIM_DT,
		});
		this.view = v;
		const t = this.state.tick;
		for (let i = 0; i < v.done.size(); i++) if (v.done[i] && this.stepDoneTicks[i] < 0) this.stepDoneTicks[i] = t;
		for (const n of v.newFunnelSteps) this.funnelSteps.push(n);
		for (const c of v.callouts) this.callouts.push(c);
		if (v.prompt !== "" && !this.prompts.includes(v.prompt)) this.prompts.push(v.prompt);
		const p = this.state.player;
		if (p.hearts < this.startHearts)
			this.heartProblems.push(`tick ${t}: hearts ${p.hearts} < start ${this.startHearts}`);
		if (p.hearts < this.prevHearts && p.heartsMax >= this.prevMax) {
			this.heartProblems.push(`tick ${t}: hearts ${this.prevHearts} -> ${p.hearts} (max ${p.heartsMax})`);
		}
		if (p.dead !== 0) this.heartProblems.push(`tick ${t}: dead`);
		this.prevHearts = p.hearts;
		this.prevMax = p.heartsMax;
		this.watchBoss();
	}

	/** The boss fight's milestones (engaged, each phase with the HUD bar's fill, dead). */
	private watchBoss(): void {
		const ev = this.run.frameEvents;
		const t = this.state.tick;
		const boss = findBoss(this.state);
		if (ev.bossEngaged !== 0 && this.bossEngagedTick < 0) {
			this.bossEngagedTick = t;
			this.bossHpMax = boss?.hpMax ?? 0;
		}
		const phase = ev.bossPhase;
		if (phase > 0 && phase < this.bossPhaseTicks.size() && this.bossPhaseTicks[phase] < 0) {
			this.bossPhaseTicks[phase] = t;
			const snap = takeSnapshot(this.state, { paused: false, outcome: "playing", recordedTicks: t });
			this.bossPhaseFill[phase] = snap.bossHp / snap.bossHpMax;
		}
		if (ev.bossDefeated !== 0 && this.bossDefeatedTick < 0) this.bossDefeatedTick = t;
	}

	idle(ticks: number): void {
		for (let i = 0; i < ticks && !this.out(); i++) this.tick(frame(0, 0));
	}

	/** One press of `button` (down one tick, then up one tick), moving (mx, mz) and aiming (ax, az). */
	press(button: number, mx = 0, mz = 0, ax = 0, az = 0): void {
		this.tick(frame(mx, mz, button, ax, az));
		this.tick(frame(mx, mz, 0, ax, az));
	}

	stepDone(id: string): boolean {
		for (let i = 0; i < TUTORIAL_STEPS.size(); i++) if (TUTORIAL_STEPS[i].id === id) return this.view.done[i];
		return false;
	}

	/** The open floor-1 stairwell (avoided by every walk that is not going there). */
	private avoid(): readonly [number, number] | undefined {
		if (this.floor() !== 1) return undefined;
		const w = this.world();
		return [w.stairX, w.stairZ];
	}

	private field(tx: number, tz: number, avoidStairs: boolean): Field {
		const gx = worldToGrid(tx);
		const gz = worldToGrid(tz);
		const key = `${this.floor()}:${gx}:${gz}:${avoidStairs}`;
		let f = this.fields.get(key);
		if (f === undefined) {
			f = distanceField(
				this.world().dungeon,
				gridToWorld(gx),
				gridToWorld(gz),
				avoidStairs ? this.avoid() : undefined,
			);
			this.fields.set(key, f);
		}
		return f;
	}

	/** A bullet's line of sight from the player to (tx, tz) (solid pillars and walls block it). */
	sees(tx: number, tz: number): boolean {
		const p = this.state.player;
		return lineOfSight(bulletBlocker(this.world().dungeon), p.x, p.z, tx, tz);
	}

	/** The player's body fits along the straight line to (tx, tz): the centre line and both sides are clear. */
	private clearPath(tx: number, tz: number): boolean {
		const p = this.state.player;
		const [ux, uz] = unit(tx - p.x, tz - p.z);
		const ox = -uz * PLAYER_RADIUS;
		const oz = ux * PLAYER_RADIUS;
		const blocked = bulletBlocker(this.world().dungeon);
		return (
			lineOfSight(blocked, p.x, p.z, tx, tz) &&
			lineOfSight(blocked, p.x + ox, p.z + oz, tx + ox, tz + oz) &&
			lineOfSight(blocked, p.x - ox, p.z - oz, tx - ox, tz - oz)
		);
	}

	/**
	 * The unit move toward world (tx, tz): straight when in the same room with a clear path, else along the distance
	 * field (round pillars, through corridors).
	 */
	private dirTo(tx: number, tz: number, avoidStairs = true): [number, number] {
		const p = this.state.player;
		const w = this.world();
		const here = w.roomIdAt(p.x, p.z);
		if (here >= 0 && here === w.roomIdAt(tx, tz) && this.clearPath(tx, tz)) return unit(tx - p.x, tz - p.z);
		return walkDir(this.field(tx, tz, avoidStairs), p.x, p.z);
	}

	/** Walks to (tx, tz) until `done()` (or arrival when absent), the floor changes, or the budget runs out. */
	walkTo(tx: number, tz: number, done?: () => boolean, avoidStairs = true, buttons = 0): void {
		const startFloor = this.floor();
		let n = 0;
		while (n < WALK_BUDGET && !this.out() && this.floor() === startFloor) {
			if (done !== undefined ? done() : dist2(this.state.player.x, this.state.player.z, tx, tz) < ARRIVE * ARRIVE)
				return;
			const [mx, mz] = this.dirTo(tx, tz, avoidStairs);
			this.tick(frame(mx, mz, buttons));
			n++;
		}
	}

	roomEntered(lesson: TutorialLessonId): boolean {
		return (this.state.endless!.roomsEntered[tutorialRoom(lesson).roomId] ?? 0) !== 0;
	}

	roomCleared(lesson: TutorialLessonId): boolean {
		const id = tutorialRoom(lesson).roomId;
		for (const r of this.state.score?.rooms ?? []) if (r.room === id) return r.cleared !== 0;
		return false;
	}

	/** Walks into the lesson room (its centre) until it is entered and the player is a little way in. */
	enter(lesson: TutorialLessonId): void {
		const room = tutorialRoom(lesson);
		const inside = () => {
			const p = this.state.player;
			return this.roomEntered(lesson) && this.world().roomIdAt(p.x, p.z) === room.roomId;
		};
		this.walkTo(room.center.x, room.center.z, inside);
		this.note(`entered ${lesson}`);
	}

	/** The nearest living non-boss enemy in the room (or chasing the player), or undefined. */
	target(roomId: number): ActorState | undefined {
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

	bowInHand(): boolean {
		const w = this.state.combat.weapons;
		return w.sets[w.activeSet].weapon === this.bowIndex;
	}

	/** Swaps until the bow is (true) or is not (false) in hand. */
	wield(bow: boolean): void {
		let n = 0;
		while (this.bowInHand() !== bow && n < 4 && !this.out()) {
			this.press(Button.SWAP);
			n++;
		}
	}

	/** The nearest enemy bullet's distance from the player (math.huge for none). */
	nearestBullet(): number {
		const p = this.state.player;
		let best = math.huge;
		this.state.combat.enemyBullets.forEachActive((_i, pos) => {
			const d = dist2(pos.x, pos.z, p.x, p.z);
			if (d < best) best = d;
		});
		return math.sqrt(best);
	}

	/**
	 * Fights the room's enemies until its scoring record clears (or the budget runs out). Sword: close in and hold
	 * FIRE; bow: hold BOW_RANGE and hold FIRE. `extra(target, n)` may return buttons to add this tick (guard, ...),
	 * or undefined to fight normally.
	 */
	fight(lesson: TutorialLessonId, extra?: (a: ActorState, n: number) => number | undefined): void {
		const roomId = tutorialRoom(lesson).roomId;
		const room = tutorialRoom(lesson);
		let n = 0;
		while (n < FIGHT_BUDGET && !this.out() && !this.roomCleared(lesson) && this.floor() === 1) {
			const a = this.target(roomId);
			const p = this.state.player;
			if (a === undefined) {
				// Everyone down (turrets waiting to revive) or not spawned yet: stand at the centre.
				const [mx, mz] = this.dirTo(room.center.x, room.center.z);
				this.tick(frame(mx, mz));
				n++;
				continue;
			}
			const [ax, az] = unit(a.x - p.x, a.z - p.z);
			const d = math.sqrt(dist2(a.x, a.z, p.x, p.z));
			const special = extra !== undefined ? extra(a, n) : undefined;
			let mx = 0;
			let mz = 0;
			if (this.bowInHand()) {
				if (d > BOW_RANGE || !this.sees(a.x, a.z)) [mx, mz] = this.dirTo(a.x, a.z);
				else if (d < BOW_RANGE - 1.5) [mx, mz] = [-ax, -az];
			} else if (d > MELEE_RANGE) {
				[mx, mz] = this.dirTo(a.x, a.z);
			}
			this.tick(frame(mx, mz, special ?? Button.FIRE, ax, az));
			n++;
		}
		this.note(`${lesson} ${this.roomCleared(lesson) ? "cleared" : "NOT cleared"}`);
	}

	// --- lessons ----------------------------------------------------------------------------

	objective(): void {
		this.idle(math.ceil(TUTORIAL.objectiveCardMinSeconds * SIM_HZ) + 1);
		this.press(Button.FIRE);
		this.note("objective");
	}

	walkABit(): void {
		const first = tutorialRoom(TUTORIAL_ROOMS[1].lesson);
		this.walkTo(first.door.x, first.door.z, () => this.stepDone("move"));
		this.note("moved");
	}

	flask(): void {
		const before = this.state.player.flask;
		let n = 0;
		while (this.state.player.flask === before && n < 4 && !this.out()) {
			this.press(Button.FLASK);
			n++;
		}
		this.idle(30); // drinking
		this.note("flask");
	}

	lesson(lesson: TutorialLessonId): void {
		if (this.floor() !== 1 || this.out()) return;
		if (lesson === "entrance") return;
		if (lesson === "treasure") {
			const room = tutorialRoom(lesson);
			const me = this.state.run!.players[SOLO_PLAYER];
			const before = me.relics.size();
			this.walkTo(room.center.x, room.center.z, () => me.relics.size() > before);
			this.note("relic");
			return;
		}
		if (lesson === "shrine") {
			const room = tutorialRoom(lesson);
			const zone = () => atShrine(this.state, this.setup.config, SOLO_PLAYER);
			this.walkTo(room.center.x, room.center.z);
			if (!zone()) this.walkTo(room.center.x, room.center.z, zone);
			this.press(SHRINE_BUTTON);
			this.note("curse");
			return;
		}
		if (lesson === "stairwell") {
			const w = this.world();
			this.walkTo(w.stairX, w.stairZ, () => this.floor() !== 1, false);
			this.note("stairwell");
			return;
		}
		this.enter(lesson);
		if (lesson === "combatA" || lesson === "combatB") {
			this.wield(false);
			this.fight(lesson);
		} else if (lesson === "combatC") {
			this.wield(false);
			const p = this.state.player;
			const a = this.target(tutorialRoom(lesson).roomId);
			const [ax, az] = a !== undefined ? unit(a.x - p.x, a.z - p.z) : [1, 0];
			this.press(Button.ROLL, ax, az, ax, az);
			this.fight(lesson);
		} else if (lesson === "combatD") {
			this.wield(false);
			const guardBase = this.state.score!.counts[ScoreSource.GUARD];
			let lastAlt = false;
			this.fight(lesson, () => {
				if (this.state.score!.counts[ScoreSource.GUARD] > guardBase) return undefined;
				// Guard (ALT press edge) when a bullet comes close; otherwise stand and face it (no swings yet).
				const want = this.nearestBullet() < GUARD_TRIGGER && !lastAlt;
				lastAlt = want;
				return want ? Button.ALT : 0;
			});
		} else if (lesson === "combatE") {
			this.wield(true);
			const roomId = tutorialRoom(lesson).roomId;
			// Close to bow range with a line of sight (it may stand behind a pillar), charge, release at the turret.
			let n = 0;
			for (;;) {
				const a = this.target(roomId);
				const p = this.state.player;
				if (a === undefined || n > WALK_BUDGET || this.out()) break;
				if (dist2(a.x, a.z, p.x, p.z) <= BOW_RANGE * BOW_RANGE && this.sees(a.x, a.z)) break;
				const [mx, mz] = this.dirTo(a.x, a.z);
				this.tick(frame(mx, mz));
				n++;
			}
			for (let i = 0; i < CHARGE_TICKS && !this.out(); i++) {
				const a = this.target(roomId);
				const p = this.state.player;
				const [ax, az] = a !== undefined ? unit(a.x - p.x, a.z - p.z) : [0, 0];
				this.tick(frame(0, 0, Button.ALT, ax, az));
			}
			this.tick(frame(0, 0));
			this.note("heavy arrow");
			this.fight(lesson);
			this.wield(false);
		} else if (lesson === "combatF") {
			this.wield(false);
			let embered = false;
			this.fight(lesson, (_a, n) => {
				if (embered || this.state.player.embers === 0) return undefined;
				if (this.state.combat.enemyBullets.activeCount > 0 || n >= EMBER_WAIT) {
					embered = true;
					return Button.EMBER;
				}
				return undefined;
			});
		}
	}

	draft(): void {
		let n = 0;
		while (!isDraftOpen(this.state) && n < SIM_HZ && !this.out()) {
			this.tick(frame(0, 0));
			n++;
		}
		const p = this.state.run?.players[SOLO_PLAYER];
		if (p === undefined || !isDraftOpen(this.state)) return;
		while (p.draftTicks + 1 < DRAFT_MIN_OPEN_TICKS && !this.out()) this.tick(frame(0, 0));
		this.press(DRAFT_CONFIRM_BUTTON);
		this.note(`draft (boons ${p.boons.size()})`);
	}

	boss(debugEvery: number): void {
		let n = 0;
		while (n < BOSS_BUDGET && !this.out() && this.floor() === TUTORIAL.lastFloor) {
			if (this.state.endless!.depth > 1) break;
			let boss: ActorState | undefined;
			for (const a of this.state.combat.actors) {
				if (a.kind !== NO_KIND && a.alive !== 0 && archetypeAt(a.kind).data.boss === true) boss = a;
			}
			if (boss === undefined) {
				this.tick(frame(0, 0));
				n++;
				continue;
			}
			const p = this.state.player;
			const [ax, az] = unit(boss.x - p.x, boss.z - p.z);
			const d = math.sqrt(dist2(boss.x, boss.z, p.x, p.z));
			const reach = MELEE_RANGE + archetypeAt(boss.kind).data.radius;
			const [mx, mz] = d > reach ? this.dirTo(boss.x, boss.z, false) : [0, 0];
			let buttons: number = Button.FIRE;
			if (debugEvery > 0 && n % debugEvery === debugEvery - 1) buttons = bit32.bor(buttons, Button.DEBUG_BOSS);
			this.tick(frame(mx, mz, buttons, ax, az));
			n++;
		}
		this.note("boss down");
	}

	finish(): void {
		const w = this.world();
		this.walkTo(w.stairX, w.stairZ, () => this.finished() || this.floor() > TUTORIAL.lastFloor, false);
		this.note("finished");
	}
}

/** Plays the tutorial with the bot (see the file comment) and returns what the director reported. */
export function playTutorial(options: TutorialBotOptions = {}): TutorialBotResult {
	const bot = new TutorialBot(options.maxTicks ?? DEFAULT_MAX_TICKS);
	const order = options.order ?? TUTORIAL_ROOMS.map((r) => r.lesson);
	bot.objective();
	bot.walkABit();
	if (options.flaskAfter === undefined) bot.flask();
	for (const lesson of order) {
		bot.lesson(lesson);
		if (options.flaskAfter === lesson) bot.flask();
	}
	bot.draft();
	bot.boss(options.bossDebugEvery ?? 0);
	bot.finish();
	return {
		setup: bot.setup,
		run: bot.run,
		director: bot.director,
		view: bot.view,
		stepDoneTicks: bot.stepDoneTicks,
		funnelSteps: bot.funnelSteps,
		callouts: bot.callouts,
		prompts: bot.prompts,
		heartProblems: bot.heartProblems,
		startHearts: bot.startHearts,
		ticks: bot.state.tick,
		log: bot.log,
		bossEngagedTick: bot.bossEngagedTick,
		bossDefeatedTick: bot.bossDefeatedTick,
		bossHpMax: bot.bossHpMax,
		bossPhaseTicks: bot.bossPhaseTicks,
		bossPhaseFill: bot.bossPhaseFill,
	};
}
