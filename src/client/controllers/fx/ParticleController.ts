import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { RunService, Workspace } from "@rbxts/services";
import { CAMERA_PITCH_DEG } from "shared/config";
import type { JuiceSettings } from "shared/settings";
import { IMP, MAX_ACTORS, archetypeAt, archetypeIds, archetypeIndex, partySize, playerAt } from "shared/sim";
import {
	BOOST_KINDS,
	BREAKABLE_KINDS,
	GOLDEN_COIN_ROLE,
	TREASURE_FLOOR_ROLES,
	pelletId,
	type ColorRole,
} from "shared/theme";
import { BOOST_VIEW, type BoostBurstView } from "shared/view/boosts";
import {
	BLINK_VIEW,
	BREAKABLE_LOOT_VIEW,
	BREAKABLE_VIEW,
	BlinkWatch,
	DETONATION_VIEW,
	DetonationWatch,
	RENDER_ORDER,
	degToRad,
	floorStudsY,
	studsX,
	newEnemyKinds,
	studsZ,
	type BlinkWatchState,
	type DetonationWatchState,
} from "shared/view";
import {
	BUILD_FX_VIEW,
	DeathParticleSystem,
	FX_VIEW,
	NEAR_MISS_VIEW,
	PALETTE_KIND_BASE,
	PAL_SPARK,
	PARTICLE_QUAD_CAPACITY,
	RING_SEGMENTS,
	ROOM_CLEAR,
	TEAM_MOMENTS_VIEW,
	burstSeed,
	effectiveParticles,
	particleColorRole,
	type ChipBurst,
	type NearMissFrame,
	type ParticleWriter,
} from "shared/view/fx";
import { PELLETS_VIEW, PelletFlyIns, type PelletPowerTaken } from "shared/view/pellets";
import { TREASURE_VIEW } from "shared/view/treasure";
import { GOLDEN_VIEW, goldenKind, type GoldenBurstView } from "shared/view/golden";
import { SimController } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import { renderPart } from "../render/placeholders";
import { FxTrackerController } from "./FxTrackerController";
import { NearMissController } from "./NearMissController";
import { fxFolder } from "./fxHelpers";

const RENDER_STEP = "KV_Particles";
const PX = FX_VIEW.pxStuds;
/** A hop of h render px up the screen is a world lift of h px / cos(pitch) (the camera's up axis tilts back). */
const HOP_STUDS_PER_PX = PX / math.cos(degToRad(CAMERA_PITCH_DEG));
/** Particles float just above the floor (studs). */
const FLOOR_LIFT = PX / 2;
const PARKED = new CFrame(FX_VIEW.parkedStuds[0], FX_VIEW.parkedStuds[1], FX_VIEW.parkedStuds[2]);

/** One pooled particle part and what it shows now (properties are written only when they change). */
interface ParticlePart {
	readonly part: Part;
	color: number;
	size: number;
	alpha: number;
}

