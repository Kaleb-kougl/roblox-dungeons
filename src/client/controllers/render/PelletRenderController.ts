import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { RunService, Workspace } from "@rbxts/services";
import { DEV_MONO_FONT, createKvBillboardGui } from "client/ui";
import { RUN_ATTRIBUTES } from "shared/play";
import { PelletPhase, SIM_HZ, partySize, type SimState } from "shared/sim";
import { PELLET_KINDS, type Pellet, type PelletKind, type ThemePack } from "shared/theme";
import {
	BULLET_VIEW,
	RENDER_ORDER,
	ReadinessCursor,
	SPRITE_VIEW,
	floorStudsY,
	lookWhenReady,
	studsX,
	studsZ,
} from "shared/view";
import { motionScale } from "shared/view/fx";
import {
	PELLETS_VIEW,
	PelletViewTracker,
	newPelletLook,
	pelletDebugText,
	pelletPowerFreezeMs,
	type PelletLook,
} from "shared/view/pellets";
import { ParticleController } from "../fx/ParticleController";
import { FxTrackerController } from "../fx/FxTrackerController";
import { PreloadController } from "../game/PreloadController";
import { SimController } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import { buildFloorArt, visualLayout, widthLayout } from "./decorParts";
import {
	buildPlaceholder,
	destroyModel,
	renderPart,
	setModelColor,
	setModelTransparency,
	type PlaceholderModel,
} from "./placeholders";

const PARKED = new CFrame(BULLET_VIEW.parkedStuds[0], BULLET_VIEW.parkedStuds[1], BULLET_VIEW.parkedStuds[2]);
const HIDDEN = 1;
/** Floor art is a thin slab (studs): its SurfaceGui draws on the top face. */
const ART_THICKNESS = 0.02;
const NORMAL = 0;
const POWER = 1;
/** Undoes the placeholder lift for the art (its own lift is in its floor frame). */
const UNLIFT = new Vector3(0, -PELLETS_VIEW.liftStuds, 0);

/** One pooled pellet body: the placeholder cube (model) or the art laid flat on the floor (part + label). */
interface PelletBody {
	readonly kind: number;
	/** Built from the kind's art look (docs/STAGE_ASSETS.md SA18): a body of the other look is discarded, never reused. */
	readonly withArt: boolean;
	readonly model: PlaceholderModel | undefined;
	/** The model's pieces at full size (the pop-in / pulse / shrink scale them). */
	readonly sizes: ReadonlyArray<Vector3>;
	readonly art:
		| { readonly part: Part; readonly label: ImageLabel; readonly size: Vector3; readonly rel: CFrame }
		| undefined;
	scale: number;
	transparency: number;
	glow: number;
}

interface PelletView {
	/** Replaced when the kind's art readiness flips (swapLooks). */
	body: PelletBody;
	/** The floor point under the pellet lifted by PELLETS_VIEW.liftStuds (the placeholder's base; the art undoes it). */
	readonly lifted: CFrame;
	/** Placed at its spot since it was attached (false: the next apply moves it whatever its scale). */
	placed: boolean;
}

