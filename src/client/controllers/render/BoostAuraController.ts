import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { RunService, Workspace } from "@rbxts/services";
import { STUDS_PER_TILE } from "shared/config";
import { SIM_HZ, activeBoosts, partySize, playerAt, type ActiveBoost } from "shared/sim";
import { BOOST_KINDS, boostAuraFxId } from "shared/theme";
import { BULLET_ART_VIEW, BULLET_VIEW, RENDER_ORDER, ReadyIds, floorStudsY, lerp, studsX, studsZ } from "shared/view";
import {
	BOOST_VIEW,
	auraArtFrame,
	auraArtPlacement,
	auraArtStudsPerPixel,
	auraArtTransparency,
	auraDisc,
	auraTransparency,
} from "shared/view/boosts";
import { motionScale } from "shared/view/fx";
import { PreloadController } from "../game/PreloadController";
import { SimController } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import { FxTrackerController } from "../fx/FxTrackerController";
import { FLOOR_CANVAS_YAW, floorCanvasPartSize } from "./floorCanvas";
import { renderPart } from "./placeholders";
import { createSpriteAnchor } from "./SpriteBulletPool";

const PARKED = new CFrame(BULLET_VIEW.parkedStuds[0], BULLET_VIEW.parkedStuds[1], BULLET_VIEW.parkedStuds[2]);
/** A Cylinder's axis is X: turn it upright (a flat disc). */
const UPRIGHT = CFrame.Angles(0, 0, math.pi / 2);
const DIAMETER = 2;
const NONE = -1;

/** One rank of a kind's aura art, resolved once: its loop's cells (ImageRectOffset per frame) and ring. */
interface RankArt {
	readonly offsets: ReadonlyArray<Vector2>;
	readonly fps: number;
	readonly ringPx: number;
}

/** A kind's aura art (docs/BOOST_ART.md BAD3), resolved once from ThemePack.fx(fx.boost.aura.<kind>).ranks. */
interface KindArt {
	readonly image: string;
	readonly cellSize: Vector2;
	readonly canvas: Vector2;
	readonly resample: Enum.ResamplerMode;
	readonly frameW: number;
	readonly frameH: number;
	readonly pivotX: number;
	readonly pivotY: number;
	readonly ranks: ReadonlyArray<RankArt>;
}

/** One pooled aura piece of a player's boost kind: a Neon disc, or a flat sprite anchor (its surface and label). */
interface Ring {
	readonly part: Part;
	readonly surface?: SurfaceGui;
	readonly label?: ImageLabel;
	/** As last written: the radius (tiles), the rank the sprite is sized / framed for, its frame, transparency. */
	radius: number;
	rank: number;
	frame: number;
	transparency: number;
	/** The cell centre's offset from the ring centre in the turned anchor's frame (sprites; undefined: none). */
	offset?: CFrame;
	parked: boolean;
}

/**
 * Boost auras (docs/BOOSTS.md B6; art: docs/BOOST_ART.md BAD3): under every party member (teammates too, so a
 * contested pickup reads on every client), one ring per running boost in the kind's `boost.<kind>` colour, concentric
 * (shared/view/boosts auraDisc: the first running kind in Boost order innermost and on top), the whole stack under
 * BOOST_VIEW.auraMaxHeightTiles above the floor, so it sits under the bullets' plane and never covers one.
 *
 * A kind whose `fx.boost.aura.<kind>` has art for the rank drawn (ThemePack.fx(...).ranks) is a flat sprite: an anchor
 * from SpriteBulletPool's builder (an invisible Part with a Top-face SurfaceGui, LightInfluence 0, a Pixelated
 * ImageLabel tinted by the role), turned by FLOOR_CANVAS_YAW (the art's up screen-up), its top face at the disc's top,
 * sized so the rank's ring lies exactly on the disc's radius (auraArtStudsPerPixel: the art is drawn per rank, never
 * scaled for the stack), its loop on sim time (auraArtFrame: the pulse's clock; reduced motion holds a frame), pulsing
 * like the discs (auraArtTransparency). Every other kind / rank is a flat Neon disc (auraTransparency). Pieces are
 * pooled per (player, kind), built on first use, parked far below (the sprite's surface disabled) when unused, and
 * moved in one workspace:BulkMoveTo per frame; Size, the cell and transparency are written only when they change. The
 * sim clears a player's boosts at death, so a dead player has none. Read-only on the sim.
 *
 * Stand-ins (docs/STAGE_ASSETS.md "Revision 2", SA17): a kind's art is drawn only once its `fx.boost.aura.<kind>` is
 * READY on this device (PreloadController's readiness, shared/view ReadyIds re-read when its epoch moves); until then
 * its Neon disc. The choice is per frame, and the piece not drawn is parked by the shown / seen swap, so a running aura
 * turns into its art on the frame it lands (and back under KV_StandInsForce).
 */
