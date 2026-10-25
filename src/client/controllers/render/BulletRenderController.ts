import { Controller, OnStart } from "@flamework/core";
import { RunService, Workspace } from "@rbxts/services";
import { STUDS_PER_TILE } from "shared/config";
import { partySize, type BulletSimulation, type Vec3 as SimVec3 } from "shared/sim";
import type { PlaceholderVisual, ThemePack } from "shared/theme";
import { BULLET_VIEW, RENDER_ORDER, lerp, playerBulletTransparency, studsX, studsY, studsZ } from "shared/view";
import { SimController } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import { renderPart } from "./placeholders";

const RENDER_STEP = "KV_Bullets";
const PARKED = new CFrame(BULLET_VIEW.parkedStuds[0], BULLET_VIEW.parkedStuds[1], BULLET_VIEW.parkedStuds[2]);

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
 * workspace:BulkMoveTo (spike A). The pool grows lazily to the simulation's high-water mark.
 */
class BulletPool {
	private readonly parts = new Array<BasePart>();
	private readonly shown = new Array<boolean>();
	/** Quantized drawn size per part (BULLET_VIEW.sizeQuantum steps); -1 = never set. */
	private readonly sizeKey = new Array<number>();
	private readonly heavyKey = new Array<boolean>();
	/** Last transparency written per part (co-op: teammates' bullets in large parties). */
	private readonly alphaKey = new Array<number>();
	private readonly moveParts = new Array<BasePart>();
	private readonly moveCFrames = new Array<CFrame>();
	private readonly prev: SimVec3 = { x: 0, y: 0, z: 0 };
	private sim: BulletSimulation | undefined;

	constructor(
		private readonly folder: Folder,
		private readonly name: string,
		private readonly look: BulletLook,
		private readonly heavy: BulletLook | undefined,
		/** Turn the part along the velocity (player bolts); enemy balls are round. */
		private readonly orient: boolean,
	) {}

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
			if (i < n && sim.isVisible(i)) {
				const cur = sim.positionAt(i);
				sim.previousPositionAt(i, prev);
				const x = studsX(lerp(prev.x, cur.x, alpha));
				const y = studsY(lerp(prev.y, cur.y, alpha));
				const z = studsZ(lerp(prev.z, cur.z, alpha));
				this.resize(i, sim.scaleAt(i), sim.fadeAt(i));
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
			} else if (this.shown[i]) {
				this.moveParts.push(part);
				this.moveCFrames.push(PARKED);
				this.shown[i] = false;
			}
		}
		if (this.moveParts.size() > 0) {
			Workspace.BulkMoveTo(this.moveParts, this.moveCFrames, Enum.BulkMoveMode.FireCFrameChanged);
		}
	}

	poolSize(): number {
		return this.parts.size();
	}

	private parkAll(): void {
		this.moveParts.clear();
		this.moveCFrames.clear();
		for (let i = 0; i < this.parts.size(); i++) {
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
		const look = this.look;
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
		this.heavyKey.push(false);
		this.alphaKey.push(0);
	}

	/** Writes Size only when the quantized drawn size (scale x end-of-life fade) or the heavy look changes. */
	private resize(i: number, scale: number, fade: number): void {
		const heavy = this.heavy !== undefined && scale > BULLET_VIEW.heavyScaleThreshold;
		const look = heavy ? this.heavy! : this.look;
		const q = BULLET_VIEW.sizeQuantum;
		const key = math.max(q, math.round((scale * fade) / q) * q);
		if (key === this.sizeKey[i] && heavy === this.heavyKey[i]) return;
		this.sizeKey[i] = key;
		const part = this.parts[i];
		if (heavy !== this.heavyKey[i]) {
			this.heavyKey[i] = heavy;
			part.Color = look.color;
			part.Material = look.material;
		}
		const [sx, sy, sz] = look.visual.size;
		const k = look.baseScale * key;
		part.Size = new Vector3(sx * k, sy * k, sz * k);
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

/**
 * Draws both bullet simulations (web BulletsView): enemy bullets as neon balls of BULLET_VIEW.enemyDrawRadius, player
 * bullets as bolts along their velocity (BULLET_VIEW.playerDrawHalfLength; heavy arrows use the heavy placeholder),
 * each scaled by the bullet's draw scale and its end-of-life fade. Theme placeholders and colour roles only.
 * Outlines (the theme's *BulletOutline roles) are not drawn yet: a Highlight per bullet is far over budget.
 * Co-op (M4): in a large party a teammate's bolts draw at TEAMMATE_BULLET_OPACITY (shared/view party.ts).
 */
@Controller({})
export class BulletRenderController implements OnStart {
	private enemy: BulletPool | undefined;
	private player: BulletPool | undefined;

	constructor(private readonly sim: SimController, private readonly theme: ThemeController) {}

	onStart(): void {
		const pack = this.theme.getPack();
		const folder = new Instance("Folder");
		folder.Name = BULLET_VIEW.folderName;
		folder.Parent = Workspace;
		const S = STUDS_PER_TILE;
		const enemyDiameter = 2 * BULLET_VIEW.enemyDrawRadius * S;
		const playerLength = 2 * BULLET_VIEW.playerDrawHalfLength * S;
		const enemy = new BulletPool(
			folder,
			"EnemyBullet",
			bulletLook(pack, BULLET_VIEW.enemyVisualId, enemyDiameter, 0),
			undefined,
			false,
		);
		const player = new BulletPool(
			folder,
			"PlayerBullet",
			bulletLook(pack, BULLET_VIEW.playerVisualId, playerLength, 2),
			bulletLook(pack, BULLET_VIEW.heavyVisualId, playerLength, 2),
			true,
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
				const n = partySize(state);
				const me = this.sim.getLocalPlayerIndex();
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
}
