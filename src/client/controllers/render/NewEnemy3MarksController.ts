import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { RunService, Workspace } from "@rbxts/services";
import { STUDS_PER_TILE } from "shared/config";
import { NO_KIND, SIM_HZ, type SimState } from "shared/sim";
import type { ThemePack } from "shared/theme";
import {
	BULLET_VIEW,
	DIZZY_VIEW,
	HEAL_PLUS_VIEW,
	HEAL_TETHER_VIEW,
	HealPlusMarks,
	RENDER_ORDER,
	SHELL_ARC_VIEW,
	ShellArcs,
	dizzyStarSegments,
	floorStudsY,
	jackalStaggered,
	lerp,
	menderTetherAlly,
	newShellPoint,
	studsX,
	studsZ,
	tetherPulse,
	tetherSegments,
	tetherShare,
} from "shared/view";
import { screenUpHeading } from "shared/view/golden";
import { SimController } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import { DashLayer } from "./DashLayer";
import { renderPart } from "./placeholders";

const RENDER_STEP = "KV_NewEnemy3Marks";
const PARKED = new CFrame(BULLET_VIEW.parkedStuds[0], BULLET_VIEW.parkedStuds[1], BULLET_VIEW.parkedStuds[2]);

/**
 * Floor marks and the shell of the fourth endless set (docs/NEW_ENEMIES_3.md NT7; rules in shared/view newEnemies3.ts),
 * from sim state and the run view's NT7 feed (placeholder looks; NT8 brings the art):
 *   - the Mortar's shell in flight: a Neon ball (SHELL_ARC_VIEW, enemyBullet) on an arc from where it left the Mortar to
 *     the ring, over the flight (ShellArcs), a corpse's too (NTD5: the shell lands anyway). The ring is
 *     TelegraphController's hint (a corpse in flight included), the impact dust ParticleController's.
 *   - the Mender's heal tether: a dashed run in enemyHeal from its hands to the living ally of a live link or channel
 *     (menderTetherAlly), forming over the link (tetherShare), with a bright second run for pulseSec after each heal
 *     pulse (tetherPulse); the `+` over each healed enemy (HealPlusMarks, from the run view's heal positions). The snap
 *     and the heal sparks are ParticleController's.
 *   - the Jackal's stagger: DIZZY_VIEW's stars (the Charger's stun, the Shieldwall's stagger) while a guard has it
 *     reeling (NTD9).
 * One DashLayer per mark (pooled fixed-size Parts, one BulkMoveTo per frame); shells are pooled Parts moved in the same
 * BulkMoveTo. A dead Mender's tether, a dead ally's and a cut one vanish the frame the sim ends the link.
 */
@Controller({})
export class NewEnemy3MarksController implements OnStart {
	private readonly janitor = new Janitor();
	private readonly shellPoint = newShellPoint();
	private readonly arcs = new ShellArcs();
	private readonly pluses = new HealPlusMarks();
	private readonly shells = new Array<{ readonly part: Part; shown: boolean }>();
	private readonly moveParts = new Array<BasePart>();
	private readonly moveCFrames = new Array<CFrame>();
	private folder: Folder | undefined;
	private shellColor = new Color3();
	private lastState: Readonly<SimState> | undefined;
	private lastTick = 0;
	private lastFloor = 0;

	constructor(
		private readonly sim: SimController,
		private readonly theme: ThemeController,
	) {}

	onStart(): void {
		const pack = this.theme.getPack();
		const folder = this.janitor.Add(new Instance("Folder"));
		folder.Name = SHELL_ARC_VIEW.folderName;
		folder.Parent = Workspace;
		this.folder = folder;
		this.shellColor = pack.color(SHELL_ARC_VIEW.role);
		const T = HEAL_TETHER_VIEW;
		const tether = dashLayer(folder, "HealTether", pack, T.dash, T.role, T.transparency, T.liftStuds);
		const pulse = dashLayer(folder, "HealPulse", pack, T.dash, T.role, T.pulseTransparency, T.pulseLiftStuds);
		const P = HEAL_PLUS_VIEW;
		const plusDash = { ...P.dash, length: (P.fromTiles / 2) * STUDS_PER_TILE, gap: 0 };
		const plus = dashLayer(folder, "HealPlus", pack, plusDash, P.role, P.transparency, P.liftStuds);
		const star = DIZZY_VIEW.dash;
		const starDash = { ...star, length: DIZZY_VIEW.starTiles * STUDS_PER_TILE, gap: 0 };
		const stars = dashLayer(
			folder,
			"JackalStagger",
			pack,
			starDash,
			DIZZY_VIEW.role,
			DIZZY_VIEW.transparency,
			DIZZY_VIEW.liftStuds,
		);
		const layers = [tether, pulse, plus, stars];
		RunService.BindToRenderStep(
			RENDER_STEP,
			Enum.RenderPriority.Camera.Value + RENDER_ORDER.viewsAfterCamera,
			() => {
				for (const l of layers) l.begin();
				this.moveParts.clear();
				this.moveCFrames.clear();
				const used = this.draw(tether, pulse, plus, stars);
				for (const l of layers) l.finish();
				this.parkFrom(used);
				if (this.moveParts.size() > 0) {
					Workspace.BulkMoveTo(this.moveParts, this.moveCFrames, Enum.BulkMoveMode.FireCFrameChanged);
				}
			},
		);
		this.janitor.Add(() => RunService.UnbindFromRenderStep(RENDER_STEP), true);
	}