/**
 * Pellets on the floor (docs/PELLETS.md PL7), drawn from `state.pellets` (runs with SimConfig.pellets, nothing
 * otherwise). Once per rendered frame (after the camera, like every view) the pure PelletViewTracker (shared/view/pellets)
 * takes the frame's pellet events (`RunView.pellets`: live / gone times, a new floor) and gives each pellet its look:
 *
 *   dormant room   nothing (its pellets cannot be taken yet)
 *   live room      a body per untaken pellet: the pop-in wave from the room's centre on the engagement tick, the
 *                  last-few pulse (PELLETS_VIEW.lastFewHint or fewer left: brighter toward glowRole, a little larger),
 *                  the power pellet's slow pulse; no bob
 *   gone room      what was left shrinks away over shrinkSec (reduced motion: fades in place), then goes
 *   taken          the body goes back to its kind's pool at once (the pop and the chomp are the pickup's feedback)
 *
 * Bodies by what the pack has for `pellet.<kind>` (ThemePack.pellet): the art laid flat on the floor at
 * PELLETS_VIEW.artTiles wide (FX floor placement: over floor effects, under every marking and bullet), tinted by the
 * kind's colour role; else the placeholder Block cube in that role, standing on the floor. The art only once its id has
 * downloaded (docs/STAGE_ASSETS.md SA18): the cube is the stand-in until then, swapped on the flip (swapLooks). Pooled per kind
 * (PELLETS_VIEW.poolSize built ahead), parked far below when unused; every move in one workspace:BulkMoveTo per frame,
 * and a pellet is re-placed only when it was just attached or its scale changed (a still one costs nothing).
 *
 * The power pellet taken (`RunView.pellets.power`): ParticleController.pelletPower (the fly-in cubes and the ring) and
 * the solo freeze through the hitstop clock (pelletPowerFreezeMs: the view player's own pickup, freezeFrameOn, like the
 * parry). Sounds are AudioController's (shared/view/audio cues.ts), pops ScorePopController's.
 *
 * Debug: KV_PelletDebug (Workspace boolean, Studio or KV_Debug, off by default) labels every live room's centre with
 * `pellets <left> / <count>` (developer English). Read-only on the sim.
 */
@Controller({})
export class PelletRenderController implements OnStart {
	private readonly janitor = new Janitor();
	private readonly tracker = new PelletViewTracker();
	/** Views by pellet index (a Map: indices come and go). */
	private readonly views = new Map<number, PelletView>();
	private readonly indexScratch = new Array<number>();
	private readonly free: PelletBody[][] = [[], []];
	private readonly looks = new Array<Pellet>();
	private readonly look: PelletLook = newPelletLook();
	private readonly moves = new Map<BasePart, CFrame>();
	private readonly moveParts = new Array<BasePart>();
	private readonly moveCFrames = new Array<CFrame>();
	/** Debug labels by score record index. */
	private readonly labels = new Map<number, { anchor: Part; label: TextLabel; text: string }>();
	private glowColor = new Color3(1, 1, 1);
	private pack: ThemePack | undefined;
	private folder: Folder | undefined;
	private debug = false;
	private shown = false;
	/** The readiness flips this view has not handled yet (docs/STAGE_ASSETS.md SA18). */
	private cursor: ReadinessCursor | undefined;

	constructor(
		private readonly sim: SimController,
		private readonly theme: ThemeController,
		private readonly fx: FxTrackerController,
		private readonly particles: ParticleController,
		private readonly preload: PreloadController,
	) {}

	onStart(): void {
		const pack = this.theme.getPack();
		this.pack = pack;
		this.glowColor = pack.color(PELLETS_VIEW.glowRole);
		this.cursor = new ReadinessCursor(this.preload.getReadiness());
		for (const k of PELLET_KINDS) this.looks.push(this.lookOf(pack.pellet(k)));
		const folder = new Instance("Folder");
		folder.Name = PELLETS_VIEW.folderName;
		folder.Parent = Workspace;
		this.folder = this.janitor.Add(folder);
		// Build the normal pool ahead (one power pellet per floor at most: built on first use).
		for (let i = 0; i < PELLETS_VIEW.poolSize; i++) this.free[NORMAL].push(this.build(NORMAL));

		const reset = () => this.clear();
		this.sim.onRunStarted(reset);
		this.sim.onRunExited(reset);
		this.readDebug();
		this.janitor.Add(
			Workspace.GetAttributeChangedSignal(PELLETS_VIEW.debugAttribute).Connect(() => this.readDebug()),
		);
		this.janitor.Add(Workspace.GetAttributeChangedSignal(RUN_ATTRIBUTES.debug).Connect(() => this.readDebug()));
		RunService.BindToRenderStep(
			PELLETS_VIEW.renderStep,
			Enum.RenderPriority.Camera.Value + RENDER_ORDER.viewsAfterCamera,
			() => this.frame(),
		);
		this.janitor.Add(() => RunService.UnbindFromRenderStep(PELLETS_VIEW.renderStep), true);
		this.janitor.Add(() => this.destroyPools(), true);
	}

