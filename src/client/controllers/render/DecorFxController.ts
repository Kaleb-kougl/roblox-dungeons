import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { RunService, Workspace } from "@rbxts/services";
import { STUDS_PER_TILE } from "shared/config";
import { DECOR_FX_TINT, decorFxId, type DecorPiece } from "shared/theme";
import {
	BULLET_VIEW,
	DECOR_FX,
	DECOR_LIGHTS,
	DECOR_RENDER_ORDER,
	DECOR_VIEW,
	DecorLightPool,
	NO_DECOR_LIGHT,
	SPRITE_VIEW,
	WALL_DEPTH_BIAS,
	ambientEmitterSpec,
	decorFlickerScale,
	decorHash,
	decorGlowPoint,
	decorLoopFrame,
	floorStudsY,
	nearestDecorLights,
	simX,
	simZ,
	studsX,
	studsY,
	studsZ,
	type AmbientEmitterSpec,
	type DecorEntry,
	type DecorScene,
	type DecorView,
} from "shared/view";
import { effectiveParticles, motionScale } from "shared/view/fx";
import { FxTrackerController } from "../fx/FxTrackerController";
import { ThemeController } from "../game/ThemeController";
import { DecorController } from "./DecorController";
import {
	ArtBillboard,
	buildFloorArt,
	heightLayout,
	restingAnimation,
	visualLayout,
	widthLayout,
	type FloorArt,
} from "./decorParts";
import { renderPart } from "./placeholders";

const PARKED = new CFrame(BULLET_VIEW.parkedStuds[0], BULLET_VIEW.parkedStuds[1], BULLET_VIEW.parkedStuds[2]);
const S = STUDS_PER_TILE;
const HIDDEN = 1;
/** Particle transparency keypoints: fade in over the first share of a life, out over the last. */
const PARTICLE_FADE_IN = 0.2;
const PARTICLE_FADE_OUT = 0.8;

/** A looping effect billboard (flame, glow, glint) and how it animates. */
interface FxBillboard {
	readonly entry: number;
	readonly body: ArtBillboard;
	readonly anim: string | undefined;
	readonly frames: number;
	readonly fps: number;
	readonly hash: number;
	readonly x: number;
	readonly z: number;
}

/** One PointLight on its own invisible anchor (the pool's and the fixed ones). */
interface DecorLight {
	readonly anchor: Part;
	readonly light: PointLight;
	/** What it shows: the candidate index (pool), or the fixed light's own. */
	shown: number;
}

type FixedKind = "ring" | "stair" | "shrine";

interface FixedLight extends DecorLight {
	readonly kind: FixedKind;
	/** Ring spot index / shrine light index. */
	readonly index: number;
	readonly hash: number;
}

/**
 * Ambient life of the decoration (docs/DECOR.md Phase 2 part 2, task R9) and the director's lights (R4 light rule,
 * R10), from DecorController's scene and view, every frame after it (DECOR_RENDER_ORDER.decorFxAfterDecor):
 *
 *   flames      every lit torch / brazier whose piece has art with `glow` gets the effect loop (decor.fx.torch on wall
 *               torches, decor.fx.flame on braziers) at its glow point, plus decor.fx.glow behind it; per-piece phase
 *               from the plan's cell hash (decorLoopFrame); taller while its room is engaged, a flare on a room clear,
 *               a gutter on an Ember, faded by the run-over cold (all from the DecorView). Animated only within
 *               DECOR_FX.flameAnimateRadiusTiles of the camera focus.
 *   light pool  DECOR_LIGHTS.pool PointLights shared by the lit lights nearest the camera focus (DecorLightPool;
 *               reassigned every reassignSeconds, fading), brightness x the depth band's light x seeded flicker (x the
 *               juice motionScale) x the director's lit / flare / gutter / cold; colour decor.fx.flame -> the cold role.
 *               Needs no art: with the placeholder pack the lights still burn where the plan has lit torches.
 *   fixed       2-4 lights outside the pool (the web build's light rule): the boss room's (DECOR_LIGHTS.bossRingLights
 *               spread over the flat boss ring, lit by the director per phase, steady after the kill; one on the open
 *               stairwell) and the shrine room's (shrineLights, nearest the shrine; dimmed once it is used).
 *   flat fx     the boss ring's fire pits (decor.fx.glow laid flat, DECOR_FX.ringGlowTiles across) and the open
 *               stairwell's ring (decor.fx.zone, zoneSizeTiles) as floor-level SurfaceGuis: nothing standing.
 *   glint       decor.fx.glint over each live relic pedestal until it is taken.
 *   ambient     one ParticleEmitter volume around the camera focus with the biome's texture (pack.ambient(biome); none
 *               without it), rate from ambientEmitterSpec (Forge count x band light x juice particle level, zero under
 *               reduced motion, capped at DECOR_FX.maxParticles); TimeScale 0 while the decoration is frozen.
 *
 * Everything per floor belongs to the floor's Janitor (rebuilt when DecorController's scene revision moves); the pool
 * lights and the emitter live as long as the controller. Read-only on the sim.
 */