/**
 * Death particle bursts (port of project-kaleb-vale src/fx/particles/DeathParticlesView.tsx @ 42897e2): tracker
 * events -> the pure DeathParticleSystem (shared/view/fx particles.ts) -> pooled render-only Parts (1-3 px cubes,
 * PX studs per px), moved with ONE workspace:BulkMoveTo per frame:
 *
 *   'killed'        12-20 bits in the archetype's colour role (enemy.<id>) + ~25% uiText / particleSpark sparks, 3x3
 *                   chunks for big enemies, a ring flash of 1 px dots; elites: x1.5 and gold (enemyHealthElite) sparks
 *   'bossDefeated'  three waves over ~0.6 s in the 'boss' role (the boss's own 'killed' is skipped)
 *   'bossPhase'     a roar: ring + sparks (phases 2, 3; not the fight start)
 *   'hit'           2-3 tiny sparks (normal / high only; never displaces death particles)
 *   'reset'         drop everything
 *
 * Breakables (docs/DECOR.md D4; called by BreakableRenderController, not tracker events): `breakableChips` (a piece
 * broke: chips in its `breakable.<kind>` role, appended to the palette after the archetypes, + sparks;
 * BREAKABLE_VIEW.chips) and `breakableHitSparks` (a piece was hit: the same tiny sparks as an actor hit).
 * Boost drops (docs/BOOSTS.md B6; called by BoostDropRenderController): `boostBurst` (a pickup without
 * `fx.boost.collect` art: BOOST_VIEW.collectBurst; a drop fading: BOOST_VIEW.poofBurst), in the kind's `boost.<kind>`
 * role, appended to the palette after the breakables.
 * Grazes and parries (docs/GRAZE_PARRY.md GP5; NearMissController's per-frame output): per `grazeSparks` entry a
 * graze's floor sparks + streak (nearMiss.graze, no hop, no ring, never recycling), per `parryBursts` entry a fan of
 * sparks away from the guard + one ring (nearMiss.parry); both roles appended to the palette after the room clear's.
 * Seeds: burstSeed(entry index, the state's tick, NEAR_MISS_VIEW graze / parry seedSalt).
 * Builds (docs/BUILDS.md BU8; BuildFxController's per-frame output): `buildSparkBurst` (build.spark) and
 * `buildPhantomBurst` (BUILD_FX_VIEW.phantom.role), appended to the palette after the near-miss roles.
 * Boosts from breakables (docs/BREAKABLE_DROPS.md BL6; called by BoostDropRenderController): `lootFizzle` (a loaded
 * piece's boost lost on a full floor: BREAKABLE_LOOT_VIEW.fizzleBurst in its fizzleRole, appended after the builds').
 *
 * The power pellet (docs/PELLETS.md PL7; called by PelletRenderController): `pelletPower` turns each erased bullet into a
 * cube flying into the picker (shared/view/pellets PelletFlyIns, drawn through the same parts after the bursts) and
 * spawns one ring from the picker, both in pellet.power, appended to the palette after the loot fizzle's.
 * The co-op team pulse (docs/RUN_RECAP.md CM2; called by RoomClearController): `teamPulse`, the room clear's spark ring
 * on a party member at a team perfect, in TEAM_MOMENTS_VIEW.pulse.role, appended to the palette after pellet.power.
 *
 * A chest's pop (docs/TREASURE.md TR7; called by TreasureRenderController): `treasureBurst`, one ring and a chip burst
 * (TREASURE_VIEW.open.ring / burst) in the opened tier's floor role (treasure.*, appended after pellet.power); nothing
 * with Particles off (the ring too).
 *
 * The Goldling (docs/FORTUNE.md FO8; called by GoldenRenderController): `goldenBurst` (GOLDEN_VIEW's appear flash,
 * hit coins, catch fountain in golden.coin, appended to the palette after pellet.power; the escape's dive puff in the
 * archetype's own colour) and `goldenAppearRing` (one ring from its spawn, fixed under reduced motion).
 *
 * Bomber detonations (docs/NEW_ENEMIES.md NE8; shared/view DetonationWatch, a per-frame diff): DETONATION_VIEW.burst
 * chips in the Bomber's colour where it blew up (on top of its death particles); a fizzle gets the death particles only.
 * Budget: at most particleBudget(settings) live particles (128 / 320 / 512; one level lower under reducedMotion) plus
 * the ring dots, PARTICLE_QUAD_CAPACITY parts at most; the pool grows lazily and never shrinks (unused parts parked).
 * Time: real frame time (clamped to FX_VIEW.maxParticleDt) x the hitstop clock's time scale (0 frozen, the slow-mo
 * ramp), frozen while paused. Presentation only.
 */
