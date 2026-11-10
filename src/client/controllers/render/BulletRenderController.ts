import { Controller, OnStart } from "@flamework/core";
import { RunService, Workspace } from "@rbxts/services";
import { clientStore, selectDisplay, selectJuice } from "client/store";
import { STUDS_PER_TILE } from "shared/config";
import {
	EMBER_BURST,
	GOO_BULLET_RADIUS,
	SLIME,
	SIM_HZ,
	STORMCALLER,
	STRIKE_BULLET_RADIUS,
	partySize,
	simWorldConfig,
	type BulletSimulation,
	type Vec3 as SimVec3,
} from "shared/sim";
import { GOO_BULLET_ID, STRIKE_BULLET_ID, type PlaceholderVisual, type ThemePack } from "shared/theme";
import {
	BULLET_ART_VIEW,
	BUILD_BULLET_VIEW,
	BULLET_VIEW,
	ENEMY_BULLET_LOOK_IDS,
	GOO_ART_VIEW,
	GOO_VIEW,
	HAZARD_ART_VIEW,
	PLAYER_BULLET_LOOK_IDS,
	STRIKE_VIEW,
	PlayerBulletLook,
	bulletArtReferenceScale,
	emberDecalLook,
	enemyBulletLookOf,
	lookHasTrail,
	playerBulletLookOf,
	type EmberLook,
	type PlayerBulletLookId,
	RENDER_ORDER,
	ReadyIds,
	floorStudsY,
	gooDecalLook,
	isGooPayload,
	isStrikePayload,
	lerp,
	playerBulletTransparency,
	studsX,
	studsY,
	studsZ,
	strikeDecalLook,
	type GooLook,
} from "shared/view";
import { buildTrailsOn, isEmberPayload } from "shared/view/fx";
import { BulletAhead, newAheadPose, type AheadPose } from "shared/view/predict";
import { PreloadController } from "../game/PreloadController";
import { SimController } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import { BulletTrails, type TrailLook } from "./bulletTrails";
import { renderPart } from "./placeholders";
import { SpriteBulletPool, spriteBulletLook, type SpriteBulletLook } from "./SpriteBulletPool";
import { FloorSpritePool, floorSpriteLook } from "./FloorSpritePool";
import { EmberSpritePool, StrikeSpritePool, type FloorSpriteDrawer, type HazardClock } from "./HazardSpritePool";

const RENDER_STEP = "KV_Bullets";
const PARKED = new CFrame(BULLET_VIEW.parkedStuds[0], BULLET_VIEW.parkedStuds[1], BULLET_VIEW.parkedStuds[2]);
/** The hazards' indices in the controller's ReadyIds (docs/STAGE_ASSETS.md SA17). */
const HAZARD_GOO = 0;
const HAZARD_STRIKE = 1;
const HAZARD_EMBER = 2;
/** A Cylinder's axis is X: turned to Y, it lies flat on the floor (the goo disc). */
const FLAT = CFrame.Angles(0, 0, math.pi / 2);

interface BulletLook {
	readonly visual: PlaceholderVisual;
	readonly color: Color3;
	readonly material: Enum.Material;
	/** Studs per unit of the visual's size, so the drawn size matches BULLET_VIEW's draw radius at scale 1. */
	readonly baseScale: number;
}

/**
 * One bullet simulation drawn as pooled Parts, part i = bullet SLOT i (so a part keeps its bullet for the bullet's
 * whole life and sizes rarely change). Each frame every visible bullet is moved to its interpolated position
 * (previousPositionAt -> positionAt by the sim's alpha) and every part that just lost its bullet is parked, all in ONE
 * workspace:BulkMoveTo (spike A). The pool grows lazily to the highest slot it draws.
 *
 * Looks (docs/BUILDS.md BU8): `looks` is indexed by `lookOf(payload, scale)` (the player pool: shared/view
 * playerBulletLookOf, basic / heavy / burst / shard / bolt; the enemy pool: enemyBulletLookOf, small / medium / large /
 * needle, all four today's small ball). A part switches Color / Material / Size only when its look (the look object:
 * looks sharing one object never rewrite) or quantized size changes (one pool, no extra parts per kind). Looks with a
 * `trails` entry also move a faint trail part per slot behind the bolt while `trailsOn` (buildFx Full, not reduced
 * motion); trail parts grow lazily too and park with their bullet. Bullets a SpriteBulletPool draws (their look has
 * art, docs/PROJECTILE_ART.md PA5) come in through `skip`.
 */
class BulletPool {
	private readonly parts = new Array<BasePart>();
	private readonly shown = new Array<boolean>();
	/** Quantized drawn size per part (BULLET_VIEW.sizeQuantum steps); -1 = never set. */
	private readonly sizeKey = new Array<number>();
	private readonly lookKey = new Array<number>();
	private readonly trailParts: BulletTrails;
	/** Last transparency written per part (co-op: teammates' bullets in large parties). */
	private readonly alphaKey = new Array<number>();
	private readonly moveParts = new Array<BasePart>();
	private readonly moveCFrames = new Array<CFrame>();
	private readonly prev: SimVec3 = { x: 0, y: 0, z: 0 };
	private readonly pose: AheadPose = newAheadPose();
	private sim: BulletSimulation | undefined;

