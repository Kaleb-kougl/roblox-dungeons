import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { RunService, Workspace } from "@rbxts/services";
import { STUDS_PER_TILE } from "shared/config";
import { NO_KIND, SIM_HZ, hookedPlayerOf, partySize, simWorldConfig, type ActorState, type SimState } from "shared/sim";
import { DECOR_FX_TINT, type ThemePack } from "shared/theme";
import {
	BELLY_VIEW,
	BULLET_VIEW,
	CHAIN_VIEW,
	DIZZY_VIEW,
	GUARD_VIEW,
	PYRE_FLAME_VIEW,
	RENDER_ORDER,
	TORCH_VIEW,
	ChainTarget,
	bellyPipSegments,
	bellyPips,
	bellyPulse,
	bulwarkGuarding,
	chainSegments,
	chainTarget,
	dizzyStarSegments,
	floorStudsY,
	guardArcSegments,
	hookBulletSlot,
	lerp,
	newTorchPoint,
	pyreFlameScale,
	snatcherSwallowing,
	staggerMarked,
	studsX,
	studsZ,
	torchArcPoint,
} from "shared/view";
import { motionScale } from "shared/view/fx";
import { BulletAhead, newAheadPose } from "shared/view/predict";
import { FxTrackerController } from "../fx/FxTrackerController";
import { SimController } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import { DashLayer } from "./DashLayer";
import { renderPart } from "./placeholders";

const RENDER_STEP = "KV_NewEnemy2Marks";
const PARKED = new CFrame(BULLET_VIEW.parkedStuds[0], BULLET_VIEW.parkedStuds[1], BULLET_VIEW.parkedStuds[2]);

/** A pooled flame (the torch in flight, a pyre's fire): a Neon cube, with a PointLight for a pyre's. */
interface Flame {
	readonly part: Part;
	readonly light: PointLight | undefined;
	size: number;
	shown: boolean;
}

/**
 * Floor marks and flames of the third endless set (docs/NEW_ENEMIES_2.md NX7; rules in shared/view newEnemies2.ts),
 * from sim state only (placeholder looks; NX8 brings the art):
 *   - the Shieldwall's guard arc: a faint dashed arc of its front cone in `enemyGuard` in front of every guarding one
 *     (GUARD_VIEW), and the stagger stars (DIZZY_VIEW's, as the Charger's stun) while its guard is broken.
 *   - the Chainhook's chain: a dashed run of small parts in enemyOutline from its hand to its HOOK bullet in flight (the
 *     bullet drawn ahead as BulletRenderController draws it while the knight is predicted) or to the player it drags
 *     (as drawn: merged while hooked). The snap is ParticleController's.
 *   - the Snatcher's belly: up to five pips in pellet.normal round it for what it carries, pulsing while it swallows.
 *   - the Pyre-keeper's torch: a small flame flying over the light telegraph's last part to the landing cell, and every
 *     pyre's flame (growing while it lights, flickering once lit; steady under reduced motion) with a PointLight, both
 *     in DECOR_FX_TINT.flame: the decor brazier's look in placeholder terms (PYRE_FLAME_VIEW.pool flames at most).
 * One DashLayer per mark (pooled fixed-size Parts, one BulkMoveTo per frame); flames are pooled Parts moved in one
 * BulkMoveTo. A corpse loses all of them the frame it dies.
 */
@Controller({})
export class NewEnemy2MarksController implements OnStart {
	private readonly janitor = new Janitor();
	private readonly torch = newTorchPoint();
	private readonly ahead = new BulletAhead();
	private readonly pose = newAheadPose();
	private readonly flames = new Array<Flame>();
	private readonly torches = new Array<Flame>();
	private readonly moveParts = new Array<BasePart>();
	private readonly moveCFrames = new Array<CFrame>();
	private folder: Folder | undefined;
	private flameColor = new Color3();

	constructor(
		private readonly sim: SimController,
		private readonly theme: ThemeController,
		private readonly fx: FxTrackerController,
	) {}