@Controller({})
export class ParticleController implements OnStart, ParticleWriter {
	private readonly janitor = new Janitor();
	private readonly system = new DeathParticleSystem();
	private readonly parts = new Array<ParticlePart>();
	private readonly palette = new Array<Color3>();
	private readonly kindScale = new Array<number>();
	/** Palette index of BREAKABLE_KINDS[0]'s colour; chip bursts per kind (BREAKABLE_VIEW.chips). */
	private breakableBase = PAL_SPARK;
	private readonly chipBursts = new Array<ChipBurst>();
	/** Palette index of BOOST_KINDS[0]'s colour; the pickup and fade bursts (BOOST_VIEW). */
	private boostBase = PAL_SPARK;
	private collectBurst: ChipBurst | undefined;
	private poofBurst: ChipBurst | undefined;
	/** A loaded breakable's boost lost on a full floor (docs/BREAKABLE_DROPS.md BL6): its colour index and shape. */
	private fizzleColor = PAL_SPARK;
	private fizzleBurst: ChipBurst | undefined;
	/** The room clear spark ring (docs/ROOM_CLEAR.md RC5): CLEAR's colour index, PERFECT's is the next one. */
	private roomClearBase = PAL_SPARK;
	private roomClearShape: ChipBurst | undefined;
	/** The co-op team pulse's colour index (docs/RUN_RECAP.md CM2: TEAM_MOMENTS_VIEW.pulse.role; the room clear's shape). */
	private teamPulseColor = PAL_SPARK;
	/** nearMiss.graze's palette index; nearMiss.parry's is the next one (docs/GRAZE_PARRY.md GP5). */
	private nearMissBase = PAL_SPARK;
	/** build.spark's palette index (docs/BUILDS.md BU8: the spark burst at each spark target). */
	private buildSparkColor = PAL_SPARK;
	/** BUILD_FX_VIEW.phantom.role's palette index (BU8 follow-up: Phantom Step's erase sparks). */
	private buildPhantomColor = PAL_SPARK;
	/** The imp's blink puffs (docs/ENEMY_VARIANTS.md EV9): landings from a per-frame diff, the imp's kind (-1: none). */
	private readonly blinks = new BlinkWatch(MAX_ACTORS);
	private readonly blinkPuff: ChipBurst = BLINK_VIEW.puff;
	private impKind = -1;
	/** Bomber detonations (docs/NEW_ENEMIES.md NE8): a burst in the Bomber's colour where it blew up. */
	private readonly detonations = new DetonationWatch(MAX_ACTORS);
	private readonly blastBurst: ChipBurst = DETONATION_VIEW.burst;
	/** The power pellet's fly-in cubes and ring (docs/PELLETS.md PL7): pellet.power's palette index. */
	private readonly flyIns = new PelletFlyIns();
	private pelletPowerColor = PAL_SPARK;
	/** A chest's pop (docs/TREASURE.md TR7): treasure.common's palette index (rare / legendary follow), and the burst. */
	private treasureBase = PAL_SPARK;
	private treasureShape: ChipBurst | undefined;
	/** golden.coin's palette index (docs/FORTUNE.md FO8: the Goldling's flash, coins and fountain). */
	private goldenCoinColor = PAL_SPARK;
	private readonly moveParts = new Array<BasePart>();
	private readonly moveCFrames = new Array<CFrame>();
	private folder: Folder | undefined;
	/** Parts placed last frame (the ones past this frame's count get parked). */
	private lastUsed = 0;
	private used = 0;

	constructor(
		private readonly sim: SimController,
		private readonly theme: ThemeController,
		private readonly fx: FxTrackerController,
		private readonly nearMiss: NearMissController,
	) {}