	constructor(
		private readonly folder: Folder,
		private readonly name: string,
		/** The looks by index (lookOf's result); look 0 is the pool's default (new parts start with it). */
		private readonly looks: ReadonlyArray<BulletLook>,
		/** Turn the part along the velocity (player bolts); enemy balls are round. */
		private readonly orient: boolean,
		/**
		 * Bullets this pool leaves to another one, by payload and slot (the enemy pool skips goo while the goo pool
		 * draws it; both pools skip the slots their sprite pool drew this frame).
		 */
		private readonly skip?: (payload: number, slot: number) => boolean,
		/** The look of a bullet by payload and draw scale (absent: look 0). */
		private readonly lookOf?: (payload: number, scale: number) => number,
		/** Trails by look index (absent / undefined entry: no trail). */
		private readonly trails?: ReadonlyArray<TrailLook | undefined>,
	) {
		this.trailParts = new BulletTrails(folder, name, PARKED);
	}

	/** Trails drawn this frame (BulletRenderController sets it from the settings every frame). */
	trailsOn = false;

	/**
	 * `fade`: per-bullet transparency from its emitter id (co-op teammates' bullets), or undefined (always opaque).
	 * `ahead`: the frame's enemy bullets drawn ahead (docs/LOCAL_PREDICTION.md LP10; prepared, ticks > 0), or undefined
	 * (today's pairs: the player pools and every frame not drawing ahead).
	 */
	frame(sim: BulletSimulation, alpha: number, fade?: (emitter: number) => number, ahead?: BulletAhead): void {
		if (sim !== this.sim) {
			// A new run built new simulations: everything shown belongs to the old one.
			this.sim = sim;
			this.parkAll();
		}
		const n = sim.highWater();
		this.moveParts.clear();
		this.moveCFrames.clear();
		const prev = this.prev;
		const slots = math.max(this.parts.size(), n);
		const pose = this.pose;
		for (let i = 0; i < slots; i++) {
			let payload = -1;
			if (ahead === undefined) {
				if (i < n && sim.isVisible(i)) payload = sim.payloadAt(i);
			} else if (i < n && sim.isLive(i) && ahead.pose(sim, i, pose)) payload = sim.payloadAt(i);
			if (payload >= 0 && (this.skip === undefined || !this.skip(payload, i))) {
				const scale = sim.scaleAt(i);
				while (this.parts.size() <= i) this.grow();
				const part = this.parts[i];
				let x: number;
				let y: number;
				let z: number;
				if (ahead === undefined) {
					const cur = sim.positionAt(i);
					sim.previousPositionAt(i, prev);
					x = studsX(lerp(prev.x, cur.x, alpha));
					y = studsY(lerp(prev.y, cur.y, alpha));
					z = studsZ(lerp(prev.z, cur.z, alpha));
				} else {
					x = studsX(lerp(pose.prevX, pose.x, alpha));
					y = studsY(lerp(pose.prevY, pose.y, alpha));
					z = studsZ(lerp(pose.prevZ, pose.z, alpha));
				}
				const look = this.lookOf !== undefined ? this.lookOf(payload, scale) : 0;
				this.resize(i, scale, sim.fadeAt(i), look);
				const t = fade !== undefined ? fade(sim.emitterIdAt(i)) : 0;
				if (t !== this.alphaKey[i]) {
					this.alphaKey[i] = t;
					part.Transparency = t;
				}
				let cf: CFrame;
				if (this.orient) {
					const v = sim.velocityAt(i);
					const len = math.sqrt(v.x * v.x + v.z * v.z);
					cf =
						len > 0
							? CFrame.lookAlong(new Vector3(x, y, z), new Vector3(v.x, 0, v.z))
							: new CFrame(x, y, z);
				} else {
					cf = new CFrame(x, y, z);
				}
				this.moveParts.push(part);
				this.moveCFrames.push(cf);
				this.shown[i] = true;
				const trail = this.trailsOn ? this.trails?.[look] : undefined;
				if (trail !== undefined) {
					this.trailParts.place(i, trail, cf.mul(trail.offset), this.moveParts, this.moveCFrames);
				} else {
					this.trailParts.park(i, this.moveParts, this.moveCFrames);
				}
			} else if (i < this.parts.size()) {
				if (this.shown[i]) {
					this.moveParts.push(this.parts[i]);
					this.moveCFrames.push(PARKED);
					this.shown[i] = false;
				}
				this.trailParts.park(i, this.moveParts, this.moveCFrames);
			}
		}
		if (this.moveParts.size() > 0) {
			Workspace.BulkMoveTo(this.moveParts, this.moveCFrames, Enum.BulkMoveMode.FireCFrameChanged);
		}
	}