@Controller({})
export class DecorFxController implements OnStart {
	private readonly janitor = new Janitor();
	private readonly floorJanitor = new Janitor();
	private readonly pool = new DecorLightPool();
	private readonly poolLights = new Array<DecorLight>();
	private readonly fixed = new Array<FixedLight>();
	private readonly flames = new Array<FxBillboard>();
	private readonly glows = new Array<FxBillboard>();
	private readonly glints = new Array<FxBillboard>();
	/** The boss ring's flat fire pits by ring spot (absent: no glow art). */
	private readonly ringGlows = new Map<number, FloorArt>();
	private zone: FloorArt | undefined;
	/** Pool candidates (parallel arrays): the plan entry, its light spot (tiles) and this frame's lit level. */
	private readonly candEntry = new Array<number>();
	private readonly candX = new Array<number>();
	private readonly candY = new Array<number>();
	private readonly candZ = new Array<number>();
	private readonly candLevel = new Array<number>();
	private readonly wanted = new Array<number>();
	private readonly scratch = new Array<number>();
	private folder: Folder | undefined;
	private emitterPart: Part | undefined;
	private emitter: ParticleEmitter | undefined;
	private emitterSpec: AmbientEmitterSpec | undefined;
	private hasAmbient = false;
	private revision = -1;
	private flameColor = new Color3(1, 1, 1);
	private coldColor = new Color3(1, 1, 1);

	constructor(
		private readonly decor: DecorController,
		private readonly theme: ThemeController,
		private readonly fx: FxTrackerController,
	) {}

	onStart(): void {
		const pack = this.theme.getPack();
		this.flameColor = pack.color(DECOR_FX_TINT.flame);
		this.coldColor = pack.color(DECOR_LIGHTS.coldRole);
		const folder = new Instance("Folder");
		folder.Name = DECOR_FX.fxFolderName;
		folder.Parent = Workspace;
		this.folder = this.janitor.Add(folder);
		for (let i = 0; i < this.pool.size; i++) this.poolLights.push(this.buildLight(folder, `DecorPoolLight${i}`));
		this.buildEmitter(folder);
		RunService.BindToRenderStep(
			DECOR_FX.renderStep,
			Enum.RenderPriority.Camera.Value + DECOR_RENDER_ORDER.decorFxAfterDecor,
			() => this.frame(),
		);
		this.janitor.Add(() => RunService.UnbindFromRenderStep(DECOR_FX.renderStep), true);
		this.janitor.Add(this.floorJanitor, "Cleanup");
	}

	// --- per floor -------------------------------------------------------------------------------