	onStart(): void {
		const pack = this.theme.getPack();
		this.folder = this.janitor.Add(fxFolder(FX_VIEW.particleFolder));
		// Palette: uiText (white), particleSpark, elite gold, boss, then one colour per archetype.
		const base: ColorRole[] = ["uiText", "particleSpark", "enemyHealthElite", "boss"];
		for (const r of base) this.palette.push(pack.color(r));
		const ids = archetypeIds();
		for (let k = 0; k < ids.size(); k++) {
			const data = archetypeAt(k).data;
			this.kindScale.push(data.spriteScale ?? 1);
			this.palette.push(pack.color(particleColorRole(data)));
		}
		this.breakableBase = this.palette.size();
		const v = BREAKABLE_VIEW;
		for (let k = 0; k < BREAKABLE_KINDS.size(); k++) {
			this.palette.push(pack.breakable(BREAKABLE_KINDS[k]).color);
			const c = v.chips[k] ?? v.chips[0];
			this.chipBursts.push({
				chunks: c.chunks,
				bits: c.bits,
				sparks: c.sparks,
				startPx: v.chipStartPx,
				radius: v.chipRadiusTiles,
				speed: v.chipSpeed,
			});
		}
		this.boostBase = this.palette.size();
		for (const k of BOOST_KINDS) this.palette.push(pack.boost(k).color);
		this.collectBurst = chipBurstOf(BOOST_VIEW.collectBurst);
		this.poofBurst = chipBurstOf(BOOST_VIEW.poofBurst);
		this.roomClearBase = this.palette.size();
		this.palette.push(pack.color("uiAccent"), pack.color("ember"));
		this.roomClearShape = chipBurstOf(ROOM_CLEAR.burst);
		this.nearMissBase = this.palette.size();
		this.palette.push(pack.color("nearMiss.graze"), pack.color("nearMiss.parry"));
		this.buildSparkColor = this.palette.size();
		this.palette.push(pack.color("build.spark"));
		this.buildPhantomColor = this.palette.size();
		this.palette.push(pack.color(BUILD_FX_VIEW.phantom.role));
		this.fizzleColor = this.palette.size();
		this.palette.push(pack.color(BREAKABLE_LOOT_VIEW.fizzleRole));
		this.fizzleBurst = chipBurstOf(BREAKABLE_LOOT_VIEW.fizzleBurst);
		this.pelletPowerColor = this.palette.size();
		this.palette.push(pack.color(pelletId("power")));
		this.teamPulseColor = this.palette.size();
		this.palette.push(pack.color(TEAM_MOMENTS_VIEW.pulse.role));
		this.treasureBase = this.palette.size();
		for (const r of TREASURE_FLOOR_ROLES) this.palette.push(pack.color(r));
		this.treasureShape = chipBurstOf(TREASURE_VIEW.open.burst);
		this.goldenCoinColor = this.palette.size();
		this.palette.push(pack.color(GOLDEN_COIN_ROLE));

		this.nearMiss.onFrame((frame, settings) => this.nearMissFrame(frame, settings));
		const [impOk, impKind] = pcall(() => archetypeIndex(IMP.id));
		this.impKind = impOk ? (impKind as number) : -1;

		this.fx.onEvent((e, settings) => {
			switch (e.type) {
				case "reset":
					this.system.clear();
					this.flyIns.clear();
					break;
				case "killed": {
					if (e.boss) break; // bossDefeated follows and owns the boss's death
					const known = e.kind >= 0 && e.kind < this.kindScale.size();
					this.system.killed(
						e.x,
						e.z,
						e.hpMax,
						known ? this.kindScale[e.kind] : 1,
						known ? PALETTE_KIND_BASE + e.kind : PAL_SPARK,
						e.elite,
						burstSeed(e.actorId, e.tick),
						settings,
					);
					break;
				}
				case "bossDefeated":
					this.system.bossDefeated(e.x, e.z, burstSeed(e.actorId, e.tick, 2), settings);
					break;
				case "bossPhase":
					this.system.bossPhase(e.x, e.z, e.phase, burstSeed(e.actorId, e.tick, 3), settings);
					break;
				case "hit":
					this.system.hit(e.x, e.z, e.heavy, burstSeed(e.actorId, e.tick, 1), settings);
					break;
				default:
					break;
			}
		});

		RunService.BindToRenderStep(
			RENDER_STEP,
			Enum.RenderPriority.Camera.Value + RENDER_ORDER.viewsAfterCamera,
			(dt) => this.frame(dt),
		);
		this.janitor.Add(() => RunService.UnbindFromRenderStep(RENDER_STEP), true);
	}

	/** A breakable piece of `kind` (BreakableKind index) broke at sim (x, z): its chip burst. */
	breakableChips(x: number, z: number, kind: number, seed: number): void {
		const burst = this.chipBursts[kind];
		if (burst === undefined) return;
		this.system.chips(x, z, this.breakableBase + kind, burst, seed, this.fx.settings());
	}

	/** A breakable piece was hit at sim (x, z) (a stopped bullet, a swing): the hit sparks. */
	breakableHitSparks(x: number, z: number, seed: number): void {
		this.system.hit(x, z, false, seed, this.fx.settings());
	}