	poolSize(): number {
		return this.parts.size();
	}

	/** Trail parts created so far. */
	trailPoolSize(): number {
		return this.trailParts.size();
	}

	private parkAll(): void {
		this.moveParts.clear();
		this.moveCFrames.clear();
		for (let i = 0; i < this.parts.size(); i++) {
			this.trailParts.park(i, this.moveParts, this.moveCFrames);
			if (!this.shown[i]) continue;
			this.moveParts.push(this.parts[i]);
			this.moveCFrames.push(PARKED);
			this.shown[i] = false;
		}
		if (this.moveParts.size() > 0) {
			Workspace.BulkMoveTo(this.moveParts, this.moveCFrames, Enum.BulkMoveMode.FireCFrameChanged);
		}
	}

	private grow(): void {
		const look = this.looks[0];
		const v = look.visual;
		const part = renderPart("Part", false);
		part.Name = this.name;
		if (v.shape === "Ball") part.Shape = Enum.PartType.Ball;
		part.Color = look.color;
		part.Material = look.material;
		part.CFrame = PARKED;
		part.Parent = this.folder;
		this.parts.push(part);
		this.shown.push(false);
		this.sizeKey.push(-1);
		this.lookKey.push(0);
		this.alphaKey.push(0);
	}

	/** Writes Size only when the quantized drawn size (scale x end-of-life fade) or the look changes. */
	private resize(i: number, scale: number, fade: number, lookIndex: number): void {
		const look = this.looks[lookIndex] ?? this.looks[0];
		const was = this.looks[this.lookKey[i]] ?? this.looks[0];
		const q = BULLET_VIEW.sizeQuantum;
		const key = math.max(q, math.round((scale * fade) / q) * q);
		this.lookKey[i] = lookIndex;
		if (key === this.sizeKey[i] && look === was) return;
		this.sizeKey[i] = key;
		const part = this.parts[i];
		if (look !== was) {
			part.Color = look.color;
			part.Material = look.material;
			(part as Part).Shape = look.visual.shape === "Ball" ? Enum.PartType.Ball : Enum.PartType.Block;
		}
		const [sx, sy, sz] = look.visual.size;
		const k = look.baseScale * key;
		part.Size = new Vector3(sx * k, sy * k, sz * k);
	}
}

/** What a floor decal pool draws: which bullets, their look over life, and where on the floor. */
interface DecalSpec {
	readonly name: string;
	readonly accepts: (payload: number) => boolean;
	readonly look: (lifeLeft: number, totalLife: number, out: GooLook | EmberLook) => GooLook | EmberLook;
	readonly liftStuds: number;
	readonly thicknessStuds: number;
	readonly quantum: number;
}

/** The goo puddles' decal spec (docs/ENEMY_VARIANTS.md EVD5). */
const GOO_DECAL: DecalSpec = {
	name: "Goo",
	accepts: isGooPayload,
	look: gooDecalLook,
	liftStuds: GOO_VIEW.liftStuds,
	thicknessStuds: GOO_VIEW.thicknessStuds,
	quantum: GOO_VIEW.quantum,
};

/**
 * The Stormcaller's strikes (docs/NEW_ENEMIES.md NE8): a short flash on the floor, over the goo, under the aura / affix
 * rings and every marking (it lands where the strike row's circle was).
 */
const STRIKE_DECAL: DecalSpec = {
	name: "Strike",
	accepts: isStrikePayload,
	look: strikeDecalLook,
	liftStuds: STRIKE_VIEW.liftStuds,
	thicknessStuds: STRIKE_VIEW.thicknessStuds,
	quantum: STRIKE_VIEW.quantum,
};

/** The embers' decal spec (docs/BUILDS.md BU8): under the goo, every marking and every moving bullet. */
const EMBER_DECAL: DecalSpec = {
	name: "Ember",
	accepts: isEmberPayload,
	look: emberDecalLook,
	liftStuds: BUILD_BULLET_VIEW.ember.liftStuds,
	thicknessStuds: BUILD_BULLET_VIEW.ember.thicknessStuds,
	quantum: BUILD_BULLET_VIEW.ember.quantum,
};

/**
 * Stationary bullets drawn as flat floor discs: the Ooze's goo puddles (docs/ENEMY_VARIANTS.md EVD5) from the enemy
 * bullet simulation, and the build embers (docs/BUILDS.md BU8) from the player one. Part i = bullet SLOT i like
 * BulletPool, but only slots `spec.accepts` (by payload kind), each a flat disc of its placeholder (goo: enemyGoo;
 * ember: build.ember; Neon) lying on the floor at the spec's lift: goo over the sprite effects and the embers, under
 * the affix rings, every marking and every moving bullet. It pops in and fades out over its life (spec.look;
 * Size / Transparency written only on a quantized change). Decals never move, so no interpolation. ONE BulkMoveTo per
 * frame.
 * Sprite mode (docs/GOO_ART.md GA4): given a floor sprite drawer (the goo's FloorSpritePool, when the pack's
 * `bullet.enemy.goo` has floor sprite art; docs/HAZARD_ART.md HA5: the strike's StrikeSpritePool and the embers'
 * EmberSpritePool, when theirs have hazard art), the pool hands its frames to it instead; without one, exactly the
 * discs. Stand-ins (docs/STAGE_ASSETS.md SA17): per frame `artReady` (the id's art downloaded on this device) picks
 * the drawer or the discs; a change parks the other side first, so a puddle / strike / ember on the floor turns into
 * its art (or back, under KV_StandInsForce) on the frame.
 */
