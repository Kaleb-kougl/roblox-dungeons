import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { RunService, Workspace } from "@rbxts/services";
import { clientStore, selectBindings, selectInputDevice } from "client/store";
import { DEV_MONO_FONT, createKvBillboardGui, createKvSurfaceGui, currentHudFont, onLocaleChanged } from "client/ui";
import { CAMERA_PITCH_DEG, STUDS_PER_TILE } from "shared/config";
import { keyDevice, RUN_ATTRIBUTES, shrineHint } from "shared/play";
import { PACT_KIND_COUNT, PactKind, SIM_HZ, TILE_SIZE, type SimConfig, type SimState } from "shared/sim";
import type { JuiceSettings } from "shared/settings";
import type { ColorRole, PactAltar, StringVars, ThemePack, WorldVisual } from "shared/theme";
import { BULLET_VIEW, SPRITE_VIEW, floorStudsY, spriteBillboard, studsX, studsZ } from "shared/view";
import { FX_SPRITE_VIEW, effectiveParticles, motionScale } from "shared/view/fx";
import {
	COMBO_SHOUT_DRAW,
	FLOOR_SHOUT_PRIORITY,
	ShoutDuck,
	floorAxes,
	shoutDucked,
	type ShoutBox,
} from "shared/view/hud";
import {
	AltarFlame,
	PACTS_VIEW,
	PACT_STRINGS,
	altarArtFit,
	altarFlameScale,
	greedPulseAt,
	hordeRingFillOpacity,
	hordeRingRadiusShare,
	hordeWaveFill,
	newAltarLook,
	pactAltarLook,
	pactCard,
	pactCardCanvasSize,
	pactCardCentre,
	pactCardOpacity,
	pactCardsEqual,
	pactCardsNear,
	pactDebugText,
	pactRole,
	type AltarFlameId,
	type AltarLook,
	type PactCard,
	type PactFrameSource,
} from "shared/view/pacts";
import { ComboController } from "../fx/ComboController";
import { FxTrackerController } from "../fx/FxTrackerController";
import { SimController } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import { restingAnimation, visualLayout } from "./decorParts";
import { FLOOR_CANVAS_YAW, floorCanvasPartSize } from "./floorCanvas";
import { buildPlaceholder, destroyModel, renderPart, setModelColor, type PlaceholderModel } from "./placeholders";

const HIDDEN = 1;
const PARKED = new CFrame(BULLET_VIEW.parkedStuds[0], BULLET_VIEW.parkedStuds[1], BULLET_VIEW.parkedStuds[2]);
const AXES = floorAxes();
/** A Cylinder Part's axis is X: this lays it flat (a disc on the floor). */
const DISC = CFrame.Angles(0, 0, math.pi / 2);
/** Card lines at most (Greed: title, take, the curse's effect, gain, accept). */
const CARD_LINES = 5;
/** A disc this thin, studs (under every marking and bullet). */
const DISC_STUDS = 0.01;
/** Floor-layer steps below the sprite effects' lowest layer: the cards, the take pulse, the wave rings. */
const CARD_LAYER = COMBO_SHOUT_DRAW.layerStepsBelowEffects + 1;
const PULSE_LAYER = COMBO_SHOUT_DRAW.layerStepsBelowEffects + 2;
const RING_LAYER = COMBO_SHOUT_DRAW.layerStepsBelowEffects + 3;
/** A card's opacity is rewritten only when it moves this much. */
const EPS = 0.005;
/** The altar art's resting animation (the pact slot's base animation, contract PACT): frame 0 is drawn. */
const IDLE_ANIMATION = "idle";

/** A floor layer's top, studs (FxSpriteController's floor placement, `steps` layers under the effects). */
function layerTop(steps: number): number {
	const V = FX_SPRITE_VIEW;
	return floorStudsY() + V.liftStuds - steps * V.layerStepStuds;
}