	/**
	 * A boost drop of `kind` (Boost index) at sim (x, z): its pickup burst, or with `fade` the poof of a drop that faded
	 * on the floor.
	 */
	boostBurst(x: number, z: number, kind: number, fade: boolean, seed: number): void {
		const burst = fade ? this.poofBurst : this.collectBurst;
		if (burst === undefined || kind < 0 || kind >= BOOST_KINDS.size()) return;
		this.system.chips(x, z, this.boostBase + kind, burst, seed, this.fx.settings());
	}

	/**
	 * A loaded breakable broke at sim (x, z) with every ground slot taken (docs/BREAKABLE_DROPS.md BL6, BLD5): its boost
	 * fizzles out, a small grey puff (BREAKABLE_LOOT_VIEW.fizzleBurst in fizzleRole).
	 */
	lootFizzle(x: number, z: number, seed: number): void {
		const burst = this.fizzleBurst;
		if (burst === undefined) return;
		this.system.chips(x, z, this.fizzleColor, burst, seed, this.fx.settings());
	}

	/**
	 * The power pellet taken (docs/PELLETS.md PL7): every erased bullet a cube flying into the picker over
	 * PELLETS_VIEW.flyIn.sec (in place and fading under reduced motion), and one ring from the picker (fixed radius under
	 * reduced motion), in pellet.power. Unlike the bursts the cubes draw at every particle level (they are the
	 * conversion's readout; capped by flyIn.maxCubes).
	 */
	pelletPower(taken: Readonly<PelletPowerTaken>): void {
		const settings = this.fx.settings();
		const reduced = settings.reducedMotion;
		this.flyIns.add(taken, reduced ? 0 : 1);
		const state = this.sim.getContext()?.run.state;
		if (state === undefined || taken.player < 0 || taken.player >= partySize(state)) return;
		const me = playerAt(state, taken.player);
		const r = PELLETS_VIEW.ring;
		this.system.rings.spawn(
			me.x,
			me.z,
			r.r0Tiles,
			r.r1Tiles,
			r.lifeSec,
			this.pelletPowerColor,
			!reduced,
			RING_SEGMENTS,
		);
	}

	/**
	 * A chest popped open at sim (x, z) (docs/TREASURE.md TR7): a ring (fixed radius under reduced motion) and
	 * TREASURE_VIEW.open.burst's chips, both in tier `tier`'s floor colour. Nothing with Particles off.
	 */
	treasureBurst(x: number, z: number, tier: number, seed: number): void {
		const shape = this.treasureShape;
		const settings = this.fx.settings();
		if (shape === undefined || tier < 0 || tier >= TREASURE_FLOOR_ROLES.size()) return;
		if (effectiveParticles(settings) === "off") return;
		const color = this.treasureBase + tier;
		const r = TREASURE_VIEW.open.ring;
		const reduced = settings.reducedMotion;
		this.system.rings.spawn(x, z, r.r0Tiles, r.r1Tiles, r.lifeSec, color, !reduced, RING_SEGMENTS);
		this.system.chips(x, z, color, shape, seed, settings);
	}

	/**
	 * One of the Goldling's bursts at sim (x, z) (docs/FORTUNE.md FO8): `burst` a GOLDEN_VIEW shape, in golden.coin, or
	 * with `body` in the archetype's own colour (the escape's dive puff). Particles setting and reduced motion as every
	 * chip burst (none at Off).
	 */
	goldenBurst(x: number, z: number, burst: GoldenBurstView, body: boolean, seed: number): void {
		const kind = goldenKind();
		const color = body && kind >= 0 ? PALETTE_KIND_BASE + kind : this.goldenCoinColor;
		this.system.chips(x, z, color, chipBurstOf(burst), seed, this.fx.settings());
	}

	/**
	 * The Goldling's appearance ring at sim (x, z) (GOLDEN_VIEW.appear.ring; in place, no growth, under reduced motion;
	 * none with Particles Off: the shout, the minimap blip and the sound still tell).
	 */
	goldenAppearRing(x: number, z: number): void {
		const r = GOLDEN_VIEW.appear.ring;
		const settings = this.fx.settings();
		if (effectiveParticles(settings) === "off") return;
		this.system.rings.spawn(
			x,
			z,
			r.r0Tiles,
			r.r1Tiles,
			r.lifeSec,
			this.goldenCoinColor,
			!settings.reducedMotion,
			RING_SEGMENTS,
		);
	}