class DecalPool {
	private readonly parts = new Array<BasePart>();
	private readonly shown = new Array<boolean>();
	private readonly sizeKey = new Array<number>();
	private readonly alphaKey = new Array<number>();
	private readonly moveParts = new Array<BasePart>();
	private readonly moveCFrames = new Array<CFrame>();
	private readonly look: GooLook = { scale: 0, transparency: 0 };
	private readonly y: number;
	private readonly sprites: FloorSpriteDrawer | undefined;
	/** The sprite drawer drew last frame (the discs are parked), SA17. */
	private spriteMode = false;
	private sim: BulletSimulation | undefined;

	constructor(
		private readonly folder: Folder,
		private readonly spec: DecalSpec,
		private readonly color: Color3,
		private readonly material: Enum.Material,
		/** Disc diameter at full size, studs. */
		private readonly diameter: number,
		/** A decal's whole life, seconds (the pop-in reads its age from it). */
		private readonly totalLife: number,
		/** Sprite mode: the floor sprites drawn instead of the disc (GOO_ART GA4, HAZARD_ART HA5); absent: the disc. */
		sprites?: FloorSpriteDrawer,
	) {
		this.y = floorStudsY() + spec.liftStuds + spec.thicknessStuds / 2;
		this.sprites = sprites;
	}

	/** `artReady`: the sprite drawer's art is ready (SA17); ignored without a drawer. */
	frame(sim: BulletSimulation, clock: HazardClock, artReady: boolean): void {
		const sprites = this.sprites;
		if (sprites !== undefined && artReady) {
			if (!this.spriteMode) {
				this.spriteMode = true;
				this.parkAll();
			}
			sprites.frame(sim, clock);
			return;
		}
		if (sprites !== undefined && this.spriteMode) {
			this.spriteMode = false;
			sprites.parkAll();
		}
		if (sim !== this.sim) {
			this.sim = sim;
			this.parkAll();
		}
		const n = sim.highWater();
		this.moveParts.clear();
		this.moveCFrames.clear();
		const spec = this.spec;
		const q = spec.quantum;
		for (let i = 0; i < n; i++) {
			if (!sim.isVisible(i) || !spec.accepts(sim.payloadAt(i))) {
				if (i < this.parts.size()) this.park(i);
				continue;
			}
			spec.look(sim.lifeAt(i), this.totalLife, this.look);
			const size = math.round(this.look.scale / q) * q;
			const alpha = math.round(this.look.transparency / q) * q;
			if (size < q || alpha >= 1) {
				if (i < this.parts.size()) this.park(i);
				continue;
			}
			while (this.parts.size() <= i) this.grow();
			const part = this.parts[i];
			if (size !== this.sizeKey[i]) {
				this.sizeKey[i] = size;
				const d = this.diameter * size;
				part.Size = new Vector3(spec.thicknessStuds, d, d);
			}
			if (alpha !== this.alphaKey[i]) {
				this.alphaKey[i] = alpha;
				part.Transparency = alpha;
			}
			const p = sim.positionAt(i);
			this.moveParts.push(part);
			this.moveCFrames.push(new CFrame(studsX(p.x), this.y, studsZ(p.z)).mul(FLAT));
			this.shown[i] = true;
		}
		for (let i = n; i < this.parts.size(); i++) this.park(i);
		if (this.moveParts.size() > 0) {
			Workspace.BulkMoveTo(this.moveParts, this.moveCFrames, Enum.BulkMoveMode.FireCFrameChanged);
		}
	}

	/** Pooled discs plus sprite anchors (the discs are the stand-in while the art loads, SA17). */
	poolSize(): number {
		return this.parts.size() + (this.sprites?.poolSize() ?? 0);
	}

	private park(i: number): void {
		if (!this.shown[i]) return;
		this.shown[i] = false;
		this.moveParts.push(this.parts[i]);
		this.moveCFrames.push(PARKED);
	}

	private parkAll(): void {
		this.moveParts.clear();
		this.moveCFrames.clear();
		for (let i = 0; i < this.parts.size(); i++) this.park(i);
		if (this.moveParts.size() > 0) {
			Workspace.BulkMoveTo(this.moveParts, this.moveCFrames, Enum.BulkMoveMode.FireCFrameChanged);
		}
	}

