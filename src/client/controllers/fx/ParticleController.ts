import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { RunService, Workspace } from "@rbxts/services";
import { CAMERA_PITCH_DEG } from "shared/config";
import { archetypeAt, archetypeIds } from "shared/sim";
import { BOOST_KINDS, BREAKABLE_KINDS, type ColorRole } from "shared/theme";
import { BOOST_VIEW, type BoostBurstView } from "shared/view/boosts";
import { BREAKABLE_VIEW, RENDER_ORDER, degToRad, floorStudsY, studsX, studsZ } from "shared/view";
import {
	DeathParticleSystem,
	FX_VIEW,
	PALETTE_KIND_BASE,
	PAL_SPARK,
	PARTICLE_QUAD_CAPACITY,
	burstSeed,
	particleColorRole,
	type ChipBurst,
	type ParticleWriter,
} from "shared/view/fx";
import { SimController } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import { renderPart } from "../render/placeholders";
import { FxTrackerController } from "./FxTrackerController";
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
 *
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

		this.fx.onEvent((e, settings) => {
			switch (e.type) {
				case "reset":
					this.system.clear();
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

	private frame(rawDt: number): void {
		const ctx = this.sim.getContext();
		if (ctx === undefined) return;
		const settings = this.fx.settings();
		const dt =
			ctx.live?.isPaused() === true
				? 0
				: math.min(math.max(rawDt, 0), FX_VIEW.maxParticleDt) * this.sim.hitstop.timeScale();
		this.system.update(dt, settings);
		this.used = 0;
		this.moveParts.clear();
		this.moveCFrames.clear();
		this.system.draw(this);
		for (let i = this.used; i < this.lastUsed; i++) {
			this.moveParts.push(this.parts[i].part);
			this.moveCFrames.push(PARKED);
		}
		this.lastUsed = this.used;
		if (this.moveParts.size() > 0) {
			Workspace.BulkMoveTo(this.moveParts, this.moveCFrames, Enum.BulkMoveMode.FireCFrameChanged);
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

/** A BOOST_VIEW burst as the particle system's chip burst. */
function chipBurstOf(b: BoostBurstView): ChipBurst {
	return {
		chunks: b.chunks,
		bits: b.bits,
		sparks: b.sparks,
		startPx: b.startPx,
		radius: b.radiusTiles,
		speed: b.speed,
	};
}