	/** The room clear spark ring at sim (x, z) (docs/ROOM_CLEAR.md RC5): uiAccent, or ember for PERFECT. */
	roomClearBurst(x: number, z: number, perfect: boolean, seed: number): void {
		const shape = this.roomClearShape;
		if (shape === undefined) return;
		this.system.chips(x, z, this.roomClearBase + (perfect ? 1 : 0), shape, seed, this.fx.settings());
	}

	/**
	 * The co-op team pulse (docs/RUN_RECAP.md CM2; RoomClearController calls it at a team perfect, once per living party
	 * member): the room clear's spark ring (ROOM_CLEAR.burst) around a player, in TEAM_MOMENTS_VIEW.pulse.role.
	 */
	teamPulse(x: number, z: number, seed: number): void {
		const shape = this.roomClearShape;
		if (shape === undefined) return;
		this.system.chips(x, z, this.teamPulseColor, shape, seed, this.fx.settings());
	}

	/**
	 * A spark burst at a Chain Spark target (docs/BUILDS.md BU8; BuildFxController calls it per new hop, shape from
	 * BuildFxDirector: Full or Reduced's halved counts), in build.spark.
	 */
	buildSparkBurst(x: number, z: number, shape: Readonly<ChipBurst>, seed: number): void {
		this.system.chips(x, z, this.buildSparkColor, shape, seed, this.fx.settings());
	}

	/**
	 * A few chips where Phantom Step erased an enemy bullet (docs/BUILDS.md BU8 follow-up; BuildFxController calls it
	 * per new erase, shape from BuildFxDirector), in BUILD_FX_VIEW.phantom.role.
	 */
	buildPhantomBurst(x: number, z: number, shape: Readonly<ChipBurst>, seed: number): void {
		this.system.chips(x, z, this.buildPhantomColor, shape, seed, this.fx.settings());
	}

	/** A frame's graze sparks and parry bursts (the frame object is reused: read now, never kept). */
	private nearMissFrame(frame: Readonly<NearMissFrame>, settings: Readonly<JuiceSettings>): void {
		const sparks = frame.grazeSparks;
		const bursts = frame.parryBursts;
		if (sparks.size() === 0 && bursts.size() === 0) return;
		const tick = this.sim.getContext()?.run.state.tick ?? 0;
		const grazeColor = this.nearMissBase;
		const parryColor = this.nearMissBase + 1;
		for (let i = 0; i < sparks.size(); i++) {
			const g = sparks[i];
			this.system.graze(
				g.x,
				g.z,
				g.dirX,
				g.dirZ,
				grazeColor,
				burstSeed(i, tick, NEAR_MISS_VIEW.graze.seedSalt),
				settings,
			);
		}
		for (let i = 0; i < bursts.size(); i++) {
			const b = bursts[i];
			this.system.parry(
				b.x,
				b.z,
				b.dirX,
				b.dirZ,
				b.weight,
				parryColor,
				burstSeed(i, tick, NEAR_MISS_VIEW.parry.seedSalt),
				settings,
			);
		}
	}

	private frame(rawDt: number): void {
		const ctx = this.sim.getContext();
		if (ctx === undefined) return;
		const settings = this.fx.settings();
		const dt =
			ctx.live?.isPaused() === true
				? 0
				: math.min(math.max(rawDt, 0), FX_VIEW.maxParticleDt) * this.sim.hitstop.timeScale();
		this.blinkPuffs(ctx.run.state, settings);
		this.detonationBursts(ctx.run.state, settings);
		this.system.update(dt, settings);
		this.flyIns.update(dt);
		this.used = 0;
		this.moveParts.clear();
		this.moveCFrames.clear();
		this.system.draw(this);
		const state = ctx.run.state;
		if (this.flyIns.size() > 0) {
			const party = partySize(state);
			this.flyIns.draw(this, this.pelletPowerColor, (player) =>
				player >= 0 && player < party ? playerAt(state, player) : undefined,
			);
		}
		for (let i = this.used; i < this.lastUsed; i++) {
			this.moveParts.push(this.parts[i].part);
			this.moveCFrames.push(PARKED);
		}
		this.lastUsed = this.used;
		if (this.moveParts.size() > 0) {
			Workspace.BulkMoveTo(this.moveParts, this.moveCFrames, Enum.BulkMoveMode.FireCFrameChanged);
		}
	}