/** One altar's instances (built per floor) and what they last showed. */
interface AltarView {
	readonly kind: number;
	readonly x: number;
	readonly z: number;
	readonly body: PlaceholderModel | undefined;
	readonly bodyImage: ImageLabel | undefined;
	readonly bodyAnchor: Part | undefined;
	/** The body's top above the floor point, studs (the flame stands on it). */
	readonly topStuds: number;
	readonly flame: Part;
	readonly cardPart: Part;
	readonly cardSurface: SurfaceGui;
	readonly lines: TextLabel[];
	readonly duck: ShoutDuck;
	readonly box: ShoutBox;
	readonly look: AltarLook;
	card: PactCard | undefined;
	cardShown: boolean;
	cardOpacity: number;
	flameShown: AltarFlameId;
	dim: boolean;
	debug: { anchor: Part; label: TextLabel; text: string } | undefined;
}

/** A pooled floor disc (a wave ring's fill or rim, the take pulse). */
interface Disc {
	readonly part: Part;
	shown: boolean;
}

/**
 * The pacts in the world (docs/FORTUNE.md FO7, "Player experience -> Pacts"), drawn from `state.pacts` (endless runs
 * with SimConfig.pacts; nothing otherwise). Once per frame (an FxTrackerController frame handler, after the frame's
 * ticks), with the view player (SimController.getViewPlayerIndex: the watched teammate while spectating) for what is
 * personal and party state otherwise:
 *
 *   altars    per floor whose altars stand, both altar cells get the pack's `pact.altar` (an upright billboard of the
 *             image, or of a sprite set's `idle` frame 0 in its resample mode, at its own scale capped by
 *             shared/view/pacts altarArtFit; or the placeholder plinth) and a flame (a small Neon block standing on
 *             the art's PACTS_VIEW.artTopTiles, or the plinth's top) by shared/view/pacts pactAltarLook:
 *             Greed `pact.greed` while it is the view player's, the Horde a low ember of `pact.horde` while offered and
 *             full red and larger once armed; off (and the body darkened PACTS_VIEW.spentDim toward the background)
 *             once the altar gives the view player nothing. The flame flickers (x the juice motionScale: still under
 *             reduced motion).
 *   cards     one floor card per altar (pactCard: title / take (Greed's exact curse and its short effect) / gain /
 *             `pact.accept` with the binding-aware shrine key (shared/play shrineHint; none on touch), or the title and
 *             the dim line), PACTS_VIEW.card.offsetTiles screen-down of the altar, on the combo shout's construction
 *             (docs/COMBO.md CD9): ONE SurfaceGui on the Top face of a thin invisible floor Part, yawed by the camera,
 *             CARD_LAYER floor layers under the sprite effects (every bullet, telegraph, marking, effect and body draws
 *             over it), at most COMBO_SHOUT.maxOpacity (55 %; a dimmed card x card.dimOpacity) and ducking with the
 *             shout's ShoutDuck while an enemy bullet is in its box. Shown while the view player is near the altars
 *             (pactCardsNear); labels rebuilt only when the card's text changes (and on a locale or binding change).
 *   take      a pact taken (RunView.pacts.taken): a dark disc pulse at its altar (greedPulseAt; reduced motion: a fade in
 *             place; Particles Off: none). The take's sound is the cue mapper's; Greed's curse toast is the
 *             progression toasts' (the curse brand does not fly to the owned-items row: the HUD's item row has no
 *             world-to-HUD anchor to fly to; the pulse and the toast carry the take).
 *   horde     the horde room roused (RunView.pacts.roused): the `fx.horde.shout` floor shout; wave 2 telegraphed: the
 *             `fx.horde.wave` shout (both through ComboController.requestShout at FLOOR_SHOUT_PRIORITY.horde, in
 *             `pact.horde`), and while the telegraph runs a spawn ring per wave tile (state.pacts.horde.waveX / waveZ):
 *             a rim disc and a fill disc growing over the telegraph (hordeWaveFill; reduced motion: full size, only its
 *             opacity climbs). The horn / wave sounds are the cue mapper's, the edges RoomEdgeController's, the pops
 *             ScorePopController's, the tally segment RoomClearController's.
 *
 * Debug: KV_PactLabel (Workspace boolean, Studio or KV_Debug, off by default) labels each altar with its kind, the view
 * player's availability (and Greed's curse index) and the Horde's phase (pactDebugText, developer English). Every
 * instance is the Janitor's (per floor: floorJanitor). Read-only on the sim.
 */
