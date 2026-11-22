/**
 * Every player's view for the actor renderer (docs/ACTOR_RENDER.md): the body (the sprite set of the player's visual,
 * or the placeholder capsule as its stand-in, docs/STAGE_ASSETS.md SA17), the co-op ring or facing pip, the player
 * outline (docs/PLAYER_OUTLINE.md) and the cosmetic look (docs/COSMETICS.md CS5). Owned by ActorRenderController: it
 * writes into the controller's move batch, so the frame still ends in ONE BulkMoveTo.
 *
 * @module
 */
import type { Janitor } from "@rbxts/janitor";
import { Workspace } from "@rbxts/services";
import { clientStore, selectDisplay } from "client/store";
import { CAMERA_YAW_DEG, STUDS_PER_TILE } from "shared/config";
import type { CosmeticLook } from "shared/cosmetics";
import { BOW_WEAPON_ID, NO_WEAPON, SWORD, partySize, weaponIndex, type PlayerState, type SimState } from "shared/sim";
import type { SpriteSet, ThemePack } from "shared/theme";
import {
	ACTOR_VIEW,
	PLAYER_OUTLINE,
	SPRITE_VIEW,
	choosePlayerAnim,
	degToRad,
	floorStudsY,
	lerp,
	outlineSwitchOn,
	playerBlinkVisible,
	playerLook,
	playerOutlined,
	playerSpriteInputFor,
	playerVisualIdOf,
	rollTumbleTurn,
	studsX,
	studsZ,
	type ActorLook,
	type IsoBasis,
	type VariantLook,
} from "shared/view";
import { cosmeticClockSec, cosmeticRgb8, dyeForVisual, lookAnimated, lookAt, rgb8Key } from "shared/view/cosmetics";
import type { FxTrackerController } from "../../fx/FxTrackerController";
import type { PreloadController } from "../../game/PreloadController";
import type { SimController } from "../../game/SimController";
import type { MotionFx } from "../motionFx";
import {
	buildPlaceholder,
	setModelColor,
	setModelParent,
	setModelTransparency,
	type PlaceholderModel,
} from "../placeholders";
import { SPRITE_TINT_NONE, SpriteView } from "../SpriteView";
import { buildPlayerView, buildRing, color3Of, destroyPlayerView, placeModel } from "./actorParts";
import { HIDDEN, PARKED, PIP_THICKNESS, UNWRITTEN, type PlayerView } from "./actorViews";

const TAU = 2 * math.pi;
/** Flat floor images (the ring) turn with the camera, so their x axis is the screen's right. */
const CAMERA_YAW = CFrame.Angles(0, degToRad(CAMERA_YAW_DEG), 0);

/** What the players' views read from the controller that owns them (plain functions, called with `.`). */
export interface PlayerHost {
	/** The pack's sprite set for a visual id (the controller's cache), undefined for the placeholder path. */
	readonly spriteSet: (id: string) => SpriteSet | undefined;
	/** A look's body colour (undefined: the base colour / no tint). */
	readonly lookColor: (pack: ThemePack, look: VariantLook) => Color3 | undefined;
}

/**
 * The party's views, index order (co-op: one per member, built on first use; unused ones parked). Built with the
 * controller, started from its onStart (the player-outline Model and its switches, the first view), then each frame
 * {@link PlayerViews.beginFrame} and {@link PlayerViews.drawPlayers}, before the actor loop.
 */
