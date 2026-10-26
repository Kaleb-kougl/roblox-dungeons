/**
 * Test support for specs (never imported by the game): the tutorial bot (docs/TUTORIAL.md T4). It plays
 * buildTutorialRunConfig() through the real client loop (shared/play LiveRun, one SIM_DT frame per tick) and feeds the
 * TutorialDirector every frame exactly as the client will (state, LiveRun.frameEvents, the frame's raw buttons, dt).
 *
 * The route: Continue on the objective card (a FIRE press once the card has been up long enough), walk, drink the
 * flask, then each floor-1 lesson room in `order` (default: the tour, TUTORIAL_ROOMS): attack the dummies / swarmers
 * with the sword (and after each fight walk over any boost drop lying on the floor: combat B's guaranteed Fury,
 * docs/BOOSTS.md B9), roll once for the sniper, guard the bruiser's ring (ALT when a bullet comes close), swap to the bow
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
 *
 * `steer: "guide"` (docs/TUTORIAL_ARROW.md A3) walks by the guidance arrow's heading (shared/tutorial TutorialGuide)
 * instead, while the arrow shows: the proof that the arrow never sends a player into a wall.
 */
import { TUTORIAL } from "shared/config";
import { bulletBlocker, clearWalk, gridToWorld, lineOfSight, worldToGrid } from "shared/dungeon";
import { LiveRun, findBoss, takeSnapshot } from "shared/play";
import {
	BOOST_COUNT,
	BOW,
	Button,
	DRAFT_CONFIRM_BUTTON,
	DRAFT_MIN_OPEN_TICKS,
	NO_BOOST,
	NO_KIND,
	PLAYER_RADIUS,
	SHRINE_BUTTON,
	SIM_DT,
	SIM_HZ,
	SOLO_PLAYER,
	ScoreSource,
	archetypeAt,
	atShrine,
	boostTicksLeft,
	dropsEvents,
	dropsGround,
	isDraftOpen,
	weaponIndex,
	type ActorState,
	type InputFrame,
	type SimState,
} from "shared/sim";
import { TUTORIAL_STEPS, TutorialDirector, TutorialGuide, type TutorialView } from "shared/tutorial";
import { TUTORIAL_VIEW } from "shared/view/hud";
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
	/**
	 * How walkTo steers (docs/TUTORIAL_ARROW.md A3): "bot" (default) its own straight line / distance field; "guide" the
	 * guidance arrow's heading (a TutorialGuide fed the director's marker every tick, target never on screen) while
	 * the arrow shows, and its own steering only while it is hidden (no marker, or within arrowHideTiles of it).
	 */
	readonly steer?: "bot" | "guide";
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
	/** Every callout key fired, in order, and the tick each fired on. */
	readonly callouts: ReadonlyArray<string>;
	readonly calloutTicks: ReadonlyArray<number>;
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
	/** Ticks spent in walkTo (the walks between and into lesson rooms, to the stairwells), either steer. */
	readonly walkTicks: number;
	/** steer "guide": walkTo ticks steered by the arrow's heading, and ticks its target was unreachable (0 = none). */
	readonly guidedTicks: number;
	readonly guideUnreachableTicks: number;
	/** The first tick a boost drop lay on the floor (-1 never). */
	readonly dropLandedTick: number;
	/** The first tick a boost ran on the player (its pickup; -1 never). */
	readonly boostTakenTick: number;
	/** Distinct TutorialView marker kinds seen, in first-seen order. */
	readonly markerKinds: ReadonlyArray<string>;
	/** Distinct TutorialView highlights seen, in first-seen order. */
	readonly highlights: ReadonlyArray<string>;
	/** Boost drops that landed, and drops picked up (the sim's per-tick drop events; the bot runs one tick per frame). */
	readonly dropsLanded: number;
	readonly dropsTaken: number;
	/** Frames whose marker pointed at a ground drop, and how many of them matched a lying drop's position. */
	readonly dropMarkerFrames: number;
	readonly dropMarkerOnDrop: number;
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
	readonly calloutTicks: number[] = [];
	readonly prompts: string[] = [];
	readonly heartProblems: string[] = [];
	readonly log: string[] = [];
	readonly startHearts: number;
	bossEngagedTick = -1;
	bossDefeatedTick = -1;
	bossHpMax = 0;
	readonly bossPhaseTicks: number[] = [-1, -1, -1, -1];
	readonly bossPhaseFill: number[] = [-1, -1, -1, -1];
	dropLandedTick = -1;
	boostTakenTick = -1;
	readonly markerKinds: string[] = [];
	readonly highlights: string[] = [];
	dropMarkerFrames = 0;
	dropMarkerOnDrop = 0;
	dropsLanded = 0;
	dropsTaken = 0;
	private prevHearts: number;
	private prevMax: number;
	private readonly fields = new Map<string, Field>();
	private readonly bowIndex = weaponIndex(BOW.id);
	walkTicks = 0;
	guidedTicks = 0;
	guideUnreachableTicks = 0;
	private readonly guide: TutorialGuide | undefined;

	constructor(readonly maxTicks: number, steer: "bot" | "guide" = "bot") {
		this.guide = steer === "guide" ? new TutorialGuide(TUTORIAL_VIEW) : undefined;
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
		for (const c of v.callouts) {
			this.callouts.push(c);
			this.calloutTicks.push(t);
		}
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
		if (this.guide !== undefined) {
			const g = this.guide.update({
				dungeon: this.world().dungeon,
				target: v.marker,
				px: p.x,
				pz: p.z,
				targetOnScreen: false,
				dt: SIM_DT,
			});
			if (g.unreachable) this.guideUnreachableTicks++;
		}
		this.watchDrops();
	}

	/** True while a boost drop lies on the floor. */
	dropLying(): boolean {
		for (const g of dropsGround(this.state)) if (g.kind !== NO_BOOST) return true;
		return false;
	}

	/** The drop landing, the pickup, and what the director's marker / highlight did meanwhile. */
	private watchDrops(): void {
		const t = this.state.tick;
		const v = this.view;
		const ev = dropsEvents(this.state);
		if (ev !== undefined) {
			this.dropsLanded += ev.dropped.size();
			this.dropsTaken += ev.collected.size();
		}
		if (this.dropLandedTick < 0 && (this.dropLying() || this.dropsTaken > 0)) this.dropLandedTick = t;
		if (this.boostTakenTick < 0) {
			for (let k = 0; k < BOOST_COUNT; k++)
				if (boostTicksLeft(this.state, SOLO_PLAYER, k) > 0) this.boostTakenTick = t;
		}
		const kind = v.marker?.kind;
		if (kind !== undefined && !this.markerKinds.includes(kind)) this.markerKinds.push(kind);
		if (v.highlight !== undefined && !this.highlights.includes(v.highlight)) this.highlights.push(v.highlight);
		if (kind === "drop") {
			this.dropMarkerFrames++;
			for (const g of dropsGround(this.state)) {
				if (g.kind !== NO_BOOST && g.x === v.marker!.x && g.z === v.marker!.z) {
					this.dropMarkerOnDrop++;
					break;
				}
			}
		}
	}

	/** Walks over every boost drop lying on the floor (nearest first) until none is left or the walk budget runs out. */
	collectDrops(): void {
		while (this.dropLying() && !this.out() && this.floor() === 1) {
			const p = this.state.player;
			let tx = 0;
			let tz = 0;
			let best = math.huge;
			for (const g of dropsGround(this.state)) {
				if (g.kind === NO_BOOST) continue;
				const d = dist2(g.x, g.z, p.x, p.z);
				if (d < best) {
					best = d;
					tx = g.x;
					tz = g.z;
				}
			}
			const before = this.state.tick;
			this.walkTo(
				tx,
				tz,
				() => !this.dropLying() || dist2(tx, tz, this.state.player.x, this.state.player.z) < 1e-4,
			);
			if (this.state.tick === before) break;
		}
		if (this.boostTakenTick >= 0) this.note("boost taken");
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
		return clearWalk(bulletBlocker(this.world().dungeon), p.x, p.z, tx, tz, PLAYER_RADIUS);
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
			const [mx, mz] = this.steerTo(tx, tz, avoidStairs);
			this.tick(frame(mx, mz, buttons));
			n++;
			this.walkTicks++;
		}
	}

	/** walkTo's move: dirTo, or (steer "guide") the arrow's heading while it shows. */
	private steerTo(tx: number, tz: number, avoidStairs: boolean): [number, number] {
		const g = this.guide?.getView();
		if (g === undefined || !g.visible) return this.dirTo(tx, tz, avoidStairs);
		this.guidedTicks++;
		return [math.sin(g.heading), math.cos(g.heading)];
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
			this.collectDrops();
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
	const bot = new TutorialBot(options.maxTicks ?? DEFAULT_MAX_TICKS, options.steer);
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
		calloutTicks: bot.calloutTicks,
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
		walkTicks: bot.walkTicks,
		guidedTicks: bot.guidedTicks,
		guideUnreachableTicks: bot.guideUnreachableTicks,
		dropLandedTick: bot.dropLandedTick,
		boostTakenTick: bot.boostTakenTick,
		markerKinds: bot.markerKinds,
		highlights: bot.highlights,
		dropsLanded: bot.dropsLanded,
		dropsTaken: bot.dropsTaken,
		dropMarkerFrames: bot.dropMarkerFrames,
		dropMarkerOnDrop: bot.dropMarkerOnDrop,
	};
}