@Controller({})
export class PactRenderController implements OnStart {
	private readonly janitor = new Janitor();
	private readonly floorJanitor = new Janitor();
	private readonly altars = new Array<AltarView>();
	private readonly ringFills = new Array<Disc>();
	private readonly ringRims = new Array<Disc>();
	private readonly pulses = new Array<{ disc: Disc; x: number; z: number; ageSec: number }>();
	private folder: Folder | undefined;
	private pack: ThemePack | undefined;
	/** The floor's altars the views were built for (floor + cells), "" none. */
	private builtKey = "";
	private debug = false;
	/** The cards' labels are rewritten on the next frame (a locale or binding change). */
	private relabel = false;
	private readonly str = (key: string, vars?: StringVars) => this.pack!.str(key, vars);

	constructor(
		private readonly sim: SimController,
		private readonly theme: ThemeController,
		private readonly fx: FxTrackerController,
		private readonly combo: ComboController,
	) {}

	onStart(): void {
		this.pack = this.theme.getPack();
		const folder = new Instance("Folder");
		folder.Name = PACTS_VIEW.folderName;
		folder.Parent = Workspace;
		this.folder = this.janitor.Add(folder);
		this.janitor.Add(this.floorJanitor, "Cleanup");
		this.janitor.Add(() => this.destroyDiscs(), true);
		this.sim.onRunStarted(() => this.clear());
		this.sim.onRunExited(() => this.clear());
		this.fx.onFrame((_, settings, dt) => this.frame(settings, dt));
		this.readDebug();
		this.janitor.Add(
			Workspace.GetAttributeChangedSignal(PACTS_VIEW.debugAttribute).Connect(() => this.readDebug()),
		);
		this.janitor.Add(Workspace.GetAttributeChangedSignal(RUN_ATTRIBUTES.debug).Connect(() => this.readDebug()));
		this.janitor.Add(
			onLocaleChanged(() => {
				const font = currentHudFont();
				for (const a of this.altars) for (const l of a.lines) l.Font = font;
				this.relabel = true;
			}),
		);
		// The accept line names the player's shrine key on their device: rewrite the cards on a rebind / device change.
		this.janitor.Add(clientStore.subscribe(selectBindings, () => (this.relabel = true)));
		this.janitor.Add(clientStore.subscribe(selectInputDevice, () => (this.relabel = true)));
	}

	// --- the frame ---------------------------------------------------------------------------------

	private frame(settings: Readonly<JuiceSettings>, dt: number): void {
		const ctx = this.sim.getContext();
		const state = ctx?.run.state;
		const p = state?.pacts;
		if (ctx === undefined || state === undefined || p === undefined || p.room < 0) {
			if (this.builtKey !== "") this.clear();
			return;
		}
		debug.profilebegin(PACTS_VIEW.profileLabel);
		const key = `${state.endless?.floor ?? 0}:${p.room}:${p.altarX[0]}:${p.altarZ[0]}`;
		if (key !== this.builtKey) this.build(state, key);
		const view = this.sim.getViewPlayerIndex();
		const motion = motionScale(settings);
		const timeSec = (state.tick + this.sim.getAlpha()) / SIM_HZ;
		const near = pactCardsNear(state, view) && !this.sim.isInputCovered() && !this.sim.isRunOver();
		const keyName = this.keyName();
		for (const a of this.altars) {
			pactAltarLook(state, ctx.config, view, a.kind, a.look);
			this.drawAltar(a, timeSec, motion);
			this.drawCard(a, state, ctx.config, view, near, keyName, dt);
			this.drawDebug(a, state, ctx.config, view);
		}
		this.relabel = false;
		this.takes(ctx.run.pacts, settings, dt, motion);
		this.rings(state, this.sim.getAlpha(), motion);
		debug.profileend();
	}