	private grow(): void {
		const part = renderPart("Part", false);
		part.Name = this.spec.name;
		part.Shape = Enum.PartType.Cylinder;
		part.Color = this.color;
		part.Material = this.material;
		part.CFrame = PARKED;
		part.Parent = this.folder;
		this.parts.push(part);
		this.shown.push(false);
		this.sizeKey.push(-1);
		this.alphaKey.push(-1);
	}
}

function bulletLook(pack: ThemePack, id: string, drawExtentStuds: number, axis: 0 | 2): BulletLook {
	const visual = pack.placeholder(id);
	const extent = visual.size[axis];
	return {
		visual,
		color: pack.visualColor(visual.color),
		material: Enum.Material[visual.material],
		baseScale: extent > 0 ? drawExtentStuds / extent : 1,
	};
}

/** The trail of a look: behind the bolt along its axis, BUILD_BULLET_VIEW.trail's length and cross-section. */
function trailLook(look: BulletLook): TrailLook {
	const t = BUILD_BULLET_VIEW.trail;
	const [sx, sy, sz] = look.visual.size;
	const k = look.baseScale;
	const len = t.lengthTiles * STUDS_PER_TILE;
	return {
		color: look.color,
		size: new Vector3(sx * k * t.widthScale, sy * k * t.widthScale, len),
		offset: new CFrame(0, 0, (sz * k) / 2 + len / 2),
	};
}

/**
 * Draws both bullet simulations (web BulletsView): enemy bullets as neon balls of BULLET_VIEW.enemyDrawRadius, player
 * bullets as bolts along their velocity (BULLET_VIEW.playerDrawHalfLength; heavy arrows use the heavy placeholder),
 * each scaled by the bullet's draw scale and its end-of-life fade. Theme placeholders and colour roles only.
 * Outlines (the theme's *BulletOutline roles) are not drawn yet: a Highlight per bullet is far over budget.
 * Co-op (M4): in a large party a teammate's bolts draw at TEAMMATE_BULLET_OPACITY (shared/view party.ts).
 * Goo puddles (docs/ENEMY_VARIANTS.md EVD5): while GOO_VIEW.decal is on, the enemy pool skips BulletKind.GOO and a
 * second pool on the same simulation (DecalPool) draws them as flat floor decals under everything that moves; off (the
 * fallback), goo is drawn like every enemy bullet.
 * Strikes (docs/NEW_ENEMIES.md NE8): while STRIKE_VIEW.decal is on, the enemy pool skips BulletKind.STRIKE too and a
 * third pool on the enemy simulation (DecalPool, the goo's code path) draws each as a short flat flash
 * (`bullet.enemy.strike`'s colour, Neon) of the strike's hit radius; off, strikes are drawn like every enemy bullet.
 * Build effects (docs/BUILDS.md BU8): player bullets take their look by payload kind (shared/view playerBulletLookOf:
 * `bullet.player.burst` / `.shard` / `.bolt` in the build.* roles), burst and shard bolts trail a faint part while
 * buildFx is Full and reduced motion is off (buildTrailsOn, read every frame); embers go to a decal pool on the player
 * simulation (BUILD_BULLET_VIEW.ember, under the goo) while its decal look is on.
 * Sprite bullets (docs/PROJECTILE_ART.md PA5): enemy bullets take their look by kind too (shared/view
 * enemyBulletLookOf: `bullet.enemy.small` / `.medium` / `.large` / `.needle`, every placeholder today's small ball).
 * A look whose `pack.bullet(id)` has art draws in a SpriteBulletPool on the same simulation (floor-flat sprites turned
 * along the velocity, flicker, unlit), and the neon pool skips those bullets; a look without art stays a neon part.
 * No look with art (the placeholder pack, vale before its bullet atlas has an id): no sprite pool is built and every
 * pool runs exactly as before. Trails stay neon parts.
 * Goo art (docs/GOO_ART.md GA4): when the pack's `bullet.enemy.goo` has floor sprite art (pack.floorSprite), the goo
 * DecalPool runs in sprite mode (FloorSpritePool: flat slime puddles, screen-up, sized to cover the hit); without it
 * the disc exactly as before, and with GOO_VIEW.decal off the normal enemy bullet look.
 * Hazard art (docs/HAZARD_ART.md HA5, superseding PAD3): when the pack's `bullet.enemy.strike` / `bullet.player.ember`
 * has hazard sprite art (pack.hazardSprite), their DecalPools run in sprite mode: StrikeSpritePool (the flash over the
 * strike's life, then a scorch after it, tinted enemyBullet) and EmberSpritePool (the burn loop, tinted build.ember);
 * without it the discs exactly as before.
 * Stand-ins (docs/STAGE_ASSETS.md "Revision 2", SA17): art is drawn only once its id is READY on this device
 * (PreloadController's readiness, shared/view ReadyIds re-read when its epoch moves). The sprite pools are built up
 * front whenever the pack has art (their anchors grow lazily, so an unready pool costs nothing) and skip a look that is
 * not ready, which the neon pool after them then draws: bullets in flight change pool on the frame the look flips
 * (either way). The goo / strike / ember DecalPools draw their discs until their art is ready (`artReady`), then the
 * sprites. Nothing is ever drawn from an image that has not downloaded.
 */
