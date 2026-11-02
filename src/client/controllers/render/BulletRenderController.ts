import { Controller, OnStart } from "@flamework/core";
import { RunService, Workspace } from "@rbxts/services";
import { clientStore, selectDisplay, selectJuice } from "client/store";
import { STUDS_PER_TILE } from "shared/config";
import {
	EMBER_BURST,
	GOO_BULLET_RADIUS,
	SLIME,
	STORMCALLER,
	STRIKE_BULLET_RADIUS,
	partySize,
	type BulletSimulation,
	type Vec3 as SimVec3,
} from "shared/sim";
import { GOO_BULLET_ID, STRIKE_BULLET_ID, type PlaceholderVisual, type ThemePack } from "shared/theme";
import {
	BUILD_BULLET_VIEW,
	BULLET_VIEW,
	GOO_VIEW,
	PLAYER_BULLET_LOOK_IDS,
	STRIKE_VIEW,
	PlayerBulletLook,
	emberDecalLook,
	lookHasTrail,
	playerBulletLookOf,
	type EmberLook,
	type PlayerBulletLookId,
	RENDER_ORDER,
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
import { SimController } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import { renderPart } from "./placeholders";

const RENDER_STEP = "KV_Bullets";
const PARKED = new CFrame(BULLET_VIEW.parkedStuds[0], BULLET_VIEW.parkedStuds[1], BULLET_VIEW.parkedStuds[2]);
/** A Cylinder's axis is X: turned to Y, it lies flat on the floor (the goo disc). */
const FLAT = CFrame.Angles(0, 0, math.pi / 2);

interface BulletLook {
	readonly visual: PlaceholderVisual;
	readonly color: Color3;
	readonly material: Enum.Material;
	/** Studs per unit of the visual's size, so the drawn size matches BULLET_VIEW's draw radius at scale 1. */
	readonly baseScale: number;
}

/** A look's trail (docs/BUILDS.md BU8): its length and cross-section, studs. */
interface TrailLook {
	readonly color: Color3;
	readonly size: Vector3;
	/** Offset behind the bolt's centre along its axis (+Z local: CFrame.lookAlong points -Z down the velocity). */
	readonly offset: CFrame;
}

/**
 * One bullet simulation drawn as pooled Parts, part i = bullet SLOT i (so a part keeps its bullet for the bullet's
 * whole life and sizes rarely change). Each frame every visible bullet is moved to its interpolated position
 * (previousPositionAt -> positionAt by the sim's alpha) and every part that just lost its bullet is parked, all in ONE
 * workspace:BulkMoveTo (spike A). The pool grows lazily to the simulation's high-water mark.
 *
 * Looks (docs/BUILDS.md BU8): `looks` is indexed by `lookOf(payload, scale)` (the player pool: shared/view
 * playerBulletLookOf, basic / heavy / burst / shard / bolt; the enemy pool: always look 0). A part switches Color /
 * Material / Size only when its look or quantized size changes (one pool, no extra parts per kind). Looks with a
 * `trails` entry also move a faint trail part per slot behind the bolt while `trailsOn` (buildFx Full, not reduced
 * motion); trail parts grow lazily too and park with their bullet.
 */
class BulletPool {
	private readonly parts = new Array<BasePart>();
	private readonly shown = new Array<boolean>();
	/** Quantized drawn size per part (BULLET_VIEW.sizeQuantum steps); -1 = never set. */
	private readonly sizeKey = new Array<number>();
	private readonly lookKey = new Array<number>();
	/** Trail parts by slot (created on first use; a Map: Luau arrays cannot hold holes), and the shown ones. */
	private readonly trailParts = new Map<number, BasePart>();
	private readonly trailShown = new Set<number>();
	private trailFolder: Folder | undefined;
	/** Last transparency written per part (co-op: teammates' bullets in large parties). */
	private readonly alphaKey = new Array<number>();
	private readonly moveParts = new Array<BasePart>();
	private readonly moveCFrames = new Array<CFrame>();
	private readonly prev: SimVec3 = { x: 0, y: 0, z: 0 };
	private sim: BulletSimulation | undefined;

	constructor(
		private readonly folder: Folder,
		private readonly name: string,
		/** The looks by index (lookOf's result); look 0 is the pool's default (new parts start with it). */
		private readonly looks: ReadonlyArray<BulletLook>,
		/** Turn the part along the velocity (player bolts); enemy balls are round. */
		private readonly orient: boolean,
		/** Bullets this pool leaves to another one, by payload (the enemy pool skips goo while the goo pool draws it). */
		private readonly skip?: (payload: number) => boolean,
		/** The look of a bullet by payload and draw scale (absent: look 0). */
		private readonly lookOf?: (payload: number, scale: number) => number,
		/** Trails by look index (absent / undefined entry: no trail). */
		private readonly trails?: ReadonlyArray<TrailLook | undefined>,
	) {}

	/** Trails drawn this frame (BulletRenderController sets it from the settings every frame). */
	trailsOn = false;

	/**
	 * `fade`: per-bullet transparency from its emitter id (co-op teammates' bullets), or undefined (always opaque).
	 */
	frame(sim: BulletSimulation, alpha: number, fade?: (emitter: number) => number): void {
		if (sim !== this.sim) {
			// A new run built new simulations: everything shown belongs to the old one.
			this.sim = sim;
			this.parkAll();
		}
		const n = sim.highWater();
		while (this.parts.size() < n) this.grow();
		this.moveParts.clear();
		this.moveCFrames.clear();
		const prev = this.prev;
		for (let i = 0; i < this.parts.size(); i++) {
			const part = this.parts[i];
			const payload = i < n && sim.isVisible(i) ? sim.payloadAt(i) : -1;
			if (payload >= 0 && (this.skip === undefined || !this.skip(payload))) {
				const cur = sim.positionAt(i);
				sim.previousPositionAt(i, prev);
				const x = studsX(lerp(prev.x, cur.x, alpha));
				const y = studsY(lerp(prev.y, cur.y, alpha));
				const z = studsZ(lerp(prev.z, cur.z, alpha));
				const scale = sim.scaleAt(i);
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
				if (trail !== undefined) this.placeTrail(i, trail, cf.mul(trail.offset));
				else this.parkTrail(i);
			} else {
				if (this.shown[i]) {
					this.moveParts.push(part);
					this.moveCFrames.push(PARKED);
					this.shown[i] = false;
				}
				this.parkTrail(i);
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

	private placeTrail(i: number, trail: TrailLook, cf: CFrame): void {
		let t = this.trailParts.get(i);
		if (t === undefined) {
			t = renderPart("Part", false);
			t.Name = `${this.name}Trail`;
			t.Material = Enum.Material.Neon;
			t.Transparency = BUILD_BULLET_VIEW.trail.transparency;
			t.CFrame = PARKED;
			if (this.trailFolder === undefined) {
				const f = new Instance("Folder");
				f.Name = BUILD_BULLET_VIEW.trail.folderName;
				f.Parent = this.folder;
				this.trailFolder = f;
			}
			t.Parent = this.trailFolder;
			this.trailParts.set(i, t);
		}
		if (t.Color !== trail.color) t.Color = trail.color;
		if (t.Size !== trail.size) t.Size = trail.size;
		this.moveParts.push(t);
		this.moveCFrames.push(cf);
		this.trailShown.add(i);
	}

	private parkTrail(i: number): void {
		if (!this.trailShown.has(i)) return;
		const t = this.trailParts.get(i);
		this.trailShown.delete(i);
		if (t === undefined) return;
		this.moveParts.push(t);
		this.moveCFrames.push(PARKED);
	}

	private parkAll(): void {
		this.moveParts.clear();
		this.moveCFrames.clear();
		for (let i = 0; i < this.parts.size(); i++) {
			this.parkTrail(i);
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
		const q = BULLET_VIEW.sizeQuantum;
		const key = math.max(q, math.round((scale * fade) / q) * q);
		if (key === this.sizeKey[i] && lookIndex === this.lookKey[i]) return;
		this.sizeKey[i] = key;
		const part = this.parts[i];
		if (lookIndex !== this.lookKey[i]) {
			this.lookKey[i] = lookIndex;
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
	) {
		this.y = floorStudsY() + spec.liftStuds + spec.thicknessStuds / 2;
	}

	frame(sim: BulletSimulation): void {
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

	poolSize(): number {
		return this.parts.size();
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
 */
@Controller({})
export class BulletRenderController implements OnStart {
	private enemy: BulletPool | undefined;
	private player: BulletPool | undefined;
	private goo: DecalPool | undefined;
	private strike: DecalPool | undefined;
	private ember: DecalPool | undefined;

	constructor(private readonly sim: SimController, private readonly theme: ThemeController) {}

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
		const enemy = new BulletPool(
			folder,
			"EnemyBullet",
			[bulletLook(pack, BULLET_VIEW.enemyVisualId, enemyDiameter, 0)],
			false,
			skip,
		);
		let strike: DecalPool | undefined;
		if (strikeDecal) {
			const visual = pack.placeholder(STRIKE_BULLET_ID);
			strike = new DecalPool(
				subFolder(folder, STRIKE_VIEW.folderName),
				STRIKE_DECAL,
				pack.visualColor(visual.color),
				Enum.Material[visual.material],
				2 * STRIKE_BULLET_RADIUS * S,
				STORMCALLER.data.strike.life,
			);
		}
		this.strike = strike;
		let goo: DecalPool | undefined;
		if (decal) {
			const visual = pack.placeholder(GOO_BULLET_ID);
			goo = new DecalPool(
				subFolder(folder, GOO_VIEW.folderName),
				GOO_DECAL,
				pack.visualColor(visual.color),
				Enum.Material[visual.material],
				2 * GOO_BULLET_RADIUS * S,
				SLIME.data.goo.life,
			);
		}
		this.goo = goo;
		const emberDecal = BUILD_BULLET_VIEW.ember.decal;
		let ember: DecalPool | undefined;
		if (emberDecal) {
			const visual = pack.placeholder(PLAYER_BULLET_LOOK_IDS[PlayerBulletLook.EMBER]);
			ember = new DecalPool(
				subFolder(folder, BUILD_BULLET_VIEW.ember.folderName),
				EMBER_DECAL,
				pack.visualColor(visual.color),
				Enum.Material[visual.material],
				BUILD_BULLET_VIEW.ember.diameterTiles * S,
				EMBER_BURST.life,
			);
		}
		this.ember = ember;
		const looks = PLAYER_BULLET_LOOK_IDS.map((id) => bulletLook(pack, id, playerLength, 2));
		const trails = looks.map((look, i) => (lookHasTrail(i as PlayerBulletLookId) ? trailLook(look) : undefined));
		const player = new BulletPool(
			folder,
			"PlayerBullet",
			looks,
			true,
			emberDecal ? isEmberPayload : undefined,
			playerBulletLookOf,
			trails,
		);
		this.enemy = enemy;
		this.player = player;

		RunService.BindToRenderStep(
			RENDER_STEP,
			Enum.RenderPriority.Camera.Value + RENDER_ORDER.viewsAfterCamera,
			() => {
				const state = this.sim.getState();
				if (state === undefined) return;
				debug.profilebegin(BULLET_VIEW.profileLabel);
				const alpha = this.sim.getAlpha();
				enemy.frame(state.combat.enemyBullets, alpha);
				goo?.frame(state.combat.enemyBullets);
				strike?.frame(state.combat.enemyBullets);
				ember?.frame(state.combat.playerBullets);
				const n = partySize(state);
				const me = this.sim.getViewPlayerIndex(); // spectating: the watched teammate's bullets stay opaque
				const store = clientStore.getState();
				player.trailsOn = buildTrailsOn(selectDisplay(store).buildFx, selectJuice(store).reducedMotion);
				player.frame(
					state.combat.playerBullets,
					alpha,
					n > 1 ? (emitter) => playerBulletTransparency(n, emitter, me) : undefined,
				);
				debug.profileend();
			},
		);
	}

	/** Pooled bullet parts (enemy, player). */
	getPoolSizes(): [number, number] {
		return [this.enemy?.poolSize() ?? 0, this.player?.poolSize() ?? 0];
	}

	/** Pooled goo decal parts (0 with the decal look off). */
	getGooPoolSize(): number {
		return this.goo?.poolSize() ?? 0;
	}

	/** Pooled strike flash parts (0 with the strike decal off; docs/NEW_ENEMIES.md NE8). */
	getStrikePoolSize(): number {
		return this.strike?.poolSize() ?? 0;
	}

	/** Pooled ember decal parts and burst / shard trail parts (docs/BUILDS.md BU8). */
	getBuildPoolSizes(): [number, number] {
		return [this.ember?.poolSize() ?? 0, this.player?.trailPoolSize() ?? 0];
	}
}

function subFolder(parent: Folder, name: string): Folder {
	const f = new Instance("Folder");
	f.Name = name;
	f.Parent = parent;
	return f;
}