	/** The shrine key's name on the player's device (shared/play shrineHint), undefined on touch (no accept line). */
	private keyName(): string | undefined {
		const store = clientStore.getState();
		const device = selectInputDevice(store);
		if (device === "touch") return undefined;
		return shrineHint(selectBindings(store), this.str)[keyDevice(device)];
	}

	// --- the altars -----------------------------------------------------------------------------------

	private build(state: Readonly<SimState>, key: string): void {
		this.floorJanitor.Cleanup();
		this.altars.clear();
		this.hideRings();
		this.builtKey = key;
		const p = state.pacts!;
		const pack = this.pack!;
		const folder = this.floorJanitor.Add(new Instance("Folder"));
		folder.Name = "Altars";
		folder.Parent = this.folder;
		const theme = pack.pactAltar();
		for (let k = 0; k < math.min(PACT_KIND_COUNT, p.altarX.size()); k++) {
			const view = this.buildAltar(pack, theme, k, p.altarX[k], p.altarZ[k], folder);
			this.altars.push(view);
		}
	}

	private buildAltar(
		pack: ThemePack,
		theme: PactAltar,
		kind: number,
		x: number,
		z: number,
		folder: Folder,
	): AltarView {
		const V = PACTS_VIEW;
		const base = new CFrame(studsX(x), floorStudsY() + V.liftStuds, studsZ(z));
		let body: PlaceholderModel | undefined;
		let bodyImage: ImageLabel | undefined;
		let bodyAnchor: Part | undefined;
		let topStuds = 0;
		const art = theme.art;
		const built = art !== undefined ? this.buildArt(art, base, folder) : undefined;
		if (built !== undefined) {
			bodyImage = built.label;
			bodyAnchor = built.anchor;
			topStuds = built.topTiles * STUDS_PER_TILE;
		} else {
			body = buildPlaceholder(pack, theme.id, theme.placeholder, 1, folder, false);
			for (const piece of body.pieces) piece.part.CFrame = base.mul(piece.offset);
			topStuds = theme.placeholder.size[1];
		}
		const flame = renderPart("Part", false);
		flame.Name = "Flame";
		flame.Material = Enum.Material.Neon;
		flame.Color = pack.color(pactRole(kind));
		flame.Size = this.flameSize(1);
		flame.CFrame = PARKED;
		flame.Parent = folder;
		const card = this.buildCard(pack, kind, folder);
		const view: AltarView = {
			kind,
			x,
			z,
			body,
			bodyImage,
			bodyAnchor,
			topStuds,
			flame,
			cardPart: card.part,
			cardSurface: card.surface,
			lines: card.lines,
			duck: new ShoutDuck(),
			box: { x: 0, z: 0, rightX: AXES.rightX, rightZ: AXES.rightZ, halfWidth: 0, halfDepth: 0 },
			look: newAltarLook(),
			card: undefined,
			cardShown: false,
			cardOpacity: -1,
			flameShown: AltarFlame.OFF,
			dim: false,
			debug: undefined,
		};
		const c = pactCardCentre(x, z, AXES);
		view.box.x = c.x;
		view.box.z = c.z;
		view.box.halfWidth = (V.card.widthTiles * TILE_SIZE) / 2;
		view.box.halfDepth = (V.card.depthTiles * TILE_SIZE) / 2;
		card.part.CFrame = new CFrame(
			studsX(c.x),
			layerTop(CARD_LAYER) - FX_SPRITE_VIEW.thicknessStuds / 2,
			studsZ(c.z),
		).mul(FLOOR_CANVAS_YAW);
		this.floorJanitor.Add(() => {
			if (view.body !== undefined) destroyModel(view.body);
			view.debug?.anchor.Destroy();
		}, true);
		return view;
	}