export class PlayerViews {
	private pack: ThemePack | undefined;
	/** The actor folder's players group: every view's parent. */
	private folder: Instance | undefined;
	/** The controller's animation clock step this frame (sim seconds). */
	private dtSec = 0;
	/** Squash & stretch and afterimages (../motionFx.ts), from {@link setMotion}. */
	private motion: MotionFx | undefined;
	private readonly players = new Array<PlayerView>();
	private swordIndex: number | undefined;
	private bowIndex: number | undefined;
	/** Each player's visual id (shared/view playerVisualIdOf), worked out once per run state (a run's loadouts never change). */
	private visualIds = new Array<string>();
	private visualState: SimState | undefined;
	/** Player outline (docs/PLAYER_OUTLINE.md): DisplaySettings.playerOutline and KV_PlayerOutline, read on change. */
	private playerOutlineSetting = true;
	private playerOutlineOn = true;
	/** Players/Outlined: the outlined placeholder capsule's Model, and its ONE Highlight. */
	private outlinedPlayers: Model | undefined;
	private playerHighlight: Highlight | undefined;
	// --- stand-ins (docs/STAGE_ASSETS.md SA17) ---------------------------------------------------
	/** This frame's art readiness (docs/STAGE_ASSETS.md SA17): each player's body by their own visual (ARCHER AR9). */
	private readiness: ReturnType<PreloadController["getReadiness"]> | undefined;
	private ringReady = false;

	// --- cosmetics (docs/COSMETICS.md CS5) -------------------------------------------------------
	/** The cosmetic clock (s): the sprite clock's sum (sim seconds: stops with pause, slows with hitstop). */
	private cosmeticSec = 0;
	/** playerOutline's colour (a player without an outline item). */
	private playerRimColor = SPRITE_TINT_NONE;
	/** The readiness epoch the dyed sprites last re-asked at. */
	private dyeEpoch = -1;
	/** A dye sheet's content has downloaded (ArtReadiness by content id). */
	private readonly dyeReady = (contentId: string) => this.preload.getReadiness().status(contentId) === "ready";

	constructor(
		private readonly sim: SimController,
		private readonly fx: FxTrackerController,
		private readonly preload: PreloadController,
		private readonly basis: IsoBasis,
		private readonly janitor: Janitor,
		private readonly moveParts: BasePart[],
		private readonly moveCFrames: CFrame[],
		private readonly host: PlayerHost,
	) {}

	/**
	 * Builds the player-outline Model with its switches and the first player's view under `players` (the actor folder's
	 * players group). Once, from the controller's onStart.
	 */
	start(pack: ThemePack, players: Instance): void {
		this.pack = pack;
		this.folder = players;
		this.playerRimColor = pack.color(PLAYER_OUTLINE.role);
		this.startPlayerOutline(pack, players);
		this.players.push(buildPlayerView(pack, players, ACTOR_VIEW.playerVisualId));
	}

	/** The motion feel the players' sprites feed (roll squash, afterimages, the trail colour). */
	setMotion(motion: MotionFx): void {
		this.motion = motion;
	}

	/**
	 * Once per frame, before {@link drawPlayers}: the animation clock's step (it also advances the cosmetic clock) and
	 * this frame's art readiness (each player's body, the ring image).
	 */
	beginFrame(dtSec: number, readiness: ReturnType<PreloadController["getReadiness"]>): void {
		this.dtSec = dtSec;
		this.cosmeticSec += dtSec;
		this.readiness = readiness;
		this.ringReady = readiness.isReady(ACTOR_VIEW.ringVisualId);
	}

	private place(model: PlaceholderModel, origin: CFrame): void {
		placeModel(this.moveParts, this.moveCFrames, model, origin);
	}

	private spriteSet(id: string): SpriteSet | undefined {
		return this.host.spriteSet(id);
	}

	private lookColor(pack: ThemePack, look: VariantLook): Color3 | undefined {
		return this.host.lookColor(pack, look);
	}