	private rebuild(scene: DecorScene | undefined): void {
		this.floorJanitor.Cleanup();
		this.flames.clear();
		this.glows.clear();
		this.glints.clear();
		this.ringGlows.clear();
		this.fixed.clear();
		this.zone = undefined;
		this.candEntry.clear();
		this.candX.clear();
		this.candY.clear();
		this.candZ.clear();
		this.candLevel.clear();
		this.pool.clear();
		for (const l of this.poolLights) this.park(l);
		this.setAmbient(scene);
		if (scene === undefined) return;
		const pack = this.theme.getPack();
		const folder = this.floorJanitor.Add(new Instance("Folder"));
		folder.Name = DECOR_FX.fxFolderName;
		const plan = scene.plan;
		const torchFx = pack.decor(decorFxId("torch"));
		const brazierFx = pack.decor(decorFxId("flame"));
		const glowFx = pack.decor(decorFxId("glow"));
		const glintFx = pack.decor(decorFxId("glint"));
		const zoneFx = pack.decor(decorFxId("zone"));
		plan.entries.forEach((e, i) => {
			if (!e.light || !e.lit) return;
			const piece = this.decor.getPiece(i);
			const [x, y, z] = this.lightSpot(e, piece);
			const fixedRoom = e.roomId >= 0 && (e.roomId === scene.bossRoom || e.roomId === scene.shrineRoom);
			if (!fixedRoom) {
				this.candEntry.push(i);
				this.candX.push(x);
				this.candY.push(y);
				this.candZ.push(z);
				this.candLevel.push(0);
			}
			if (piece === undefined || !piece.glow) return;
			const wallBias = e.layer === "wall" ? WALL_DEPTH_BIAS * S : 0;
			const at = new CFrame(studsX(x), studsY(y), studsZ(z));
			const flameFx = e.kind === "brazier" ? brazierFx : torchFx;
			if (glowFx !== undefined) {
				const glow = this.fxBillboard(folder, glowFx, i, e.hash, x, z, wallBias + DECOR_FX.glowDepthStuds);
				glow.body.anchor.CFrame = at;
				glow.body.setTransparency(HIDDEN);
				this.glows.push(glow);
			}
			if (flameFx !== undefined) {
				const flame = this.fxBillboard(folder, flameFx, i, e.hash, x, z, wallBias + DECOR_FX.flameDepthStuds);
				flame.body.anchor.CFrame = at;
				flame.body.setTransparency(HIDDEN);
				this.flames.push(flame);
			}
		});
		// boss room: the flat ring's fire pits, its fixed lights, the stairwell
		const ring = scene.bossRing;
		if (glowFx !== undefined) {
			ring.forEach((spot, k) => {
				const art = this.flatFx(folder, glowFx, spot.x, spot.z, DECOR_FX.ringGlowTiles);
				if (art === undefined) return;
				art.label.ImageTransparency = HIDDEN;
				this.ringGlows.set(k, art);
			});
		}
		const ringLights = math.min(DECOR_LIGHTS.bossRingLights, ring.size());
		for (let k = 0; k < ringLights; k++) {
			const index = math.floor((k * ring.size()) / ringLights);
			const spot = ring[index];
			this.fixed.push(
				this.fixedLight(folder, scene, "ring", index, spot.x, DECOR_LIGHTS.ringLightHeightTiles, spot.z),
			);
		}
		const stair = scene.stairwell;
		if (stair !== undefined) {
			if (zoneFx !== undefined) {
				this.zone = this.flatFx(folder, zoneFx, stair.x, stair.z, DECOR_FX.zoneSizeTiles);
				if (this.zone !== undefined) this.zone.label.ImageTransparency = HIDDEN;
			}
			if (DECOR_LIGHTS.stairwellLight)
				this.fixed.push(this.fixedLight(folder, scene, "stair", 0, stair.x, DECOR_LIGHTS.heightTiles, stair.z));
		}
		// shrine room: lights at its lit pieces nearest the shrine, else one over the shrine
		const shrine = scene.shrine;
		if (shrine !== undefined && scene.shrineRoom >= 0) {
			const lights = plan.lightsByRoom[scene.shrineRoom] ?? [];
			const xs: number[] = [];
			const zs: number[] = [];
			const lv: number[] = [];
			const ids: number[] = [];
			for (const i of lights) {
				const e = plan.entries[i];
				if (!e.lit) continue;
				const [x, , z] = this.lightSpot(e, this.decor.getPiece(i));
				xs.push(x);
				zs.push(z);
				lv.push(1);
				ids.push(i);
			}
			const near: number[] = [];
			nearestDecorLights(xs, zs, lv, shrine.x, shrine.z, DECOR_LIGHTS.shrineLights, 0, near);
			if (near.size() === 0) {
				this.fixed.push(
					this.fixedLight(folder, scene, "shrine", 0, shrine.x, DECOR_LIGHTS.heightTiles, shrine.z),
				);
			}
			near.forEach((k, n) => {
				const [x, y, z] = this.lightSpot(plan.entries[ids[k]], this.decor.getPiece(ids[k]));
				this.fixed.push(this.fixedLight(folder, scene, "shrine", n, x, y, z));
			});
		}
		// treasure glints
		if (glintFx !== undefined) {
			scene.pedestals.forEach((p, j) => {
				const glint = this.fxBillboard(
					folder,
					glintFx,
					j,
					j,
					p.x,
					p.z,
					0,
					heightLayout(visualLayout(glintFx.art), DECOR_FX.glintHeightTiles),
				);
				glint.body.anchor.CFrame = new CFrame(studsX(p.x), studsY(DECOR_FX.glintLiftTiles), studsZ(p.z));
				glint.body.setTransparency(HIDDEN);
				this.glints.push(glint);
			});
		}
		folder.Parent = this.folder;
		print(
			`[DecorFx] ${this.candEntry.size()} pool candidates, ${this.flames.size()} flames, ${this.glows.size()} glows, ` +
				`${this.fixed.size()} fixed lights, ${ring.size()} ring pits, ${this.glints.size()} glints, ambient ${
					this.hasAmbient ? "on" : "none"
				}`,
		);
	}