	/**
	 * Imp landings this frame (shared/view BlinkWatch): a puff in the imp's colour where it stood and where it landed
	 * (no streak: the sim snaps prev to the new spot).
	 */
	private blinkPuffs(state: BlinkWatchState, settings: Readonly<JuiceSettings>): void {
		if (this.impKind < 0) return;
		const n = this.blinks.update(state, this.impKind);
		const color = PALETTE_KIND_BASE + this.impKind;
		for (let i = 0; i < n; i++) {
			const p = this.blinks.at(i);
			const salt = BLINK_VIEW.seedSalt;
			this.system.chips(
				p.fromX,
				p.fromZ,
				color,
				this.blinkPuff,
				burstSeed(p.actorId, state.tick, salt),
				settings,
			);
			this.system.chips(
				p.toX,
				p.toZ,
				color,
				this.blinkPuff,
				burstSeed(p.actorId, state.tick, salt + 1),
				settings,
			);
		}
	}

	/** Bomber detonations this frame (shared/view DetonationWatch): one burst each, in the Bomber's colour. */
	private detonationBursts(state: DetonationWatchState, settings: Readonly<JuiceSettings>): void {
		const kind = newEnemyKinds().bomber;
		if (kind < 0) return;
		const n = this.detonations.update(state, kind);
		const color = PALETTE_KIND_BASE + kind;
		for (let i = 0; i < n; i++) {
			const d = this.detonations.at(i);
			this.system.chips(
				d.x,
				d.z,
				color,
				this.blastBurst,
				burstSeed(d.actorId, state.tick, DETONATION_VIEW.seedSalt),
				settings,
			);
		}
	}

	/** ParticleWriter: one ring dot / particle of this frame (called by DeathParticleSystem.draw). */
	push(x: number, z: number, hopPx: number, sizePx: number, color: number, alpha: number): void {
		if (this.used >= PARTICLE_QUAD_CAPACITY) return;
		const p = this.part(this.used);
		this.used++;
		if (p.color !== color) {
			p.color = color;
			p.part.Color = this.palette[color] ?? this.palette[PAL_SPARK];
		}
		if (p.size !== sizePx) {
			p.size = sizePx;
			const s = sizePx * PX;
			p.part.Size = new Vector3(s, s, s);
		}
		const q = math.floor(alpha / FX_VIEW.alphaQuantum + 0.5) * FX_VIEW.alphaQuantum;
		if (p.alpha !== q) {
			p.alpha = q;
			p.part.Transparency = 1 - q;
		}
		const y = floorStudsY() + FLOOR_LIFT + (sizePx * PX) / 2 + hopPx * HOP_STUDS_PER_PX;
		this.moveParts.push(p.part);
		this.moveCFrames.push(new CFrame(studsX(x), y, studsZ(z)));
	}

	/** Part i of the pool, created on first use (the pool only grows). */
	private part(i: number): ParticlePart {
		let p = this.parts[i];
		if (p === undefined) {
			const part = renderPart("Part", false);
			part.Name = "Particle";
			part.Material = Enum.Material.SmoothPlastic;
			part.Size = new Vector3(PX, PX, PX);
			part.CFrame = PARKED;
			part.Parent = this.folder;
			p = { part, color: -1, size: 1, alpha: -1 };
			this.parts.push(p);
		}
		return p;
	}
}

/** A BOOST_VIEW (or BREAKABLE_LOOT_VIEW fizzle, GOLDEN_VIEW) burst as the particle system's chip burst. */
function chipBurstOf(b: BoostBurstView | GoldenBurstView): ChipBurst {
	return {
		chunks: b.chunks,
		bits: b.bits,
		sparks: b.sparks,
		startPx: b.startPx,
		radius: b.radiusTiles,
		speed: b.speed,
	};
}