	/**
	 * Stand-ins (docs/STAGE_ASSETS.md SA17): makes `mode` the drawn body of `view`, building it on first use (the sprite
	 * with its ring and the player-outline rim; the capsule under the players group) and parking the other one (a
	 * parked capsule leaves the player-outline Model). The cached look / transparency are reset so the new body is
	 * written in full this frame.
	 */
	private usePlayerBody(view: PlayerView, mode: "art" | "standIn", pack: ThemePack): void {
		if (view.drawn === mode) return;
		const folder = this.folder!;
		if (mode === "art") {
			const set = this.spriteSet(view.visualId)!;
			if (view.sprite === undefined) {
				// Every player's view carries the player-outline rim; drawPlayer shows it on the watched player only.
				view.sprite = new SpriteView(set, folder, set, 0, pack.color(PLAYER_OUTLINE.role));
				view.sprite.setDyeReady(this.dyeReady);
				view.ring = buildRing(pack, set, folder);
			}
			view.sprite.reset();
			if (view.model !== undefined && view.drawn !== undefined) {
				this.setPlayerOutlined(view, false);
				this.place(view.model, PARKED);
			}
		} else {
			if (view.model === undefined) {
				view.model = buildPlaceholder(pack, view.visualId, pack.placeholder(view.visualId), 1, folder, true);
			}
			const sprite = view.sprite;
			if (sprite !== undefined && view.drawn !== undefined) {
				sprite.park();
				this.moveParts.push(sprite.anchor);
				this.moveCFrames.push(PARKED);
				if (view.ring !== undefined) {
					this.moveParts.push(view.ring.part);
					this.moveCFrames.push(PARKED);
				}
			}
		}
		view.drawn = mode;
		view.look = undefined;
		view.transparency = -1;
		// the new body takes the look in full this frame (reset cleared the sprite's dye)
		view.dyeKey = UNWRITTEN;
		view.rimKey = UNWRITTEN;
		view.cosmeticRef = undefined;
	}

	/** Every player (co-op: each party member, index order); views beyond the party are parked. */
	drawPlayers(state: SimState, alpha: number): void {
		const pack = this.pack;
		const folder = this.folder;
		if (pack === undefined || folder === undefined) return;
		const n = partySize(state);
		if (state !== this.visualState) {
			this.visualState = state;
			this.visualIds = [];
		}
		while (this.players.size() < n) {
			this.players.push(buildPlayerView(pack, folder, this.playerVisualId(state, this.players.size())));
		}
		const localIndex = this.sim.getViewPlayerIndex(); // co-op spectating: the watched player gets the local ring
		let rimDrawn = false; // the player-outline Highlight: an outlined capsule is drawn this frame
		// docs/COSMETICS.md CS5: a dye sheet that landed (or a force change) re-asks the dyed sprites' readiness.
		const epoch = this.readiness?.epoch() ?? this.dyeEpoch;
		const dyeRecheck = epoch !== this.dyeEpoch;
		this.dyeEpoch = epoch;
		const looks = this.sim.getContext()?.looks;
		const reduced = this.fx.settings().reducedMotion;
		const tSec = cosmeticClockSec(this.cosmeticSec, reduced);
		for (let i = 0; i < this.players.size(); i++) {
			let view = this.players[i];
			if (i < n) {
				const visualId = this.playerVisualId(state, i);
				if (view.visualId !== visualId) {
					// docs/ARCHER.md AR9: this player is another character now (a new run): their own sprite or capsule.
					destroyPlayerView(view);
					view = buildPlayerView(pack, folder, visualId);
					this.players[i] = view;
				}
				if (this.drawPlayer(view, state, i, alpha, pack, i === localIndex)) rimDrawn = true;
				this.applyLook(view, i, looks, tSec, dyeRecheck);
				continue;
			}
			this.setPlayerOutlined(view, false);
			if (view.model !== undefined) this.place(view.model, PARKED);
			if (view.sprite !== undefined) {
				this.moveParts.push(view.sprite.anchor);
				this.moveCFrames.push(PARKED);
			}
			if (view.ring !== undefined) {
				this.moveParts.push(view.ring.part);
				this.moveCFrames.push(PARKED);
			}
			this.moveParts.push(view.pip);
			this.moveCFrames.push(PARKED);
		}
		const highlight = this.playerHighlight;
		if (highlight !== undefined && highlight.Enabled !== rimDrawn) highlight.Enabled = rimDrawn;
		// The capsule's rim is the watched player's (one Highlight; only they are outlined): their outline colour.
		const watched = this.players[localIndex];
		const rim = watched?.rimColor ?? this.playerRimColor;
		if (highlight !== undefined && rimDrawn && highlight.OutlineColor !== rim) highlight.OutlineColor = rim;
	}