	/** Where entry `e`'s light sits, tiles: its art's glow point, else its anchor pushed off its wall face. */
	private lightSpot(e: DecorEntry, piece: DecorPiece | undefined): readonly [number, number, number] {
		if (piece !== undefined && piece.glow) {
			const [x, y, z] = decorGlowPoint(e, piece.core);
			return [x, y, z];
		}
		if (e.layer === "wall") {
			const off = DECOR_LIGHTS.wallOffsetTiles;
			return [e.x + e.faceX * off, DECOR_LIGHTS.heightTiles, e.z + e.faceZ * off];
		}
		return [e.x + e.faceX * DECOR_LIGHTS.wallOffsetTiles, e.y, e.z + e.faceZ * DECOR_LIGHTS.wallOffsetTiles];
	}

	private fxBillboard(
		folder: Instance,
		piece: DecorPiece,
		entry: number,
		hash: number,
		x: number,
		z: number,
		extraDepth: number,
		layout = visualLayout(piece.art),
	): FxBillboard {
		const body = new ArtBillboard(piece.art, folder, piece.id, layout, extraDepth);
		let anim: string | undefined;
		let frames = 1;
		let fps = 0;
		if (piece.art.kind === "sprites") {
			anim = restingAnimation(piece.art.set, DECOR_VIEW.idleAnimation);
			const def = anim !== undefined ? piece.art.set.animation(anim) : undefined;
			if (def !== undefined) {
				frames = math.max(1, def.frames);
				fps = def.fps;
			}
		}
		const fxb: FxBillboard = { entry, body, anim, frames, fps, hash, x, z };
		if (anim !== undefined) body.setFrame(anim, 0, decorLoopFrame(0, fps, frames, hash));
		return fxb;
	}

	/** An effect laid flat at (x, z), `widthTiles` across. */
	private flatFx(
		folder: Instance,
		piece: DecorPiece,
		x: number,
		z: number,
		widthTiles: number,
	): FloorArt | undefined {
		const at = new Vector3(studsX(x), floorStudsY(), studsZ(z));
		const layout = widthLayout(visualLayout(piece.art), widthTiles);
		const art = buildFloorArt(
			piece.id,
			piece.art,
			at,
			folder,
			DECOR_VIEW.flatThicknessStuds,
			DECOR_VIEW.flatLiftStuds * 2,
			0,
			layout,
		);
		if (art !== undefined) art.label.ImageColor3 = new Color3(1, 1, 1);
		return art;
	}