	private frame(): void {
		const ctx = this.sim.getContext();
		if (ctx === undefined) {
			if (this.shown) this.clear();
			return;
		}
		const state = ctx.run.state;
		const p = state.pellets;
		if (p === undefined) {
			if (this.shown) this.clear();
			return;
		}
		debug.profilebegin(PELLETS_VIEW.profileLabel);
		this.swapLooks();
		const events = ctx.run.pellets;
		if (this.tracker.sync(state, events)) this.releaseAll();
		const settings = this.fx.settings();
		const motion = motionScale(settings);
		const now = (state.tick + this.sim.getAlpha()) / SIM_HZ;

		for (const taken of events.power) {
			this.particles.pelletPower(taken);
			const ms = pelletPowerFreezeMs(taken.player, this.sim.getViewPlayerIndex(), partySize(state), settings);
			if (ms > 0) this.sim.hitstop.request(ms, settings);
		}

		const look = this.look;
		let any = false;
		for (let i = 0; i < p.x.size(); i++) {
			this.tracker.look(state, i, now, motion, look);
			if (!look.shown) {
				if (this.views.has(i)) this.release(i);
				continue;
			}
			any = true;
			let view = this.views.get(i);
			if (view === undefined) view = this.attach(i, p.x[i], p.z[i], i === p.power ? POWER : NORMAL);
			this.apply(view, look);
		}
		this.shown = any;
		this.updateLabels(state);
		this.flushMoves();
		debug.profileend();
	}

	/** Run over, a new run or no run: every body parked, labels gone, the tracker forgets. */
	private clear(): void {
		this.releaseAll();
		this.removeLabels();
		this.flushMoves();
		this.tracker.reset();
		this.shown = false;
	}

	// --- bodies ------------------------------------------------------------------------------------

	/** A kind's look: its art once downloaded, else the stand-in cube (docs/STAGE_ASSETS.md SA18). */
	private lookOf(p: Pellet): Pellet {
		return lookWhenReady(p, this.preload.isArtReady(p.id));
	}

	/**
	 * docs/STAGE_ASSETS.md SA18: a kind whose art readiness flipped gets its look again; every pellet of it on the floor
	 * a new body in that look (placed and styled by the next apply), and its pool is rebuilt in the new look.
	 */
	private swapLooks(): void {
		const flipped = this.cursor?.take();
		if (flipped === undefined || flipped.size() === 0) return;
		const pack = this.pack!;
		for (let k = 0; k < PELLET_KINDS.size(); k++) {
			const p = pack.pellet(PELLET_KINDS[k] as PelletKind);
			if (!flipped.includes(p.id)) continue;
			this.looks[k] = this.lookOf(p);
			const want = this.looks[k].art !== undefined;
			const pool = this.free[k];
			let rebuilt = 0;
			for (const body of pool) {
				if (body.withArt === want) continue;
				this.discard(body);
				rebuilt++;
			}
			pool.clear();
			for (let n = 0; n < rebuilt; n++) pool.push(this.build(k));
			for (const [, view] of this.views) {
				if (view.body.kind !== k || view.body.withArt === want) continue;
				this.discard(view.body);
				view.body = this.build(k);
				view.placed = false;
				if (view.body.art !== undefined) view.body.art.label.Visible = true;
			}
		}
	}

	/** A body of a look no longer drawn: its parts leave this frame's moves, then it is destroyed. */
	private discard(body: PelletBody): void {
		if (body.model !== undefined) {
			for (const piece of body.model.pieces) this.moves.delete(piece.part);
			destroyModel(body.model);
		}
		if (body.art !== undefined) {
			this.moves.delete(body.art.part);
			body.art.part.Destroy();
		}
	}

	private attach(i: number, x: number, z: number, kind: number): PelletView {
		const want = this.looks[kind] !== undefined && this.looks[kind].art !== undefined;
		let body = this.free[kind].pop();
		while (body !== undefined && body.withArt !== want) {
			this.discard(body);
			body = this.free[kind].pop();
		}
		if (body === undefined) body = this.build(kind);
		const lifted = new CFrame(studsX(x), floorStudsY() + PELLETS_VIEW.liftStuds, studsZ(z));
		const view: PelletView = { body, lifted, placed: false };
		this.views.set(i, view);
		if (body.art !== undefined) body.art.label.Visible = true;
		return view;
	}