	/**
	 * docs/COSMETICS.md CS5: player `index`'s look on their view: the dye on their sprite (only a dye of their own set,
	 * dyeForVisual; a Prismatic one on the cosmetic clock), their rim colour (an outline item replaces playerOutline;
	 * shown on the watched player only, as before) and their roll trail's colour. Each colour is rebuilt and written
	 * only when its whole channels change (rgb8Key); a view without a look writes nothing after its first frame.
	 */
	private applyLook(
		view: PlayerView,
		index: number,
		looks: ReadonlyArray<CosmeticLook> | undefined,
		tSec: number,
		dyeRecheck: boolean,
	): void {
		const look = lookAt(looks, index);
		if (
			look === view.cosmeticRef &&
			view.cosmeticVisual === view.visualId &&
			!view.cosmeticAnimated &&
			!dyeRecheck
		) {
			return;
		}
		view.cosmeticRef = look;
		view.cosmeticVisual = view.visualId;
		view.cosmeticAnimated = lookAnimated(look);
		const sprite = view.sprite;
		const dye = cosmeticRgb8(dyeForVisual(look, view.visualId), tSec);
		const dyeKey = rgb8Key(dye);
		if (dyeKey !== view.dyeKey) {
			view.dyeKey = dyeKey;
			sprite?.setDye(color3Of(dye));
		} else if (dyeRecheck && dye !== undefined) {
			sprite?.refreshDye();
		}
		const rim = cosmeticRgb8(look.outline);
		const rimKey = rgb8Key(rim);
		if (rimKey !== view.rimKey) {
			view.rimKey = rimKey;
			view.rimColor = color3Of(rim);
			sprite?.setRimColor(view.rimColor ?? this.playerRimColor);
		}
		const trail = cosmeticRgb8(look.trail);
		const trailKey = rgb8Key(trail);
		if (trailKey !== view.trailKey) {
			view.trailKey = trailKey;
			this.motion?.setTrailColor(index, color3Of(trail));
		}
	}