	private buildLight(folder: Instance, name: string): DecorLight {
		const anchor = renderPart("Part", false);
		anchor.Name = name;
		anchor.Transparency = HIDDEN;
		anchor.Size = new Vector3(SPRITE_VIEW.anchorStuds, SPRITE_VIEW.anchorStuds, SPRITE_VIEW.anchorStuds);
		anchor.CFrame = PARKED;
		const light = new Instance("PointLight");
		light.Shadows = DECOR_LIGHTS.shadows;
		light.Range = DECOR_LIGHTS.rangeTiles * S;
		light.Brightness = 0;
		light.Enabled = false;
		light.Color = this.flameColor;
		light.Parent = anchor;
		anchor.Parent = folder;
		return { anchor, light, shown: NO_DECOR_LIGHT };
	}

	private fixedLight(
		folder: Instance,
		scene: DecorScene,
		kind: FixedKind,
		index: number,
		x: number,
		y: number,
		z: number,
	): FixedLight {
		const l = this.buildLight(folder, `DecorLight_${kind}${index}`);
		l.anchor.CFrame = new CFrame(studsX(x), studsY(y), studsZ(z));
		this.floorJanitor.Add(l.anchor);
		const hash = decorHash(scene.plan.floorSeed, index, DECOR_LIGHTS.fixedSalt[kind]);
		return { anchor: l.anchor, light: l.light, shown: NO_DECOR_LIGHT, kind, index, hash };
	}

	private park(l: DecorLight): void {
		l.shown = NO_DECOR_LIGHT;
		l.light.Enabled = false;
		l.anchor.CFrame = PARKED;
	}

	// --- ambient particles -------------------------------------------------------------------------

	private buildEmitter(folder: Instance): void {
		const part = renderPart("Part", false);
		part.Name = "DecorAmbient";
		part.Transparency = HIDDEN;
		const [vx, vy, vz] = DECOR_FX.ambientVolumeTiles;
		part.Size = new Vector3(vx * S, vy * S, vz * S);
		part.CFrame = PARKED;
		const emitter = new Instance("ParticleEmitter");
		emitter.Enabled = false;
		emitter.Rate = 0;
		emitter.Shape = Enum.ParticleEmitterShape.Box;
		emitter.ShapeStyle = Enum.ParticleEmitterShapeStyle.Volume;
		emitter.LockedToPart = false;
		emitter.Parent = part;
		part.Parent = folder;
		this.emitterPart = part;
		this.emitter = emitter;
	}

	/** The floor biome's ambient look on the emitter (off without the pack's texture). */
	private setAmbient(scene: DecorScene | undefined): void {
		const emitter = this.emitter;
		if (emitter === undefined) return;
		this.emitterSpec = undefined;
		const art = scene !== undefined ? this.theme.getPack().ambient(scene.plan.biome) : undefined;
		this.hasAmbient = art !== undefined;
		emitter.Enabled = false;
		emitter.Rate = 0;
		emitter.Clear();
		if (art === undefined || scene === undefined) return;
		emitter.Texture = art.assetId;
		emitter.Size = new NumberSequence(art.sizeStuds);
		emitter.Transparency = new NumberSequence([
			new NumberSequenceKeypoint(0, 1),
			new NumberSequenceKeypoint(PARTICLE_FADE_IN, art.transparency),
			new NumberSequenceKeypoint(PARTICLE_FADE_OUT, art.transparency),
			new NumberSequenceKeypoint(1, 1),
		]);
		emitter.Color = new ColorSequence(art.color);
		emitter.LightEmission = art.emissive ? 1 : 0;
		emitter.LightInfluence = art.emissive ? 0 : 1;
	}