	onStart(): void {
		const pack = this.theme.getPack();
		const folder = this.janitor.Add(new Instance("Folder"));
		folder.Name = GUARD_VIEW.folderName;
		folder.Parent = Workspace;
		this.folder = folder;
		this.flameColor = pack.color(DECOR_FX_TINT.flame);
		const guard = dashLayer(folder, "GuardArc", pack, GUARD_VIEW.dash, GUARD_VIEW);
		const chain = dashLayer(folder, "Chain", pack, CHAIN_VIEW.dash, CHAIN_VIEW);
		const pip = BELLY_VIEW.dash;
		const pipStuds = BELLY_VIEW.pipTiles * STUDS_PER_TILE;
		const belly = dashLayer(folder, "BellyPips", pack, { ...pip, length: pipStuds, gap: 0 }, BELLY_VIEW);
		const star = DIZZY_VIEW.dash;
		const stars = new DashLayer(folder, "StaggerStars", {
			width: star.width,
			height: star.height,
			length: DIZZY_VIEW.starTiles * STUDS_PER_TILE,
			gap: 0,
			color: pack.color(DIZZY_VIEW.role),
			material: Enum.Material.Neon,
			transparency: DIZZY_VIEW.transparency,
			liftStuds: DIZZY_VIEW.liftStuds,
		});
		const layers = [guard, chain, belly, stars];
		RunService.BindToRenderStep(
			RENDER_STEP,
			Enum.RenderPriority.Camera.Value + RENDER_ORDER.viewsAfterCamera,
			() => {
				for (const l of layers) l.begin();
				this.moveParts.clear();
				this.moveCFrames.clear();
				const used = this.draw(guard, chain, belly, stars);
				for (const l of layers) l.finish();
				this.parkFrom(this.flames, used.flames);
				this.parkFrom(this.torches, used.torches);
				if (this.moveParts.size() > 0) {
					Workspace.BulkMoveTo(this.moveParts, this.moveCFrames, Enum.BulkMoveMode.FireCFrameChanged);
				}
			},
		);
		this.janitor.Add(() => RunService.UnbindFromRenderStep(RENDER_STEP), true);
	}

	private draw(
		guard: DashLayer,
		chain: DashLayer,
		belly: DashLayer,
		stars: DashLayer,
	): { flames: number; torches: number } {
		const used = { flames: 0, torches: 0 };
		const state = this.sim.getState();
		if (state === undefined) return used;
		const alpha = this.sim.getAlpha();
		const simSec = (state.tick + alpha) / SIM_HZ;
		const motion = motionScale(this.fx.settings());
		const ahead = this.prepareAhead(state);
		const actors = state.combat.actors;
		for (let i = 0; i < actors.size(); i++) {
			const a = actors[i];
			if (a.kind === NO_KIND || a.alive === 0) continue;
			const x = lerp(a.prevX, a.x, alpha);
			const z = lerp(a.prevZ, a.z, alpha);
			if (bulwarkGuarding(a)) guardArcSegments(guard, x, z, a.faceX, a.faceZ, a.radius);
			else if (staggerMarked(a)) dizzyStarSegments(stars, x, z, a.radius, simSec);
			this.drawChain(chain, state, a, x, z, alpha, ahead);
			const pips = bellyPips(a);
			if (pips > 0)
				bellyPipSegments(belly, x, z, a.radius, pips, bellyPulse(snatcherSwallowing(a), simSec, motion));
			const torch = torchArcPoint(a, x, z, alpha, this.torch);
			if (torch.shown) {
				this.placeFlame(
					this.torches,
					used.torches,
					torch.x,
					torch.heightTiles,
					torch.z,
					TORCH_VIEW.sizeStuds,
					1,
				);
				used.torches++;
			}
			const flame = pyreFlameScale(a, alpha, simSec, motion);
			if (flame > 0 && used.flames < PYRE_FLAME_VIEW.pool) {
				const V = PYRE_FLAME_VIEW;
				this.placeFlame(this.flames, used.flames, x, V.heightTiles, z, V.sizeStuds * flame, flame);
				used.flames++;
			}
		}
		return used;
	}

	/** The frame's enemy bullets drawn ahead with the knight (docs/LOCAL_PREDICTION.md LP10), or undefined. */
	private prepareAhead(state: Readonly<SimState>): BulletAhead | undefined {
		const ticks = this.sim.getPredictionAheadTicks();
		const ctx = this.sim.getContext();
		if (ticks <= 0 || ctx === undefined) return undefined;
		this.ahead.prepare(state, simWorldConfig(state, ctx.config), ticks);
		return this.ahead.ticks > 0 ? this.ahead : undefined;
	}