	private release(i: number): void {
		const view = this.views.get(i);
		if (view === undefined) return;
		this.views.delete(i);
		const body = view.body;
		this.place(body, PARKED);
		if (body.art !== undefined) body.art.label.Visible = false;
		this.free[body.kind].push(body);
	}

	/** Releases every view (indices copied first: no map edits while iterating it). */
	private releaseAll(): void {
		const scratch = this.indexScratch;
		scratch.clear();
		for (const [i] of this.views) scratch.push(i);
		for (const i of scratch) this.release(i);
		scratch.clear();
	}

	private build(kind: number): PelletBody {
		const folder = this.folder!;
		const look = this.looks[kind] ?? this.looks[NORMAL];
		const base = { kind, withArt: look.art !== undefined, scale: 1, transparency: 0, glow: 0 };
		const artVisual = look.art;
		if (artVisual !== undefined) {
			const widthTiles = PELLETS_VIEW.artTiles[PELLET_KINDS[kind] as PelletKind];
			const layout = widthLayout(visualLayout(artVisual), widthTiles);
			// built at the origin, so its frame there is its frame relative to the floor point
			const art = buildFloorArt(
				"Pellet",
				artVisual,
				Vector3.zero,
				folder,
				ART_THICKNESS,
				PELLETS_VIEW.artLiftStuds,
				0,
				layout,
			);
			if (art !== undefined) {
				const rel = art.part.CFrame;
				art.part.CFrame = PARKED;
				art.label.ImageColor3 = look.color;
				art.label.Visible = false;
				const size = art.part.Size;
				return { ...base, model: undefined, sizes: [], art: { part: art.part, label: art.label, size, rel } };
			}
		}
		const model = buildPlaceholder(this.pack!, look.id, look.placeholder, 1, folder, false);
		const sizes = model.pieces.map((piece) => piece.part.Size);
		for (const piece of model.pieces) piece.part.CFrame = PARKED;
		return { ...base, model, sizes, art: undefined };
	}

	/**
	 * This frame's look: scale (pop-in, pulse, shrink), transparency (the reduced fade), glow; then the move, only when
	 * the scale changed or the body was just attached (a still pellet costs no CFrame and no BulkMoveTo entry).
	 */
	private apply(view: PelletView, look: Readonly<PelletLook>): void {
		const body = view.body;
		const kindColor = (this.looks[body.kind] ?? this.looks[NORMAL]).color;
		if (body.glow !== look.glow) {
			body.glow = look.glow;
			const c = look.glow > 0 ? kindColor.Lerp(this.glowColor, look.glow) : kindColor;
			if (body.model !== undefined) setModelColor(body.model, c);
			if (body.art !== undefined) body.art.label.ImageColor3 = c;
		}
		if (body.transparency !== look.transparency) {
			body.transparency = look.transparency;
			if (body.model !== undefined) setModelTransparency(body.model, look.transparency);
			if (body.art !== undefined) body.art.label.ImageTransparency = look.transparency;
		}
		let moved = !view.placed;
		if (body.scale !== look.scale) {
			body.scale = look.scale;
			moved = true;
			const s = math.max(look.scale, 0);
			if (body.model !== undefined) {
				for (let k = 0; k < body.model.pieces.size(); k++)
					body.model.pieces[k].part.Size = body.sizes[k].mul(s);
			}
			const art = body.art;
			if (art !== undefined) art.part.Size = new Vector3(art.size.X * s, art.size.Y, art.size.Z * s);
		}
		if (!moved) return;
		view.placed = true;
		this.place(body, view.lifted);
	}

	/** Moves the body to `origin` (the model's pieces at their offsets scaled with it; the art at its floor frame). */
	private place(body: PelletBody, origin: CFrame): void {
		const s = body.scale;
		const model = body.model;
		if (model !== undefined) {
			for (const piece of model.pieces) {
				const o = piece.offset;
				this.moves.set(
					piece.part,
					origin === PARKED
						? PARKED
						: origin.mul(s === 1 ? o : new CFrame(o.Position.mul(s)).mul(o.Rotation)),
				);
			}
		}
		const art = body.art;
		if (art !== undefined) {
			if (origin === PARKED) this.moves.set(art.part, PARKED);
			else {
				const r = art.rel;
				const rel = s === 1 ? r : new CFrame(r.X * s, r.Y, r.Z * s).mul(r.Rotation);
				this.moves.set(art.part, origin.add(UNLIFT).mul(rel));
			}
		}
	}

