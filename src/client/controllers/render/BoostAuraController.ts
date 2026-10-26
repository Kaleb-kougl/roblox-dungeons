import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { RunService, Workspace } from "@rbxts/services";
import { STUDS_PER_TILE } from "shared/config";
import { SIM_HZ, activeBoosts, partySize, playerAt, type ActiveBoost } from "shared/sim";
import { BOOST_KINDS } from "shared/theme";
import { BULLET_VIEW, RENDER_ORDER, floorStudsY, lerp, studsX, studsZ } from "shared/view";
import { BOOST_VIEW, auraDisc, auraTransparency } from "shared/view/boosts";
import { motionScale } from "shared/view/fx";
import { SimController } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import { FxTrackerController } from "../fx/FxTrackerController";
import { renderPart } from "./placeholders";

const PARKED = new CFrame(BULLET_VIEW.parkedStuds[0], BULLET_VIEW.parkedStuds[1], BULLET_VIEW.parkedStuds[2]);
/** A Cylinder's axis is X: turn it upright (a flat disc). */
const UPRIGHT = CFrame.Angles(0, 0, math.pi / 2);
const DIAMETER = 2;

/** One pooled disc: a player's aura for one boost kind. */
interface Disc {
	readonly part: Part;
	/** Radius (tiles) and transparency as last written. */
	radius: number;
	transparency: number;
	parked: boolean;
}

/**
 * Boost auras (docs/BOOSTS.md B6): under every party member (teammates too, so a contested pickup reads on every
 * client), one flat tinted disc per running boost in the kind's `boost.<kind>` colour, concentric (shared/view/boosts
 * auraDisc: the first running kind in Boost order innermost and on top), the whole stack under
 * BOOST_VIEW.auraMaxHeightTiles above the floor, so it sits under the bullets' plane and never covers one. The discs
 * pulse in transparency by the juice motionScale (steady under reduced motion). The sim clears a player's boosts at
 * death, so a dead player has none. Discs are pooled per (player, kind), built on first use, parked far below when
 * unused, and moved in one workspace:BulkMoveTo per frame. Read-only on the sim.
 */
@Controller({})
export class BoostAuraController implements OnStart {
	private readonly janitor = new Janitor();
	/** discs[player][kind] (Boost index). */
	private readonly discs = new Array<Array<Disc | undefined>>();
	private readonly colors = new Array<Color3>();
	private readonly active = new Array<ActiveBoost>();
	/** Discs placed last frame and this frame (swapped every frame). */
	private shown = new Set<Disc>();
	private seen = new Set<Disc>();
	private readonly moveParts = new Array<BasePart>();
	private readonly moveCFrames = new Array<CFrame>();
	private folder: Folder | undefined;

	constructor(
		private readonly sim: SimController,
		private readonly theme: ThemeController,
		private readonly fx: FxTrackerController,
	) {}

	onStart(): void {
		const pack = this.theme.getPack();
		for (const k of BOOST_KINDS) this.colors.push(pack.boost(k).color);
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
		if (state !== undefined && state.drops !== undefined) {
			const alpha = this.sim.getAlpha();
			const simSec = (state.tick + alpha) / SIM_HZ;
			const transparency = auraTransparency(simSec, motionScale(this.fx.settings()));
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
					const disc = this.disc(i, kind);
					if (disc === undefined) continue;
					const d = auraDisc(rank, count);
					if (disc.radius !== d.radiusTiles) {
						disc.radius = d.radiusTiles;
						const size = d.radiusTiles * DIAMETER * STUDS_PER_TILE;
						disc.part.Size = new Vector3(BOOST_VIEW.auraThicknessStuds, size, size);
					}
					if (disc.transparency !== transparency) {
						disc.transparency = transparency;
						disc.part.Transparency = transparency;
					}
					disc.parked = false;
					seen.add(disc);
					this.moveParts.push(disc.part);
					this.moveCFrames.push(new CFrame(x, floorY + d.liftStuds, z).mul(UPRIGHT));
				}
			}
		}
		for (const disc of this.shown) {
			if (seen.has(disc) || disc.parked) continue;
			disc.parked = true;
			this.moveParts.push(disc.part);
			this.moveCFrames.push(PARKED);
		}
		this.seen = this.shown;
		this.shown = seen;
		if (this.moveParts.size() > 0) {
			Workspace.BulkMoveTo(this.moveParts, this.moveCFrames, Enum.BulkMoveMode.FireCFrameChanged);
		}
	}

	/** Player `player`'s disc for Boost `kind`, built on first use (undefined for an unknown kind). */
	private disc(player: number, kind: number): Disc | undefined {
		const color = this.colors[kind];
		if (color === undefined) return undefined;
		let row = this.discs[player];
		if (row === undefined) {
			row = [];
			this.discs[player] = row;
		}
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
			disc = { part, radius: -1, transparency: -1, parked: true };
			row[kind] = disc;
		}
		return disc;
	}
}