	private updateAmbient(scene: DecorScene, frozen: boolean): void {
		const emitter = this.emitter;
		const part = this.emitterPart;
		if (emitter === undefined || part === undefined || !this.hasAmbient) return;
		const settings = this.fx.settings();
		const spec = ambientEmitterSpec(
			scene.plan.profile.themeKey,
			scene.plan.profile.light,
			effectiveParticles(settings),
			motionScale(settings),
		);
		const last = this.emitterSpec;
		if (last === undefined || last.rate !== spec.rate || last.motion !== spec.motion) {
			this.emitterSpec = spec;
			const m = spec.motion;
			emitter.Rate = spec.rate;
			emitter.Lifetime = new NumberRange(m.lifetime[0], m.lifetime[1]);
			emitter.Speed = new NumberRange(m.speed[0] * S, m.speed[1] * S);
			emitter.Acceleration = new Vector3(0, m.accelY * S, 0);
			emitter.SpreadAngle = new Vector2(m.spreadDeg, m.spreadDeg);
			emitter.EmissionDirection = m.up ? Enum.NormalId.Top : Enum.NormalId.Bottom;
			emitter.Enabled = spec.rate > 0;
			if (spec.rate <= 0) emitter.Clear();
		}
		emitter.TimeScale = frozen ? 0 : 1;
		const focus = Workspace.CurrentCamera?.Focus.Position;
		if (focus !== undefined) {
			part.CFrame = new CFrame(focus.X, floorStudsY() + DECOR_FX.ambientHeightTiles * S, focus.Z);
		}
	}

	// --- per frame -------------------------------------------------------------------------------

	private frame(): void {
		const scene = this.decor.getScene();
		const revision = this.decor.getSceneRevision();
		if (revision !== this.revision) {
			this.revision = revision;
			this.rebuild(scene);
		}
		const view = this.decor.getView();
		if (scene === undefined || view === undefined) {
			if (this.emitter !== undefined) this.emitter.TimeScale = 0;
			return;
		}
		debug.profilebegin(DECOR_FX.profileLabel);
		const dt = this.decor.getFrameDt();
		const t = this.decor.getClock();
		const frozen = this.decor.isFrozen();
		const motion = motionScale(this.fx.settings());
		const focus = Workspace.CurrentCamera?.Focus.Position;
		const fx = focus !== undefined ? simX(focus.X) : 0;
		const fz = focus !== undefined ? simZ(focus.Z) : 0;
		this.updateFlames(view, t, fx, fz);
		this.updatePool(scene, view, dt, t, fx, fz, motion);
		this.updateFixed(scene, view, t, motion);
		this.updateFlat(view);
		this.updateAmbient(scene, frozen);
		debug.profileend();
	}

	private updateFlames(view: DecorView, t: number, fx: number, fz: number): void {
		const r2 = DECOR_FX.flameAnimateRadiusTiles * DECOR_FX.flameAnimateRadiusTiles;
		const gutter = view.gutter;
		const keep = 1 - view.cold;
		for (const f of this.flames) {
			const lit = view.lit[f.entry] ?? 0;
			const shown = lit * (1 - gutter * DECOR_FX.gutterTransparency) * keep;
			f.body.setTransparency(1 - shown);
			if (shown <= 0) continue;
			const grow = (view.flame[f.entry] ?? 1) * (1 + (view.flare[f.entry] ?? 0) * DECOR_FX.flareGrow);
			f.body.setScale(grow * (1 - gutter * DECOR_FX.gutterShrink));
			this.animate(f, t, fx, fz, r2);
		}
		for (const g of this.glows) {
			const lit = view.lit[g.entry] ?? 0;
			g.body.setTransparency(1 - lit * (1 - DECOR_FX.glowTransparency) * keep);
			if (lit > 0) this.animate(g, t, fx, fz, r2);
		}
		for (let j = 0; j < this.glints.size(); j++) {
			const g = this.glints[j];
			const level = view.glint[g.entry] ?? 0;
			g.body.setTransparency(1 - level);
			if (level > 0) this.animate(g, t, fx, fz, r2);
		}
	}

	private animate(f: FxBillboard, t: number, fx: number, fz: number, r2: number): void {
		if (f.anim === undefined || f.frames <= 1) return;
		const dx = f.x - fx;
		const dz = f.z - fz;
		if (dx * dx + dz * dz > r2) return;
		f.body.setFrame(f.anim, 0, decorLoopFrame(t, f.fps, f.frames, f.hash));
	}