	/**
	 * An upright billboard of the altar art standing on the altar cell (its pivot on the cell), laid out by altarArtFit:
	 * an image region, or a sprite set's `idle` frame 0 (the altar does not animate) in the set's resample mode.
	 * Undefined (draw the plinth) for a sprite set with no frames to show.
	 */
	private buildArt(
		art: WorldVisual,
		base: CFrame,
		folder: Folder,
	): { anchor: Part; label: ImageLabel; topTiles: number } | undefined {
		let image: string;
		let offset: Vector2;
		let size: Vector2;
		let resample: Enum.ResamplerMode = Enum.ResamplerMode.Default;
		if (art.kind === "image") {
			image = art.image;
			offset = art.offset;
			size = art.size;
		} else {
			const anim = restingAnimation(art.set, IDLE_ANIMATION);
			if (anim === undefined) return undefined;
			const frame = art.set.frame(anim, 0, 0);
			image = frame.image;
			offset = frame.offset;
			size = frame.size;
			resample = Enum.ResamplerMode[art.set.resample];
		}
		const fit = altarArtFit(visualLayout(art));
		const anchor = renderPart("Part", false);
		anchor.Name = "AltarArt";
		anchor.Transparency = HIDDEN;
		anchor.Size = new Vector3(SPRITE_VIEW.anchorStuds, SPRITE_VIEW.anchorStuds, SPRITE_VIEW.anchorStuds);
		anchor.CFrame = base;
		const board = spriteBillboard(fit.layout);
		const gui = createKvBillboardGui("Altar");
		gui.Size = new UDim2(board.w, 0, board.h, 0);
		gui.StudsOffset = new Vector3(board.offsetX, board.offsetY, board.offsetZ);
		gui.LightInfluence = 0;
		gui.AlwaysOnTop = false;
		gui.ResetOnSpawn = false;
		gui.Adornee = anchor;
		const label = new Instance("ImageLabel");
		label.Name = "Frame";
		label.BackgroundTransparency = HIDDEN;
		label.BorderSizePixel = 0;
		label.Size = UDim2.fromScale(1, 1);
		label.Image = image;
		label.ImageRectOffset = offset;
		label.ImageRectSize = size;
		label.ResampleMode = resample;
		label.Parent = gui;
		gui.Parent = anchor;
		anchor.Parent = folder;
		return { anchor, label, topTiles: fit.topTiles };
	}

	private flameSize(scale: number): Vector3 {
		const [w, h, d] = PACTS_VIEW.flameTiles;
		const s = STUDS_PER_TILE * math.max(scale, 0);
		return new Vector3(w * s, h * s, d * s);
	}

	private drawAltar(a: AltarView, timeSec: number, motion: number): void {
		const pack = this.pack!;
		const look = a.look;
		const V = PACTS_VIEW;
		if (look.dim !== a.dim) {
			a.dim = look.dim;
			const bg = pack.color("background");
			if (a.body !== undefined) {
				const stone = pack.visualColor(pack.pactAltar().placeholder.color);
				setModelColor(a.body, look.dim ? stone.Lerp(bg, V.spentDim) : stone);
			}
			if (a.bodyImage !== undefined)
				a.bodyImage.ImageColor3 = look.dim ? new Color3(1, 1, 1).Lerp(bg, V.spentDim) : new Color3(1, 1, 1);
		}
		const flame = look.flame;
		if (flame === AltarFlame.OFF) {
			if (a.flameShown !== AltarFlame.OFF) {
				a.flameShown = AltarFlame.OFF;
				a.flame.CFrame = PARKED;
			}
			return;
		}
		if (flame !== a.flameShown) {
			a.flameShown = flame;
			const role = pactRole(a.kind);
			const full = pack.color(role);
			a.flame.Color = flame === AltarFlame.EMBER ? full.Lerp(pack.color(V.stoneRole), V.hordeIdleMix) : full;
		}
		const size = this.flameSize(altarFlameScale(flame, timeSec, motion));
		a.flame.Size = size;
		a.flame.CFrame = new CFrame(studsX(a.x), floorStudsY() + V.liftStuds + a.topStuds + size.Y / 2, studsZ(a.z));
	}