@Controller({})
export class BulletRenderController implements OnStart {
	private enemy: BulletPool | undefined;
	private player: BulletPool | undefined;
	/** Sprite pools (docs/PROJECTILE_ART.md PA5): built only when a look of theirs has art (pack.bullet). */
	private enemySprites: SpriteBulletPool | undefined;
	private playerSprites: SpriteBulletPool | undefined;
	private goo: DecalPool | undefined;
	private strike: DecalPool | undefined;
	private ember: DecalPool | undefined;

	constructor(
		private readonly sim: SimController,
		private readonly theme: ThemeController,
		private readonly preload: PreloadController,
	) {}

	onStart(): void {
		const pack = this.theme.getPack();
		const folder = new Instance("Folder");
		folder.Name = BULLET_VIEW.folderName;
		folder.Parent = Workspace;
		const S = STUDS_PER_TILE;
		const enemyDiameter = 2 * BULLET_VIEW.enemyDrawRadius * S;
		const playerLength = 2 * BULLET_VIEW.playerDrawHalfLength * S;
		const decal = GOO_VIEW.decal;
		const strikeDecal = STRIKE_VIEW.decal;
		const skip =
			decal || strikeDecal
				? (payload: number) => (decal && isGooPayload(payload)) || (strikeDecal && isStrikePayload(payload))
				: undefined;
		// Every enemy look's placeholder is today's small ball (the needle's sliver would change snipers' bullets):
		// one shared look object, so a part never rewrites its props when its bullet's look index changes.
		const small = bulletLook(pack, BULLET_VIEW.enemyVisualId, enemyDiameter, 0);
		const enemyArt = artLooks(pack, ENEMY_BULLET_LOOK_IDS, "enemy");
		const enemyReady = artReadyIds(ENEMY_BULLET_LOOK_IDS, enemyArt);
		const enemySprites =
			enemyArt.size() > 0
				? new SpriteBulletPool(
						subFolder(folder, BULLET_ART_VIEW.folderNames.enemy),
						"EnemyBulletSprite",
						PARKED,
						enemyArt,
						enemyBulletLookOf,
						skip,
						undefined,
						BULLET_ART_VIEW.liftStuds.enemy,
				  )
				: undefined;
		if (enemySprites !== undefined) enemySprites.ready = enemyReady;
		this.enemySprites = enemySprites;
		const enemy = new BulletPool(
			folder,
			"EnemyBullet",
			ENEMY_BULLET_LOOK_IDS.map(() => small),
			false,
			withSprites(skip, enemySprites),
			enemyBulletLookOf,
		);
		let strike: DecalPool | undefined;
		if (strikeDecal) {
			const visual = pack.placeholder(STRIKE_BULLET_ID);
			// docs/HAZARD_ART.md HA5: the pack's strike hazard sprite (flash + scorch), when it has one, instead of the disc
			const strikeArt = pack.hazardSprite(STRIKE_BULLET_ID);
			const life = STORMCALLER.data.strike.life;
			// SA17: the discs (the stand-in) in their own folder, the art's anchors in theirs
			const strikeFolder = subFolder(folder, STRIKE_VIEW.folderName);
			strike = new DecalPool(
				strikeFolder,
				STRIKE_DECAL,
				pack.visualColor(visual.color),
				Enum.Material[visual.material],
				2 * STRIKE_BULLET_RADIUS * S,
				life,
				strikeArt !== undefined
					? new StrikeSpritePool(
							subFolder(folder, HAZARD_ART_VIEW.strike.folderName),
							subFolder(folder, HAZARD_ART_VIEW.scorch.folderName),
							PARKED,
							strikeArt,
							pack.color(HAZARD_ART_VIEW.strike.role),
							STRIKE_DECAL.accepts,
							life,
							STRIKE_DECAL.liftStuds + STRIKE_DECAL.thicknessStuds,
							STRIKE_DECAL.thicknessStuds,
							HAZARD_ART_VIEW.quantum,
							S,
					  )
					: undefined,
			);
		}
		this.strike = strike;
		let goo: DecalPool | undefined;
		if (decal) {
			const visual = pack.placeholder(GOO_BULLET_ID);
			// docs/GOO_ART.md GA4: the pack's goo floor sprite, when it has one, instead of the disc
			const gooArt = pack.floorSprite(GOO_BULLET_ID);
			goo = new DecalPool(
				subFolder(folder, GOO_VIEW.folderName),
				GOO_DECAL,
				pack.visualColor(visual.color),
				Enum.Material[visual.material],
				2 * GOO_BULLET_RADIUS * S,
				SLIME.data.goo.life,
				gooArt !== undefined
					? new FloorSpritePool(
							subFolder(folder, GOO_ART_VIEW.folderName),
							`${GOO_DECAL.name}Sprite`,
							PARKED,
							floorSpriteLook(gooArt, S, GOO_VIEW.thicknessStuds),
							GOO_DECAL.accepts,
							SLIME.data.goo.life,
							GOO_DECAL.liftStuds + GOO_DECAL.thicknessStuds,
							GOO_DECAL.quantum,
					  )
					: undefined,
			);
		}
		this.goo = goo;
		const emberDecal = BUILD_BULLET_VIEW.ember.decal;
		let ember: DecalPool | undefined;
		if (emberDecal) {
			const emberId = PLAYER_BULLET_LOOK_IDS[PlayerBulletLook.EMBER];
			const visual = pack.placeholder(emberId);
			// docs/HAZARD_ART.md HA5: the pack's ember hazard sprite (the burn loop), when it has one, instead of the disc
			const emberArt = pack.hazardSprite(emberId);
			ember = new DecalPool(
				subFolder(folder, BUILD_BULLET_VIEW.ember.folderName),
				EMBER_DECAL,
				pack.visualColor(visual.color),
				Enum.Material[visual.material],
				BUILD_BULLET_VIEW.ember.diameterTiles * S,
				EMBER_BURST.life,
				emberArt !== undefined
					? new EmberSpritePool(
							subFolder(folder, HAZARD_ART_VIEW.ember.folderName),
							PARKED,
							emberArt,
							pack.color(HAZARD_ART_VIEW.ember.role),
							EMBER_DECAL.accepts,
							EMBER_DECAL.liftStuds + EMBER_DECAL.thicknessStuds,
							EMBER_DECAL.thicknessStuds,
							HAZARD_ART_VIEW.quantum,
							S,
					  )
					: undefined,
			);
		}
		this.ember = ember;
		// SA17: the hazards' art readiness by HAZARD_* index (undefined: no art, discs only)
		const emberHazardId = PLAYER_BULLET_LOOK_IDS[PlayerBulletLook.EMBER];
		const hazardReady = new ReadyIds([
			decal && pack.floorSprite(GOO_BULLET_ID) !== undefined ? GOO_BULLET_ID : undefined,
			strikeDecal && pack.hazardSprite(STRIKE_BULLET_ID) !== undefined ? STRIKE_BULLET_ID : undefined,
			emberDecal && pack.hazardSprite(emberHazardId) !== undefined ? emberHazardId : undefined,
		]);
		const looks = PLAYER_BULLET_LOOK_IDS.map((id) => bulletLook(pack, id, playerLength, 2));
		const trails = looks.map((look, i) => (lookHasTrail(i as PlayerBulletLookId) ? trailLook(look) : undefined));
		const playerSkip = emberDecal ? isEmberPayload : undefined;
		const playerArt = artLooks(pack, PLAYER_BULLET_LOOK_IDS, "player");
		const playerReady = artReadyIds(PLAYER_BULLET_LOOK_IDS, playerArt);
		let playerSprites: SpriteBulletPool | undefined;
		if (playerArt.size() > 0) {
			const spriteTrails = new Map<number, TrailLook>();
			for (let i = 0; i < looks.size(); i++) {
				const trail = trails[i];
				if (trail !== undefined) spriteTrails.set(i, trail);
			}
			playerSprites = new SpriteBulletPool(
				subFolder(folder, BULLET_ART_VIEW.folderNames.player),
				"PlayerBulletSprite",
				PARKED,
				playerArt,
				playerBulletLookOf,
				playerSkip,
				spriteTrails,
				BULLET_ART_VIEW.liftStuds.player,
			);
			playerSprites.ready = playerReady;
		}
		this.playerSprites = playerSprites;
		const player = new BulletPool(
			folder,
			"PlayerBullet",
			looks,
			true,
			withSprites(playerSkip, playerSprites),
			playerBulletLookOf,
			trails,
		);
		this.enemy = enemy;
		this.player = player;

		const ahead = new BulletAhead();
		RunService.BindToRenderStep(
			RENDER_STEP,
			Enum.RenderPriority.Camera.Value + RENDER_ORDER.viewsAfterCamera,
			() => {
				const state = this.sim.getState();
				if (state === undefined) return;
				debug.profilebegin(BULLET_VIEW.profileLabel);
				const alpha = this.sim.getAlpha();
				const store = clientStore.getState();
				const reducedMotion = selectJuice(store).reducedMotion;
				// SA17: art only once ready (re-read when the readiness epoch moved)
				const readiness = this.preload.getReadiness();
				enemyReady.refresh(readiness);
				playerReady.refresh(readiness);
				hazardReady.refresh(readiness);
				// docs/LOCAL_PREDICTION.md LP10: enemy bullets drawn as many ticks ahead as the knight (0: today's).
				const aheadTicks = this.sim.getPredictionAheadTicks();
				const ctx = this.sim.getContext();
				let enemyAhead: BulletAhead | undefined;
				if (aheadTicks > 0 && ctx !== undefined) {
					ahead.prepare(state, simWorldConfig(state, ctx.config), aheadTicks);
					if (ahead.ticks > 0) enemyAhead = ahead;
				}
				// Sprite pools first: each neon pool then skips the slots its sprite pool drew (withSprites).
				if (enemySprites !== undefined) {
					enemySprites.reducedMotion = reducedMotion;
					enemySprites.frame(state.combat.enemyBullets, alpha, undefined, enemyAhead);
				}
				enemy.frame(state.combat.enemyBullets, alpha, undefined, enemyAhead);
				// docs/HAZARD_ART.md HA5: the sprite drawers' clock (sim seconds, the floor, motion); discs ignore it
				const clock: HazardClock = {
					simSec: (state.tick + alpha) / SIM_HZ,
					floorKey: state.endless?.floor ?? 0,
					motion: !reducedMotion,
				};
				goo?.frame(state.combat.enemyBullets, clock, hazardReady.isReady(HAZARD_GOO));
				strike?.frame(state.combat.enemyBullets, clock, hazardReady.isReady(HAZARD_STRIKE));
				ember?.frame(state.combat.playerBullets, clock, hazardReady.isReady(HAZARD_EMBER));
				const n = partySize(state);
				const me = this.sim.getViewPlayerIndex(); // spectating: the watched teammate's bullets stay opaque
				const trailsOn = buildTrailsOn(selectDisplay(store).buildFx, reducedMotion);
				const fade = n > 1 ? (emitter: number) => playerBulletTransparency(n, emitter, me) : undefined;
				if (playerSprites !== undefined) {
					playerSprites.trailsOn = trailsOn;
					playerSprites.reducedMotion = reducedMotion;
					playerSprites.frame(state.combat.playerBullets, alpha, fade);
				}
				player.trailsOn = trailsOn;
				player.frame(state.combat.playerBullets, alpha, fade);
				debug.profileend();
			},
		);
	}