	/** The scene-wide brightness factors: the band's light, the gutter, the cold fade. */
	private lightFactor(view: DecorView): number {
		const band = this.decor.getScene()?.plan.profile.light ?? 1;
		const cold = 1 - view.cold * (1 - DECOR_LIGHTS.coldBrightness);
		return band * (1 - view.gutter * DECOR_LIGHTS.gutterDim) * cold;
	}

	private lightColor(view: DecorView): Color3 {
		return view.cold > 0 ? this.flameColor.Lerp(this.coldColor, view.cold) : this.flameColor;
	}

	private setLight(l: DecorLight, brightness: number, color: Color3): void {
		const b = math.clamp(brightness, 0, DECOR_LIGHTS.maxBrightness);
		const on = b > 0;
		if (l.light.Enabled !== on) l.light.Enabled = on;
		if (on) {
			l.light.Brightness = b;
			if (l.light.Color !== color) l.light.Color = color;
		}
	}

	private updatePool(
		scene: DecorScene,
		view: DecorView,
		dt: number,
		t: number,
		fx: number,
		fz: number,
		motion: number,
	): void {
		const n = this.candEntry.size();
		for (let c = 0; c < n; c++) this.candLevel[c] = view.lit[this.candEntry[c]] ?? 0;
		const pool = this.pool;
		if (pool.due(dt) || view.snapped) {
			nearestDecorLights(
				this.candX,
				this.candZ,
				this.candLevel,
				fx,
				fz,
				pool.size,
				DECOR_LIGHTS.minLitLevel,
				this.wanted,
				this.scratch,
			);
			pool.assign(this.wanted);
		}
		pool.fade(dt);
		const factor = this.lightFactor(view);
		const color = this.lightColor(view);
		const plan = scene.plan;
		for (let l = 0; l < this.poolLights.size(); l++) {
			const light = this.poolLights[l];
			const c = pool.key[l];
			if (c === NO_DECOR_LIGHT) {
				if (light.shown !== NO_DECOR_LIGHT) this.park(light);
				continue;
			}
			if (light.shown !== c) {
				light.shown = c;
				light.anchor.CFrame = new CFrame(studsX(this.candX[c]), studsY(this.candY[c]), studsZ(this.candZ[c]));
			}
			const entry = this.candEntry[c];
			const e = plan.entries[entry];
			const flare = (view.flare[entry] ?? 0) * DECOR_LIGHTS.flareBrightness;
			const b =
				(DECOR_LIGHTS.brightness * this.candLevel[c] * decorFlickerScale(e.hash, t, motion) + flare) *
				pool.level[l] *
				factor;
			this.setLight(light, b, color);
		}
	}

	private updateFixed(scene: DecorScene, view: DecorView, t: number, motion: number): void {
		const factor = this.lightFactor(view);
		const color = this.lightColor(view);
		const shrineOn = scene.shrineRoom >= 0 && view.roomEntered[scene.shrineRoom] === true;
		for (const l of this.fixed) {
			let level = 0;
			let flicker = true;
			if (l.kind === "ring") {
				level = view.ring[l.index] ?? 0;
				flicker = !view.ringSteady;
			} else if (l.kind === "stair") {
				level = view.stairGlow;
				flicker = false;
			} else {
				level = shrineOn ? 1 - view.shrineDim * (1 - DECOR_LIGHTS.coldBrightness) : 0;
			}
			const f = flicker ? decorFlickerScale(l.hash, t, motion) : 1;
			this.setLight(l, DECOR_LIGHTS.brightness * level * f * factor, color);
		}
	}

	private updateFlat(view: DecorView): void {
		const keep = 1 - view.cold;
		for (const [k, art] of this.ringGlows) {
			const level = (view.ring[k] ?? 0) * keep;
			const t = 1 - level * (1 - DECOR_FX.glowTransparency);
			if (art.label.ImageTransparency !== t) art.label.ImageTransparency = t;
		}
		const zone = this.zone;
		if (zone !== undefined) {
			const t = 1 - view.stairGlow;
			if (zone.label.ImageTransparency !== t) zone.label.ImageTransparency = t;
		}
	}
}