	// --- the cards ----------------------------------------------------------------------------------------

	private buildCard(
		pack: ThemePack,
		kind: number,
		folder: Folder,
	): { part: Part; surface: SurfaceGui; lines: TextLabel[] } {
		const C = PACTS_VIEW.card;
		const part = renderPart("Part", false);
		part.Name = `Card${kind}`;
		part.Transparency = HIDDEN;
		part.Size = floorCanvasPartSize(
			C.widthTiles * STUDS_PER_TILE,
			FX_SPRITE_VIEW.thicknessStuds,
			C.depthTiles * STUDS_PER_TILE,
		);
		part.CFrame = PARKED;
		const [w, h] = pactCardCanvasSize(CAMERA_PITCH_DEG);
		const surface = createKvSurfaceGui("PactCard");
		surface.Face = Enum.NormalId.Top;
		surface.SizingMode = Enum.SurfaceGuiSizingMode.FixedSize;
		surface.CanvasSize = new Vector2(w, h);
		surface.AlwaysOnTop = false;
		surface.LightInfluence = COMBO_SHOUT_DRAW.lightInfluence;
		surface.ResetOnSpawn = false;
		surface.Enabled = false;
		const list = new Instance("UIListLayout");
		list.FillDirection = Enum.FillDirection.Vertical;
		list.VerticalAlignment = Enum.VerticalAlignment.Center;
		list.HorizontalAlignment = Enum.HorizontalAlignment.Center;
		list.SortOrder = Enum.SortOrder.LayoutOrder;
		list.Parent = surface;
		const lines: TextLabel[] = [];
		for (let i = 0; i < CARD_LINES; i++) {
			const label = new Instance("TextLabel");
			label.Name = `Line${i}`;
			label.LayoutOrder = i;
			label.Size = UDim2.fromScale(1, 0);
			label.BackgroundTransparency = HIDDEN;
			label.BorderSizePixel = 0;
			label.Font = currentHudFont();
			label.TextScaled = true;
			label.TextColor3 = pack.color(C.textRole);
			label.TextStrokeColor3 = pack.color("background");
			label.TextTransparency = HIDDEN;
			label.TextStrokeTransparency = HIDDEN;
			label.Visible = false;
			label.Parent = surface;
			lines.push(label);
		}
		surface.Parent = part;
		part.Parent = folder;
		return { part, surface, lines };
	}

	private drawCard(
		a: AltarView,
		state: Readonly<SimState>,
		config: Readonly<SimConfig>,
		view: number,
		near: boolean,
		keyName: string | undefined,
		dt: number,
	): void {
		if (!near) {
			if (a.cardShown) {
				a.cardShown = false;
				a.cardSurface.Enabled = false;
			}
			a.card = undefined; // rebuilt when it shows again (a locale / binding change meanwhile)
			return;
		}
		const card = pactCard(state, config, view, a.kind, this.str, keyName);
		if (card === undefined) return;
		if (this.relabel || !pactCardsEqual(card, a.card)) {
			a.card = card;
			a.cardOpacity = -1;
			const pack = this.pack!;
			for (let i = 0; i < a.lines.size(); i++) {
				const label = a.lines[i];
				const line = card.lines[i];
				label.Visible = line !== undefined;
				if (line === undefined) continue;
				label.Text = line.text;
				label.TextColor3 = pack.color(line.role as ColorRole);
				label.Size = UDim2.fromScale(1, line.share);
			}
		}
		if (!a.cardShown) {
			a.cardShown = true;
			a.duck.reset();
			a.cardSurface.Enabled = true;
		}
		const ceiling = a.duck.step(dt, shoutDucked(a.box, state.combat.enemyBullets));
		const opacity = pactCardOpacity(ceiling, card.dim);
		if (math.abs(opacity - a.cardOpacity) > EPS) {
			a.cardOpacity = opacity;
			for (const label of a.lines) {
				label.TextTransparency = HIDDEN - opacity;
				label.TextStrokeTransparency = HIDDEN - opacity * (HIDDEN - COMBO_SHOUT_DRAW.strokeTransparency);
			}
		}
	}

