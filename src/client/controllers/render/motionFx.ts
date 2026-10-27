import type { JuiceSettings } from "shared/settings";
import {
	BOSS_DEMONLORD_ID,
	MAX_ACTORS,
	archetypeAt,
	type ActorState,
	type PlayerState,
	type SimState,
} from "shared/sim";
import { BULLET_VIEW, SPRITE_VIEW } from "shared/view";
import {
	FEEL_GHOST,
	FEEL_SQUASH,
	GhostTrail,
	RollEdgeWatch,
	SquashBook,
	brimstoneCharging,
	ghostsOn,
	motionScale,
	type FxEvent,
	type Ghost,
	type SquashScale,
} from "shared/view/fx";
import { renderPart } from "./placeholders";
import type { SpriteView } from "./SpriteView";

const PARKED = new CFrame(BULLET_VIEW.parkedStuds[0], BULLET_VIEW.parkedStuds[1], BULLET_VIEW.parkedStuds[2]);
const WHITE = new Color3(1, 1, 1);
const HIDDEN = 1;
/** Players' squash key (their SquashBook slot is the party index; one view per index for the whole run). */
const PLAYER_KEY = 1;

/** One pooled ghost view: a BillboardGui + ImageLabel on an invisible anchor Part (like SpriteView, frame only). */
interface GhostView {
	readonly anchor: Part;
	readonly gui: BillboardGui;
	readonly label: ImageLabel;
	/** The ghost serial its properties were written for (-1: none). */
	serial: number;
	/** Drawn (not parked) as last written. */
	shown: boolean;
	transparency: number;
}

/**
 * The motion half of the game-feel pass (docs/FEEL.md J6 squash & stretch, J7 afterimages), owned by
 * ActorRenderController, which calls it from its own frame (one BulkMoveTo: ghost moves go into its lists). Logic is
 * the pure shared/view/fx squash.ts / afterimage.ts; this class only feeds them and writes Instances.
 *
 * Squash: the knight's roll edges come from RollEdgeWatch over PlayerState.rollTicks (local, per player), actors' from
 * the tracker's hit / spawned / killed events (onFxEvent, keyed by (slot, actorId) in a SquashBook). Sprite views only
 * (SpriteView.setScale); placeholder models are not deformed.
 *
 * Ghosts: one GhostTrail per party member (while rolling) and one for the Demon Lord (while his brimstone charge runs);
 * a due ghost copies the sprite's frame as drawn (SpriteView.snapshot). The pool (GHOST_POOL_SIZE views, built up front
 * under KV_Actors/Ghosts) maps trail t's ghost j to view t * perSource + j; a view's properties are written only when
 * its ghost was re-recorded, its transparency (quantized) only on change, and it moves only when recorded or parked.
 *
 * Clock: effect seconds = the actor renderer's sprite clock (sum of its animDtSec: sim seconds, stopping with pause and
 * hitstop). Reduced motion: squash 1 x 1 (motionScale 0), no ghosts (ghostsOn); particles off: no ghosts.
 */
export class MotionFx {
	private readonly folder: Folder;
	private readonly actorSquash = new SquashBook(MAX_ACTORS);
	private readonly playerSquash = new SquashBook(FEEL_GHOST.playerTrails);
	private readonly rolls = new RollEdgeWatch(FEEL_GHOST.playerTrails);
	private readonly trails = new Array<GhostTrail>();
	private readonly views = new Array<GhostView>();
	private readonly scale: SquashScale = { sx: 1, sy: 1 };
	/** archetype index -> is the Demon Lord (cached; archetypeAt per actor per frame avoided). */
	private readonly demonlordKinds = new Map<number, boolean>();
	private now = 0;
	private motion = 1;
	private ghosts = true;
	private tick = 0;
	private lastState: SimState | undefined;

	constructor(parent: Instance) {
		const folder = new Instance("Folder");
		folder.Name = FEEL_GHOST.folderName;
		folder.Parent = parent;
		this.folder = folder;
		const n = FEEL_GHOST.playerTrails + FEEL_GHOST.bossTrails;
		for (let t = 0; t < n; t++) {
			this.trails.push(new GhostTrail(FEEL_GHOST.perSource));
			for (let j = 0; j < FEEL_GHOST.perSource; j++) this.views.push(buildGhostView(folder));
		}
	}

	/** Tracker events (FxTrackerController.onEvent; they arrive before the renderer's frame). */
	onFxEvent(e: FxEvent): void {
		switch (e.type) {
			case "reset":
				this.clear();
				return;
			case "hit":
				if (!e.boss || FEEL_SQUASH.bossHits) this.actorSquash.start(e.slot, e.actorId, "hit");
				return;
			case "spawned":
				this.actorSquash.start(e.slot, e.actorId, "spawn");
				return;
			case "killed":
				this.actorSquash.start(e.slot, e.actorId, "death");
				return;
			default:
				return;
		}
	}

	/** Start of the renderer's frame: the clock (+ its sprite dt), the settings, a new run. */
	beginFrame(state: SimState, dtSec: number, settings: Readonly<JuiceSettings>): void {
		if (state !== this.lastState) {
			this.lastState = state;
			this.clear();
		}
		this.now += dtSec;
		this.tick = state.tick;
		this.motion = motionScale(settings);
		const on = ghostsOn(settings);
		if (!on && this.ghosts) for (const trail of this.trails) trail.clear();
		this.ghosts = on;
		this.actorSquash.setNow(this.now);
		this.playerSquash.setNow(this.now);
	}