	/** Pooled bullet parts (enemy, player). */
	getPoolSizes(): [number, number] {
		return [this.enemy?.poolSize() ?? 0, this.player?.poolSize() ?? 0];
	}

	/** Pooled sprite bullet anchors (enemy, player; 0 while no look of theirs has art, docs/PROJECTILE_ART.md PA5). */
	getSpritePoolSizes(): [number, number] {
		return [this.enemySprites?.poolSize() ?? 0, this.playerSprites?.poolSize() ?? 0];
	}

	/** Pooled goo decal parts, or goo sprite anchors with goo art (0 with the decal look off). */
	getGooPoolSize(): number {
		return this.goo?.poolSize() ?? 0;
	}

	/** Pooled strike flash parts (0 with the strike decal off; docs/NEW_ENEMIES.md NE8). */
	getStrikePoolSize(): number {
		return this.strike?.poolSize() ?? 0;
	}

	/** Pooled ember decal parts and burst / shard trail parts (docs/BUILDS.md BU8). */
	getBuildPoolSizes(): [number, number] {
		return [
			this.ember?.poolSize() ?? 0,
			(this.player?.trailPoolSize() ?? 0) + (this.playerSprites?.trailPoolSize() ?? 0),
		];
	}
}

/**
 * The sprite art of each look that has any (pack.bullet), by look index, each drawn at its own size at its reference
 * scale (shared/view bulletArtReferenceScale); empty: every look is its placeholder.
 */