	// --- takes and the Horde ---------------------------------------------------------------------------

	private takes(events: PactFrameSource, settings: Readonly<JuiceSettings>, dt: number, motion: number): void {
		const pack = this.pack!;
		const life = PACTS_VIEW.horde.shoutLifeSec;
		const red = pack.color(pactRole(PactKind.HORDE));
		if (events.roused.size() > 0)
			this.combo.requestShout(this.str(PACT_STRINGS.shout), red, life, FLOOR_SHOUT_PRIORITY.horde);
		if (events.telegraphed.size() > 0)
			this.combo.requestShout(this.str(PACT_STRINGS.wave), red, life, FLOOR_SHOUT_PRIORITY.horde);
		if (effectiveParticles(settings) !== "off") {
			for (const t of events.taken) {
				const disc = this.disc(this.pulses.size(), "Pulse");
				this.pulses.push({ disc, x: t.x, z: t.z, ageSec: 0 });
			}
		}
		// The pulses (a few per floor at most): grow and fade, then their discs go back.
		const color = pack.color(PACTS_VIEW.greed.pulseRole);
		let k = 0;
		while (k < this.pulses.size()) {
			const p = this.pulses[k];
			const look = greedPulseAt(p.ageSec, motion);
			p.ageSec += math.max(dt, 0);
			if (look === undefined) {
				p.disc.part.Destroy();
				this.pulses.remove(k);
				continue;
			}
			const d = look.radiusTiles * 2 * STUDS_PER_TILE;
			p.disc.part.Color = color;
			p.disc.part.Transparency = HIDDEN - look.opacity;
			p.disc.part.Size = new Vector3(DISC_STUDS, d, d);
			p.disc.part.CFrame = new CFrame(studsX(p.x), layerTop(PULSE_LAYER) - DISC_STUDS / 2, studsZ(p.z)).mul(DISC);
			k++;
		}
	}

	/** Wave 2's spawn rings while its telegraph runs (hordeWaveFill), one rim and one filling disc per wave tile. */
	private rings(state: Readonly<SimState>, alpha: number, motion: number): void {
		const fill = hordeWaveFill(state, alpha);
		const h = state.pacts!.horde;
		if (fill < 0) {
			this.hideRings();
			return;
		}
		const pack = this.pack!;
		const R = PACTS_VIEW.horde.ring;
		const color = pack.color(pactRole(PactKind.HORDE));
		const top = layerTop(RING_LAYER) - DISC_STUDS / 2;
		const full = R.radiusTiles * 2 * STUDS_PER_TILE;
		const inner = full * hordeRingRadiusShare(fill, motion);
		const n = h.waveX.size();
		for (let k = 0; k < n; k++) {
			const rim = this.ringDisc(this.ringRims, k, "WaveRim");
			const disc = this.ringDisc(this.ringFills, k, "WaveFill");
			const at = new CFrame(studsX(h.waveX[k]), top, studsZ(h.waveZ[k]));
			rim.part.Color = color;
			rim.part.Transparency = HIDDEN - R.ringOpacity;
			rim.part.Size = new Vector3(
				DISC_STUDS,
				full + R.rimTiles * 2 * STUDS_PER_TILE,
				full + R.rimTiles * 2 * STUDS_PER_TILE,
			);
			rim.part.CFrame = at.mul(DISC);
			// The fill sits a hair above the rim so it reads over it.
			disc.part.Color = color;
			disc.part.Transparency = HIDDEN - hordeRingFillOpacity(fill);
			disc.part.Size = new Vector3(DISC_STUDS, inner, inner);
			disc.part.CFrame = at.add(new Vector3(0, FX_SPRITE_VIEW.layerStepStuds / 2, 0)).mul(DISC);
			rim.shown = true;
			disc.shown = true;
		}
		for (let k = n; k < this.ringRims.size(); k++) this.parkDisc(this.ringRims[k]);
		for (let k = n; k < this.ringFills.size(); k++) this.parkDisc(this.ringFills[k]);
	}