	/**
	 * Draws one party member; returns whether its placeholder capsule shows the player outline this frame (outlined and
	 * not blinked out), for the shared Highlight's Enabled.
	 */
	private drawPlayer(
		view: PlayerView,
		state: SimState,
		index: number,
		alpha: number,
		pack: ThemePack,
		isLocal: boolean,
	): boolean {
		// docs/LOCAL_PREDICTION.md LP5: as drawn (the predicted local player; the merged one otherwise). The look (i-frame tint), the hurt blink and
		// death are the merged player's fields (LPD5), which the drawn player keeps.
		const p = this.sim.getDrawnPlayer(state, index);
		const x = studsX(lerp(p.prevX, p.x, alpha));
		const z = studsZ(lerp(p.prevZ, p.z, alpha));
		const floorY = floorStudsY() + ACTOR_VIEW.liftStuds;
		const at = new Vector3(x, floorY, z);
		const dead = p.dead !== 0;
		const rolling = !dead && p.rollTicks > 0;
		const dirX = rolling ? p.rollDirX : p.faceX;
		const dirZ = rolling ? p.rollDirZ : p.faceZ;
		const look = playerLook(p.dead, p.iframeTicks);
		const visible = playerBlinkVisible(p.dead, p.hurtTicks);
		// Player outline (docs/PLAYER_OUTLINE.md): the watched, living player while the setting and the switch are on.
		const outlined = playerOutlined(isLocal, dead, this.playerOutlineSetting, this.playerOutlineOn);
		// Stand-ins (SA17) per player: their own visual's set, once its art is ready (docs/ARCHER.md AR9).
		const art = this.spriteSet(view.visualId) !== undefined && this.readiness?.isReady(view.visualId) === true;
		this.usePlayerBody(view, art ? "art" : "standIn", pack);

		const sprite = art ? view.sprite : undefined;
		if (sprite !== undefined) {
			this.moveParts.push(sprite.anchor);
			this.moveCFrames.push(new CFrame(at));
			// docs/ARCHER.md AR12 / AR9: the Archer's set plays the bow's draw / release / stream, every other visual the sword.
			const input = playerSpriteInputFor(view.visualId, state, index, alpha, this.sword(), this.bow(), p);
			sprite.update(choosePlayerAnim(input, sprite.set), dirX, dirZ, this.basis, this.dtSec);
			if (look !== view.look) {
				view.look = look;
				// Dead: the death animation shows it (the placeholder greys out instead).
				sprite.setTint(look === "dead" ? SPRITE_TINT_NONE : this.lookColor(pack, look) ?? SPRITE_TINT_NONE);
			}
			sprite.setVisible(visible);
			sprite.setOutlineShown(outlined);
			this.motion?.player(index, sprite, p, at);
		} else {
			this.drawPlayerModel(view, p, at, dirX, dirZ, dead, rolling, alpha, pack, look, visible);
			this.setPlayerOutlined(view, outlined);
		}
		const rimDrawn = !art && outlined && visible;

		// The ring only on the sprite and once its image is ready; else the facing pip (and the ring part parked).
		const ring = sprite !== undefined && this.ringReady ? view.ring : undefined;
		if (ring === undefined && sprite !== undefined && view.ring !== undefined) {
			this.moveParts.push(view.ring.part);
			this.moveCFrames.push(PARKED);
		}
		if (ring !== undefined) {
			// The ring replaces the facing pip (the sprite shows the facing); hidden when dead, like the pip.
			this.moveParts.push(view.pip);
			this.moveCFrames.push(PARKED);
			this.moveParts.push(ring.part);
			this.moveCFrames.push(
				dead
					? PARKED
					: new CFrame(x, floorY + SPRITE_VIEW.ringThicknessStuds / 2, z).mul(CAMERA_YAW).mul(ring.offset),
			);
			const color = pack.color(isLocal ? SPRITE_VIEW.ringLocalRole : SPRITE_VIEW.ringTeammateRole);
			if (color !== ring.color) {
				ring.color = color;
				ring.decal.Color3 = color;
			}
			return rimDrawn;
		}

		// Facing pip on the floor ahead of the player (hidden when dead).
		const fx = p.faceX;
		const fz = p.faceZ;
		const d = ACTOR_VIEW.facingPipDistance * STUDS_PER_TILE;
		const pipAt = new Vector3(x + fx * d, floorY + PIP_THICKNESS, z + fz * d);
		this.moveParts.push(view.pip);
		this.moveCFrames.push(
			dead
				? PARKED
				: (fx !== 0 || fz !== 0 ? CFrame.lookAlong(pipAt, new Vector3(fx, 0, fz)) : new CFrame(pipAt)).mul(
						CFrame.Angles(0, math.pi / 4, 0),
				  ),
		);
		return rimDrawn;
	}

	/** Moves a placeholder capsule into / out of the player-outline Model, only when its playerOutlined changes. */
	private setPlayerOutlined(view: PlayerView, outlined: boolean): void {
		const model = view.model;
		if (model === undefined || outlined === view.outlined) return;
		view.outlined = outlined;
		const parent = outlined ? this.outlinedPlayers : this.folder;
		if (parent !== undefined) setModelParent(model, parent);
	}