function artLooks(
	pack: ThemePack,
	ids: ReadonlyArray<string>,
	pool: "player" | "enemy",
): ReadonlyMap<number, SpriteBulletLook> {
	const out = new Map<number, SpriteBulletLook>();
	for (let i = 0; i < ids.size(); i++) {
		const sprite = pack.bullet(ids[i]);
		if (sprite !== undefined) {
			out.set(i, spriteBulletLook(sprite, STUDS_PER_TILE, bulletArtReferenceScale(pool, i)));
		}
	}
	return out;
}

/** By look index, the look's logical id when it has art (`art`), else undefined: the sprite pool's readiness gate. */
function artReadyIds(ids: ReadonlyArray<string>, art: ReadonlyMap<number, SpriteBulletLook>): ReadyIds {
	return new ReadyIds(ids.map((id, i) => (art.has(i) ? id : undefined)));
}

/**
 * A neon pool's skip: its own (`skip`, the decal pools' kinds) plus the slots `sprites` drew this frame (it runs
 * first). No sprite pool: `skip` itself, so a pack without bullet art runs exactly today's code.
 */
function withSprites(
	skip: ((payload: number) => boolean) | undefined,
	sprites: SpriteBulletPool | undefined,
): ((payload: number, slot: number) => boolean) | undefined {
	if (sprites === undefined) return skip;
	return (payload, slot) => sprites.drew(slot) || (skip !== undefined && skip(payload));
}

function subFolder(parent: Folder, name: string): Folder {
	const f = new Instance("Folder");
	f.Name = name;
	f.Parent = parent;
	return f;
}