@Controller({})
export class BoostAuraController implements OnStart {
	private readonly janitor = new Janitor();
	/** discs[player][kind] / sprites[player][kind] (Boost index). */
	private readonly discs = new Array<Array<Ring | undefined>>();
	private readonly sprites = new Array<Array<Ring | undefined>>();
	private readonly colors = new Array<Color3>();
	/** art[kind]: the kind's aura art, or undefined (discs only). */
	private readonly art = new Array<KindArt | undefined>();
	/** artReady[kind] (SA17): built in onStart over the kinds with art. */
	private artReady: ReadyIds | undefined;
	private readonly active = new Array<ActiveBoost>();
	/** Pieces placed last frame and this frame (swapped every frame). */
	private shown = new Set<Ring>();
	private seen = new Set<Ring>();
	private readonly moveParts = new Array<BasePart>();
	private readonly moveCFrames = new Array<CFrame>();
	private folder: Folder | undefined;

	constructor(
		private readonly sim: SimController,
		private readonly theme: ThemeController,
		private readonly fx: FxTrackerController,
		private readonly preload: PreloadController,
	) {}

	onStart(): void {
		const pack = this.theme.getPack();
		BOOST_KINDS.forEach((k, kind) => {
			this.colors.push(pack.boost(k).color);
			const aura = pack.fx(boostAuraFxId(k));
			const ranks = aura?.ranks;
			if (aura === undefined || ranks === undefined || ranks.size() === 0) {
				this.art[kind] = undefined;
				return;
			}
			const set = aura.set;
			const resolved = new Array<RankArt>();
			for (const r of ranks) {
				const offsets = new Array<Vector2>();
				for (let f = 0; f < r.frames; f++) offsets.push(r.frame(f).offset);
				resolved.push({ offsets, fps: r.fps, ringPx: r.ringPx });
			}
			this.art[kind] = {
				image: ranks[0].frame(0).image,
				cellSize: new Vector2(set.frameW, set.frameH),
				canvas: new Vector2(set.frameW, set.frameH).mul(BULLET_ART_VIEW.canvasPixelsPerArtPixel),
				resample: Enum.ResamplerMode[set.resample],
				frameW: set.frameW,
				frameH: set.frameH,
				pivotX: set.pivot.x,
				pivotY: set.pivot.y,
				ranks: resolved,
			};
		});
		this.artReady = new ReadyIds(
			BOOST_KINDS.map((k, kind) => (this.art[kind] !== undefined ? boostAuraFxId(k) : undefined)),
		);
		const folder = new Instance("Folder");
		folder.Name = BOOST_VIEW.auraFolderName;
		folder.Parent = Workspace;
		this.folder = this.janitor.Add(folder);
		RunService.BindToRenderStep(
			BOOST_VIEW.auraRenderStep,
			Enum.RenderPriority.Camera.Value + RENDER_ORDER.viewsAfterCamera,
			() => this.frame(),
		);
		this.janitor.Add(() => RunService.UnbindFromRenderStep(BOOST_VIEW.auraRenderStep), true);
	}

	private frame(): void {
		this.moveParts.clear();
		this.moveCFrames.clear();
		const state = this.sim.getState();
		const seen = this.seen;
		seen.clear();
		const artReady = this.artReady;
		artReady?.refresh(this.preload.getReadiness());
		if (state !== undefined && state.drops !== undefined) {
			const alpha = this.sim.getAlpha();
			const simSec = (state.tick + alpha) / SIM_HZ;
			const motion = motionScale(this.fx.settings());
			const discAlpha = auraTransparency(simSec, motion);
			const artAlpha = auraArtTransparency(simSec, motion);
			const floorY = floorStudsY();
			const n = partySize(state);
			for (let i = 0; i < n; i++) {
				activeBoosts(state, i, this.active);
				const count = this.active.size();
				if (count === 0) continue;
				const p = playerAt(state, i);
				const x = studsX(lerp(p.prevX, p.x, alpha));
				const z = studsZ(lerp(p.prevZ, p.z, alpha));
				for (let rank = 0; rank < count; rank++) {
					const kind = this.active[rank].kind;
					const d = auraDisc(rank, count);
					// SA17: the art only once it is ready; until then the disc (the stand-in)
					const art = artReady?.isReady(kind) === true ? this.art[kind] : undefined;
					const rankArt = art !== undefined ? art.ranks[rank] : undefined;
					let ring: Ring | undefined;
					let at: CFrame;
					if (art !== undefined && rankArt !== undefined) {
						ring = this.sprite(i, kind, art);
						if (ring === undefined) continue;
						this.placeSprite(ring, art, rankArt, rank, d.radiusTiles);
						const frame = auraArtFrame(simSec, rankArt.fps, rankArt.offsets.size(), motion);
						if (ring.frame !== frame) {
							ring.frame = frame;
							ring.label!.ImageRectOffset = rankArt.offsets[frame];
						}
						if (ring.transparency !== artAlpha) {
							ring.transparency = artAlpha;
							ring.label!.ImageTransparency = artAlpha;
						}
						if (ring.parked) ring.surface!.Enabled = true;
						const base = new CFrame(x, floorY + d.liftStuds, z).mul(FLOOR_CANVAS_YAW);
						at = ring.offset !== undefined ? base.mul(ring.offset) : base;
					} else {
						ring = this.disc(i, kind);
						if (ring === undefined) continue;
						if (ring.radius !== d.radiusTiles) {
							ring.radius = d.radiusTiles;
							const size = d.radiusTiles * DIAMETER * STUDS_PER_TILE;
							ring.part.Size = new Vector3(BOOST_VIEW.auraThicknessStuds, size, size);
						}
						if (ring.transparency !== discAlpha) {
							ring.transparency = discAlpha;
							ring.part.Transparency = discAlpha;
						}
						at = new CFrame(x, floorY + d.liftStuds, z).mul(UPRIGHT);
					}
					ring.parked = false;
					seen.add(ring);
					this.moveParts.push(ring.part);
					this.moveCFrames.push(at);
				}
			}
		}
		for (const ring of this.shown) {
			if (seen.has(ring) || ring.parked) continue;
			ring.parked = true;
			if (ring.surface !== undefined) ring.surface.Enabled = false;
			this.moveParts.push(ring.part);
			this.moveCFrames.push(PARKED);
		}
		this.seen = this.shown;
		this.shown = seen;
		if (this.moveParts.size() > 0) {
			Workspace.BulkMoveTo(this.moveParts, this.moveCFrames, Enum.BulkMoveMode.FireCFrameChanged);
		}
	}