	private flushMoves(): void {
		if (this.moves.size() === 0) return;
		this.moveParts.clear();
		this.moveCFrames.clear();
		for (const [part, cf] of this.moves) {
			this.moveParts.push(part);
			this.moveCFrames.push(cf);
		}
		this.moves.clear();
		Workspace.BulkMoveTo(this.moveParts, this.moveCFrames, Enum.BulkMoveMode.FireCFrameChanged);
	}

	private destroyPools(): void {
		this.releaseAll();
		this.removeLabels();
		for (const list of this.free) {
			for (const body of list) this.discard(body);
			list.clear();
		}
	}

	// --- KV_PelletDebug ----------------------------------------------------------------------------

	/** KV_PelletDebug: on in Studio or with KV_Debug, while the Workspace attribute is true. */
	private readDebug(): void {
		const allowed = RunService.IsStudio() || Workspace.GetAttribute(RUN_ATTRIBUTES.debug) === true;
		this.debug = allowed && Workspace.GetAttribute(PELLETS_VIEW.debugAttribute) === true;
		if (!this.debug) this.removeLabels();
	}

	/** One label per live room with pellets (at its score record's centre): `pellets <left> / <count>`. */
	private updateLabels(state: Readonly<SimState>): void {
		if (!this.debug) return;
		const p = state.pellets;
		const records = state.score?.rooms;
		if (p === undefined || records === undefined) return;
		for (let k = 0; k < p.rooms.size(); k++) {
			const room = p.rooms[k];
			const r = records[k];
			const live = room.phase === PelletPhase.LIVE && room.count > 0 && r !== undefined;
			const existing = this.labels.get(k);
			if (!live) {
				if (existing !== undefined) this.removeLabel(k);
				continue;
			}
			const text = pelletDebugText(room.left, room.count);
			if (existing !== undefined) {
				if (existing.text !== text) {
					existing.text = text;
					existing.label.Text = text;
				}
				continue;
			}
			this.addLabel(k, (r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2, text);
		}
	}

	private addLabel(rec: number, x: number, z: number, text: string): void {
		const v = PELLETS_VIEW;
		const anchor = renderPart("Part", false);
		anchor.Name = "PelletDebug";
		anchor.Transparency = HIDDEN;
		anchor.Size = new Vector3(SPRITE_VIEW.anchorStuds, SPRITE_VIEW.anchorStuds, SPRITE_VIEW.anchorStuds);
		anchor.CFrame = new CFrame(studsX(x), floorStudsY(), studsZ(z));
		const gui = createKvBillboardGui("PelletDebug");
		gui.Size = UDim2.fromOffset(v.debugWidthPx, v.debugHeightPx);
		gui.StudsOffsetWorldSpace = new Vector3(0, v.debugLiftStuds, 0);
		gui.AlwaysOnTop = true;
		gui.ResetOnSpawn = false;
		gui.Adornee = anchor;
		const label = new Instance("TextLabel");
		label.BackgroundTransparency = HIDDEN;
		label.BorderSizePixel = 0;
		label.Size = UDim2.fromScale(1, 1);
		label.Font = DEV_MONO_FONT;
		label.TextSize = v.debugTextSize;
		label.TextColor3 = this.pack!.color(v.debugRole);
		label.TextStrokeTransparency = 0;
		label.Text = text;
		label.Parent = gui;
		gui.Parent = anchor;
		anchor.Parent = this.folder;
		this.labels.set(rec, { anchor, label, text });
	}

	private removeLabel(rec: number): void {
		const l = this.labels.get(rec);
		if (l === undefined) return;
		this.labels.delete(rec);
		l.anchor.Destroy();
	}

	private removeLabels(): void {
		const scratch = this.indexScratch;
		scratch.clear();
		for (const [k] of this.labels) scratch.push(k);
		for (const k of scratch) this.removeLabel(k);
		scratch.clear();
	}
}