	/** Player `index`'s sprite after its update: roll squash and roll ghosts. `at` is its anchor's position. */
	player(index: number, sprite: SpriteView, p: Readonly<PlayerState>, at: Vector3): void {
		const dead = p.dead !== 0;
		const edge = this.rolls.edge(index, p.rollTicks, dead);
		if (edge === "start") this.playerSquash.start(index, PLAYER_KEY, "rollStart");
		else if (edge === "end") this.playerSquash.start(index, PLAYER_KEY, "rollEnd");
		const s = this.playerSquash.lookInto(this.scale, index, PLAYER_KEY, this.motion);
		sprite.setScale(s.sx, s.sy);
		const trail = this.trails[index];
		if (trail !== undefined) this.record(trail, this.ghosts && !dead && p.rollTicks > 0, sprite, at.X, at.Y, at.Z);
	}

	/** An actor's sprite after its update: its squash, and the Demon Lord's charge ghosts. (x, y, z): its feet, studs. */
	actor(slot: number, sprite: SpriteView, a: Readonly<ActorState>, x: number, y: number, z: number): void {
		const s = this.actorSquash.lookInto(this.scale, slot, a.id, this.motion);
		sprite.setScale(s.sx, s.sy);
		if (!this.isDemonlord(a.kind)) return;
		const trail = this.trails[FEEL_GHOST.playerTrails];
		trail.bind(a.id);
		this.record(trail, this.ghosts && brimstoneCharging(a, BOSS_DEMONLORD_ID), sprite, x, y, z);
	}

	/** End of the renderer's frame: draws the ghost pool (moves into the renderer's BulkMoveTo lists). */
	endFrame(moveParts: BasePart[], moveCFrames: CFrame[]): void {
		const per = FEEL_GHOST.perSource;
		const quantum = FEEL_GHOST.transparencyQuantum;
		for (let t = 0; t < this.trails.size(); t++) {
			const trail = this.trails[t];
			for (let j = 0; j < per; j++) {
				const g = trail.ghosts[j];
				const view = this.views[t * per + j];
				const raw = trail.transparencyOf(g, this.now);
				if (raw >= 1) {
					if (view.shown) {
						view.shown = false;
						view.gui.Enabled = false;
						moveParts.push(view.anchor);
						moveCFrames.push(PARKED);
					}
					continue;
				}
				if (view.serial !== g.serial || !view.shown) {
					view.serial = g.serial;
					view.shown = true;
					writeGhost(view, g);
					moveParts.push(view.anchor);
					moveCFrames.push(new CFrame(g.x, g.y, g.z));
				}
				const tq = math.min(1, math.floor(raw / quantum + 0.5) * quantum);
				if (tq !== view.transparency) {
					view.transparency = tq;
					view.label.ImageTransparency = tq;
				}
			}
		}
	}

	destroy(): void {
		this.folder.Destroy();
	}

	private clear(): void {
		this.actorSquash.clear();
		this.playerSquash.clear();
		this.rolls.reset();
		for (const trail of this.trails) trail.clear();
	}

	private record(trail: GhostTrail, active: boolean, sprite: SpriteView, x: number, y: number, z: number): void {
		const g = trail.due(active, this.tick, this.now);
		if (g === undefined) return;
		if (!sprite.snapshot(g.snap)) {
			trail.cancel(g);
			return;
		}
		g.x = x;
		g.y = y;
		g.z = z;
	}

	private isDemonlord(kind: number): boolean {
		let yes = this.demonlordKinds.get(kind);
		if (yes === undefined) {
			yes = archetypeAt(kind).id === BOSS_DEMONLORD_ID;
			this.demonlordKinds.set(kind, yes);
		}
		return yes;
	}
}

/** Built once, parked and disabled. */
function buildGhostView(folder: Instance): GhostView {
	const anchor = renderPart("Part", false);
	anchor.Name = "Ghost.anchor";
	anchor.Transparency = HIDDEN;
	anchor.Size = new Vector3(SPRITE_VIEW.anchorStuds, SPRITE_VIEW.anchorStuds, SPRITE_VIEW.anchorStuds);
	anchor.CFrame = PARKED;
	const gui = new Instance("BillboardGui");
	gui.Name = "Ghost";
	gui.LightInfluence = 0;
	gui.AlwaysOnTop = false;
	gui.ResetOnSpawn = false;
	gui.Adornee = anchor;
	gui.Enabled = false;
	const label = new Instance("ImageLabel");
	label.Name = "Frame";
	label.BackgroundTransparency = HIDDEN;
	label.BorderSizePixel = 0;
	label.Size = UDim2.fromScale(1, 1);
	label.ImageColor3 = WHITE;
	label.ImageTransparency = HIDDEN;
	label.Parent = gui;
	gui.Parent = anchor;
	anchor.Parent = folder;
	return { anchor, gui, label, serial: -1, shown: false, transparency: HIDDEN };
}

/** A re-recorded ghost's frame, size and offset (pushed FEEL_GHOST.behindStuds away from the camera). */
function writeGhost(view: GhostView, g: Ghost): void {
	const s = g.snap;
	const label = view.label;
	label.Image = s.image;
	label.ImageRectOffset = new Vector2(s.rectX, s.rectY);
	label.ImageRectSize = new Vector2(s.rectW, s.rectH);
	label.ResampleMode = Enum.ResamplerMode[s.resample];
	view.gui.Size = new UDim2(s.w, 0, s.h, 0);
	view.gui.StudsOffset = new Vector3(s.offsetX, s.offsetY, s.offsetZ - FEEL_GHOST.behindStuds);
	view.gui.Enabled = true;
}