	/**
	 * The player outline's Model (Players/Outlined) with its ONE Highlight, and the two switches it follows: the Display
	 * setting (store subscription) and the KV_PlayerOutline attribute, both read on change, never per frame.
	 */
	private startPlayerOutline(pack: ThemePack, players: Instance): void {
		const model = new Instance("Model");
		model.Name = PLAYER_OUTLINE.modelName;
		model.Parent = players;
		this.outlinedPlayers = model;
		const highlight = new Instance("Highlight");
		highlight.Name = PLAYER_OUTLINE.highlightName;
		highlight.FillTransparency = PLAYER_OUTLINE.fillTransparency;
		highlight.OutlineTransparency = PLAYER_OUTLINE.outlineTransparency;
		highlight.OutlineColor = pack.color(PLAYER_OUTLINE.role);
		highlight.DepthMode = Enum.HighlightDepthMode[PLAYER_OUTLINE.depthMode];
		highlight.Enabled = false; // drawPlayers turns it on while an outlined capsule is drawn
		highlight.Adornee = model;
		highlight.Parent = model;
		this.playerHighlight = highlight;
		const syncSwitch = () => {
			this.playerOutlineOn = outlineSwitchOn(Workspace.GetAttribute(PLAYER_OUTLINE.enabledAttribute));
		};
		syncSwitch();
		this.janitor.Add(Workspace.GetAttributeChangedSignal(PLAYER_OUTLINE.enabledAttribute).Connect(syncSwitch));
		this.playerOutlineSetting = selectDisplay(clientStore.getState()).playerOutline;
		this.janitor.Add(
			clientStore.subscribe(selectDisplay, (d) => {
				this.playerOutlineSetting = d.playerOutline;
			}),
		);
	}

	/** The placeholder capsule: tumble while rolling, lying down when dead, tint and blink. */
	private drawPlayerModel(
		view: PlayerView,
		p: Readonly<PlayerState>,
		at: Vector3,
		dirX: number,
		dirZ: number,
		dead: boolean,
		rolling: boolean,
		alpha: number,
		pack: ThemePack,
		look: ActorLook,
		visible: boolean,
	): void {
		const model = view.model!;
		let origin = dirX !== 0 || dirZ !== 0 ? CFrame.lookAlong(at, new Vector3(dirX, 0, dirZ)) : new CFrame(at);
		const halfH = model.size.Y / 2;
		if (rolling) {
			// Tumble forward once over the roll, around the capsule's middle.
			const t = rollTumbleTurn(p.rollTicks, alpha);
			origin = origin
				.mul(new CFrame(0, halfH, 0))
				.mul(CFrame.Angles(-t * TAU, 0, 0))
				.mul(new CFrame(0, -halfH, 0));
		} else if (dead) {
			// Lie down backwards (pivot at the feet, then rest on the floor).
			const r = model.size.X / 2;
			origin = origin.mul(new CFrame(0, r, 0)).mul(CFrame.Angles(math.pi / 2, 0, 0));
		}
		this.place(model, origin);
		if (look !== view.look) {
			view.look = look;
			setModelColor(model, this.lookColor(pack, look) ?? model.baseColor);
		}
		// Post-hit blink from the sim's own counter (web PlayerView), so it matches the invulnerability exactly.
		const transparency = visible ? 0 : HIDDEN;
		if (transparency !== view.transparency) {
			view.transparency = transparency;
			setModelTransparency(model, transparency);
		}
	}

	/** The sword's weapon index (resolved once; NO_WEAPON if it is not registered). */
	private sword(): number {
		if (this.swordIndex === undefined) {
			const [ok, index] = pcall(() => weaponIndex(SWORD.id));
			this.swordIndex = ok ? (index as number) : NO_WEAPON;
		}
		return this.swordIndex;
	}

	private bow(): number {
		if (this.bowIndex === undefined) {
			const [ok, index] = pcall(() => weaponIndex(BOW_WEAPON_ID));
			this.bowIndex = ok ? (index as number) : NO_WEAPON;
		}
		return this.bowIndex;
	}

	/**
	 * Player `index`'s visual (docs/ARCHER.md AR9): their character's (the run's pick, SimController.getRunCharacters,
	 * else the character their weapons are), the Knight's for anyone else. Cached per run state.
	 */
	private playerVisualId(state: SimState, index: number): string {
		const ids = this.visualIds;
		if (index < ids.size()) return ids[index];
		const characters = this.sim.getRunCharacters();
		while (ids.size() <= index) ids.push(playerVisualIdOf(characters, state, ids.size()));
		return ids[index];
	}
}