	/** The Chainhook `a`'s chain this frame: to its hook in flight, or to the player it drags (as drawn). */
	private drawChain(
		sink: DashLayer,
		state: Readonly<SimState>,
		a: Readonly<ActorState>,
		x: number,
		z: number,
		alpha: number,
		ahead: BulletAhead | undefined,
	): void {
		const target = chainTarget(a);
		if (target === ChainTarget.HOOK) {
			const bullets = state.combat.enemyBullets;
			const slot = hookBulletSlot(bullets, a.emitterId);
			if (slot < 0) return;
			let tx: number;
			let tz: number;
			const pose = this.pose;
			if (ahead !== undefined) {
				if (!ahead.pose(bullets, slot, pose)) return;
				tx = lerp(pose.prevX, pose.x, alpha);
				tz = lerp(pose.prevZ, pose.z, alpha);
			} else {
				const cur = bullets.positionAt(slot);
				const prev = bullets.previousPositionAt(slot, { x: 0, y: 0, z: 0 });
				tx = lerp(prev.x, cur.x, alpha);
				tz = lerp(prev.z, cur.z, alpha);
			}
			chainSegments(sink, x, z, a.radius, tx, tz);
		} else if (target === ChainTarget.PLAYER) {
			const k = hookedPlayerOf(a);
			if (k < 0 || k >= partySize(state)) return;
			const p = this.sim.getDrawnPlayer(state, k);
			chainSegments(sink, x, z, a.radius, lerp(p.prevX, p.x, alpha), lerp(p.prevZ, p.z, alpha));
		}
	}

	/** Pool entry `i` of `pool` (created on first use) placed at sim (x, z), `heightTiles` up, `side` studs a side. */
	private placeFlame(
		pool: Flame[],
		i: number,
		x: number,
		heightTiles: number,
		z: number,
		side: number,
		brightness: number,
	): void {
		let f = pool[i];
		if (f === undefined) {
			f = this.newFlame(pool === this.flames);
			pool[i] = f;
		}
		const s = math.max(side, 0);
		if (math.abs(s - f.size) > BULLET_VIEW.sizeQuantum) {
			f.size = s;
			f.part.Size = new Vector3(s, s, s);
		}
		const light = f.light;
		if (light !== undefined) {
			light.Enabled = true;
			light.Brightness = PYRE_FLAME_VIEW.lightBrightness * math.clamp(brightness, 0, 1);
		}
		f.shown = true;
		this.moveParts.push(f.part);
		this.moveCFrames.push(new CFrame(studsX(x), floorStudsY() + heightTiles * STUDS_PER_TILE, studsZ(z)));
	}

	private newFlame(lit: boolean): Flame {
		const part = renderPart("Part", false);
		part.Name = lit ? "PyreFlame" : "Torch";
		part.Material = Enum.Material.Neon;
		part.Color = this.flameColor;
		part.CFrame = PARKED;
		part.Parent = this.folder;
		let light: PointLight | undefined;
		if (lit) {
			light = new Instance("PointLight");
			light.Color = this.flameColor;
			light.Range = PYRE_FLAME_VIEW.lightRangeTiles * STUDS_PER_TILE;
			light.Brightness = 0;
			light.Shadows = false;
			light.Enabled = false;
			light.Parent = part;
		}
		return { part, light, size: -1, shown: false };
	}

	/** Parks every flame of `pool` from index `from` on that was shown. */
	private parkFrom(pool: Flame[], from: number): void {
		for (let i = from; i < pool.size(); i++) {
			const f = pool[i];
			if (!f.shown) continue;
			f.shown = false;
			if (f.light !== undefined) f.light.Enabled = false;
			this.moveParts.push(f.part);
			this.moveCFrames.push(PARKED);
		}
	}
}

/** A dash layer (sizes in studs) in a role from the pack, Neon, at the view's transparency and lift. */
function dashLayer(
	folder: Instance,
	name: string,
	pack: ThemePack,
	dash: { readonly width: number; readonly height: number; readonly length: number; readonly gap: number },
	view: {
		readonly role: Parameters<ThemePack["color"]>[0];
		readonly transparency: number;
		readonly liftStuds: number;
	},
): DashLayer {
	return new DashLayer(folder, name, {
		width: dash.width,
		height: dash.height,
		length: dash.length,
		gap: dash.gap,
		color: pack.color(view.role),
		material: Enum.Material.Neon,
		transparency: view.transparency,
		liftStuds: view.liftStuds,
	});
}