	/** Draws the frame's marks; returns how many shells it placed. */
	private draw(tether: DashLayer, pulse: DashLayer, plus: DashLayer, stars: DashLayer): number {
		const ctx = this.sim.getContext();
		if (ctx === undefined) return 0;
		const state = ctx.run.state;
		const floor = state.endless?.floor ?? 0;
		if (state !== this.lastState || state.tick < this.lastTick || floor !== this.lastFloor) {
			this.arcs.reset();
			this.pluses.reset();
		}
		this.lastState = state;
		this.lastTick = state.tick;
		this.lastFloor = floor;
		const alpha = this.sim.getAlpha();
		const simSec = (state.tick + alpha) / SIM_HZ;
		const heals = ctx.run.newEnemies3;
		for (let i = 0; i < heals.healX.size(); i++) this.pluses.push(heals.healX[i], heals.healZ[i], simSec);
		const actors = state.combat.actors;
		let shells = 0;
		for (let i = 0; i < actors.size(); i++) {
			const a = actors[i];
			if (a.kind === NO_KIND) continue;
			const x = lerp(a.prevX, a.x, alpha);
			const z = lerp(a.prevZ, a.z, alpha);
			const shell = this.arcs.point(i, a, x, z, alpha, this.shellPoint);
			if (shell.shown && shells < SHELL_ARC_VIEW.pool) {
				this.placeShell(shells, shell.x, shell.heightTiles, shell.z);
				shells++;
			}
			if (a.alive === 0) continue;
			const ally = menderTetherAlly(actors, a);
			if (ally !== undefined) {
				const ax = lerp(ally.prevX, ally.x, alpha);
				const az = lerp(ally.prevZ, ally.z, alpha);
				const share = tetherShare(a, alpha);
				tetherSegments(tether, x, z, a.radius, ax, az, ally.radius, share);
				if (tetherPulse(a, alpha) > 0) tetherSegments(pulse, x, z, a.radius, ax, az, ally.radius, share);
			}
			if (jackalStaggered(a)) dizzyStarSegments(stars, x, z, a.radius, simSec);
		}
		const up = screenUpHeading();
		this.pluses.segments(plus, simSec, math.sin(up), math.cos(up));
		return shells;
	}

	private placeShell(i: number, x: number, heightTiles: number, z: number): void {
		let s = this.shells[i];
		if (s === undefined) {
			const part = renderPart("Part", false);
			part.Name = "MortarShell";
			part.Shape = Enum.PartType.Ball;
			part.Material = Enum.Material.Neon;
			part.Color = this.shellColor;
			const d = SHELL_ARC_VIEW.sizeStuds;
			part.Size = new Vector3(d, d, d);
			part.CFrame = PARKED;
			part.Parent = this.folder;
			s = { part, shown: false };
			this.shells[i] = s;
		}
		s.shown = true;
		this.moveParts.push(s.part);
		this.moveCFrames.push(new CFrame(studsX(x), floorStudsY() + heightTiles * STUDS_PER_TILE, studsZ(z)));
	}

	/** Parks every shell from index `from` on that was shown. */
	private parkFrom(from: number): void {
		for (let i = from; i < this.shells.size(); i++) {
			const s = this.shells[i];
			if (!s.shown) continue;
			s.shown = false;
			this.moveParts.push(s.part);
			this.moveCFrames.push(PARKED);
		}
	}
}

/** A dash layer (sizes in studs) in a role from the pack, Neon, at the given transparency and lift. */
function dashLayer(
	folder: Instance,
	name: string,
	pack: ThemePack,
	dash: { readonly width: number; readonly height: number; readonly length: number; readonly gap: number },
	role: Parameters<ThemePack["color"]>[0],
	transparency: number,
	liftStuds: number,
): DashLayer {
	return new DashLayer(folder, name, {
		width: dash.width,
		height: dash.height,
		length: dash.length,
		gap: dash.gap,
		color: pack.color(role),
		material: Enum.Material.Neon,
		transparency,
		liftStuds,
	});
}