	/**
	 * Sizes sprite `ring` for `rank` (its ring on the disc's `radiusTiles`) when the rank or radius changed: the anchor's
	 * Size and the cell centre's offset (none for a centred pivot); a new rank also forces its cell to be rewritten.
	 */
	private placeSprite(ring: Ring, art: KindArt, rankArt: RankArt, rank: number, radiusTiles: number): void {
		if (ring.rank === rank && ring.radius === radiusTiles) return;
		ring.rank = rank;
		ring.radius = radiusTiles;
		ring.frame = NONE;
		const spp = auraArtStudsPerPixel(radiusTiles, rankArt.ringPx);
		const p = auraArtPlacement(art.frameW, art.frameH, art.pivotX, art.pivotY, spp);
		ring.part.Size = floorCanvasPartSize(p.widthStuds, BOOST_VIEW.auraThicknessStuds, p.depthStuds);
		// The turned anchor's local x runs screen-down, its z screen-left (floorCanvas.ts).
		ring.offset = p.rightStuds !== 0 || p.downStuds !== 0 ? new CFrame(p.downStuds, 0, -p.rightStuds) : undefined;
	}

	/** Player `player`'s disc for Boost `kind`, built on first use (undefined for an unknown kind). */
	private disc(player: number, kind: number): Ring | undefined {
		const color = this.colors[kind];
		if (color === undefined) return undefined;
		const row = this.row(this.discs, player);
		let disc = row[kind];
		if (disc === undefined) {
			const part = renderPart("Part", false);
			part.Name = `Aura${player}.${BOOST_KINDS[kind]}`;
			part.Shape = Enum.PartType.Cylinder;
			part.Material = Enum.Material[BOOST_VIEW.auraMaterial];
			part.Color = color;
			part.CFrame = PARKED;
			part.Parent = this.folder;
			this.janitor.Add(part);
			disc = { part, radius: NONE, rank: NONE, frame: NONE, transparency: NONE, parked: true };
			row[kind] = disc;
		}
		return disc;
	}

	/** Player `player`'s sprite anchor for Boost `kind` (which has `art`), built on first use. */
	private sprite(player: number, kind: number, art: KindArt): Ring | undefined {
		const color = this.colors[kind];
		if (color === undefined) return undefined;
		const row = this.row(this.sprites, player);
		let ring = row[kind];
		if (ring === undefined) {
			const { part, surface, label } = createSpriteAnchor(`AuraArt${player}.${BOOST_KINDS[kind]}`, PARKED);
			surface.CanvasSize = art.canvas;
			label.Image = art.image;
			label.ImageRectSize = art.cellSize;
			label.ResampleMode = art.resample;
			label.ImageColor3 = color;
			part.Parent = this.folder;
			this.janitor.Add(part);
			ring = { part, surface, label, radius: NONE, rank: NONE, frame: NONE, transparency: NONE, parked: true };
			row[kind] = ring;
		}
		return ring;
	}

	private row(rows: Array<Array<Ring | undefined>>, player: number): Array<Ring | undefined> {
		let row = rows[player];
		if (row === undefined) {
			row = [];
			rows[player] = row;
		}
		return row;
	}
}