	private ringDisc(pool: Disc[], k: number, name: string): Disc {
		while (pool.size() <= k) pool.push(this.disc(pool.size(), name));
		return pool[k];
	}

	private disc(index: number, name: string): Disc {
		const part = renderPart("Part", false);
		part.Name = `${name}${index}`;
		part.Shape = Enum.PartType.Cylinder;
		part.Material = Enum.Material.SmoothPlastic;
		part.CFrame = PARKED;
		part.Parent = this.folder;
		return { part, shown: false };
	}

	private parkDisc(d: Disc): void {
		if (!d.shown) return;
		d.shown = false;
		d.part.CFrame = PARKED;
	}

	private hideRings(): void {
		for (const d of this.ringRims) this.parkDisc(d);
		for (const d of this.ringFills) this.parkDisc(d);
	}

	private destroyDiscs(): void {
		for (const d of this.ringRims) d.part.Destroy();
		for (const d of this.ringFills) d.part.Destroy();
		for (const p of this.pulses) p.disc.part.Destroy();
		this.ringRims.clear();
		this.ringFills.clear();
		this.pulses.clear();
	}

	/** No run, a new run, a floor without altars: every altar view gone, rings parked, pulses dropped. */
	private clear(): void {
		this.floorJanitor.Cleanup();
		this.altars.clear();
		this.builtKey = "";
		this.hideRings();
		for (const p of this.pulses) p.disc.part.Destroy();
		this.pulses.clear();
	}

	// --- KV_PactLabel ------------------------------------------------------------------------------------

	/** KV_PactLabel: on in Studio or with KV_Debug, while the Workspace attribute is true. */
	private readDebug(): void {
		const allowed = RunService.IsStudio() || Workspace.GetAttribute(RUN_ATTRIBUTES.debug) === true;
		this.debug = allowed && Workspace.GetAttribute(PACTS_VIEW.debugAttribute) === true;
		if (!this.debug) {
			for (const a of this.altars) {
				a.debug?.anchor.Destroy();
				a.debug = undefined;
			}
		}
	}

	private drawDebug(a: AltarView, state: Readonly<SimState>, config: Readonly<SimConfig>, view: number): void {
		if (!this.debug) return;
		const text = pactDebugText(state, config, view, a.kind);
		if (a.debug !== undefined) {
			if (a.debug.text !== text) {
				a.debug.text = text;
				a.debug.label.Text = text;
			}
			return;
		}
		const V = PACTS_VIEW;
		const anchor = renderPart("Part", false);
		anchor.Name = "PactDebug";
		anchor.Transparency = HIDDEN;
		anchor.Size = new Vector3(SPRITE_VIEW.anchorStuds, SPRITE_VIEW.anchorStuds, SPRITE_VIEW.anchorStuds);
		anchor.CFrame = new CFrame(studsX(a.x), floorStudsY(), studsZ(a.z));
		const gui = createKvBillboardGui("PactDebug");
		gui.Size = UDim2.fromOffset(V.debugWidthPx, V.debugHeightPx);
		gui.StudsOffsetWorldSpace = new Vector3(0, V.debugLiftStuds, 0);
		gui.AlwaysOnTop = true;
		gui.ResetOnSpawn = false;
		gui.Adornee = anchor;
		const label = new Instance("TextLabel");
		label.BackgroundTransparency = HIDDEN;
		label.BorderSizePixel = 0;
		label.Size = UDim2.fromScale(1, 1);
		label.Font = DEV_MONO_FONT;
		label.TextSize = V.debugTextSize;
		label.TextColor3 = this.pack!.color(V.debugRole);
		label.TextStrokeTransparency = 0;
		label.Text = text;
		label.Parent = gui;
		gui.Parent = anchor;
		anchor.Parent = this.folder;
		a.debug = { anchor, label, text };
	}
}
