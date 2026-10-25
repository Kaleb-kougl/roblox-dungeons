import { Controller, OnStart } from "@flamework/core";
import { RunService, Workspace } from "@rbxts/services";
import { CAMERA_PITCH_DEG, CAMERA_YAW_DEG, STUDS_PER_TILE } from "shared/config";
import {
	CORPSE_TICKS,
	NO_KIND,
	NO_WEAPON,
	ROLL_TICKS,
	SIM_HZ,
	SWORD,
	archetypeAt,
	partySize,
	playerAt,
	weaponIndex,
	weaponsAt,
	type ActorState,
	type PlayerState,
	type SimState,
} from "shared/sim";
import type { SpriteSet, ThemePack } from "shared/theme";
import {
	ACTOR_SPRITE_INPUTS,
	ACTOR_VIEW,
	BULLET_VIEW,
	RENDER_ORDER,
	SPRITE_VIEW,
	actorLook,
	animDtSec,
	chooseActorAnim,
	choosePlayerAnim,
	corpseTransparency,
	degToRad,
	floorImageOffset,
	floorImageSize,
	floorStudsY,
	isoBasis,
	lerp,
	playerBlinkVisible,
	playerLook,
	playerSpriteInput,
	studsX,
	studsZ,
	swordTimingOf,
	type ActorLook,
	type ActorSpriteInput,
	type IsoBasis,
} from "shared/view";
import { SimController } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import {
	buildPlaceholder,
	destroyModel,
	renderPart,
	setModelColor,
	setModelTransparency,
	type PlaceholderModel,
} from "./placeholders";
import { SPRITE_TINT_NONE, SpriteView } from "./SpriteView";

const RENDER_STEP = "KV_Actors";
const PARKED = new CFrame(BULLET_VIEW.parkedStuds[0], BULLET_VIEW.parkedStuds[1], BULLET_VIEW.parkedStuds[2]);
const TAU = 2 * math.pi;
const HIDDEN = 1;
/** Pip: a flat diamond (the ui.cursor placeholder turned 45 degrees), this thin, scaled down from its cell. */
const PIP_THICKNESS = 0.05;
const PIP_SCALE = 0.35;
/** Flat floor images (the ring) turn with the camera, so their x axis is the screen's right. */
const CAMERA_YAW = CFrame.Angles(0, degToRad(CAMERA_YAW_DEG), 0);
/** Free-list key prefix of pooled sprite views (placeholder models use `${visualId}@${scale}`). */
const SPRITE_KEY = "sprite:";

/** The co-op ring under a player (`ui.ring.player`, a Decal on a flat invisible Part). */
interface Ring {
	readonly part: Part;
	readonly decal: Decal;
	/** From the feet to the ring's centre in the camera-yawed frame (the image's pivot; identity when centred). */
	readonly offset: CFrame;
	color: Color3 | undefined;
}

/** One player's view (co-op: one per party member, built on first use): a sprite set or the placeholder capsule. */
interface PlayerView {
	readonly model: PlaceholderModel | undefined;
	readonly sprite: SpriteView | undefined;
	readonly pip: BasePart;
	readonly ring: Ring | undefined;
	look: ActorLook;
	transparency: number;
}

interface ActorView {
	kind: number;
	id: number;
	/** Exactly one of model / sprite is set. */
	model: PlaceholderModel | undefined;
	sprite: SpriteView | undefined;
	/** The archetype's sprite input builder (sprite views only). */
	spriteInput: ((a: Readonly<ActorState>, alpha: number) => ActorSpriteInput) | undefined;
	look: ActorLook;
	transparency: number;
	corpseTicks: number;
}

/**
 * Every actor and the player, drawn from sim state (web ActorsView + PlayerView). Per ID, one of two paths:
 *
 * Sprites (docs/ART.md S4): when the pack has a `sprites` set for the ID (`pack.sprites(id)`) and, for actors, the
 * archetype has a sprite input builder (shared/view ACTOR_SPRITE_INPUTS: the swarmer today), a pooled SpriteView
 * (BillboardGui on a feet anchor) shows the animation chosen from sim state (shared/view sprites.ts) in the facing
 * nearest the sim's facing on screen; juice through the label: hit flash / telegraph pulse / i-frame tints
 * (ImageColor3), corpse fade (ImageTransparency), the post-hit blink (Visible). The player's ring (`ui.ring.player`,
 * tinted uiAccent for the local player, uiTextDim for teammates) replaces the facing pip when the pack has it.
 *
 * Placeholders (every other ID; every ID with the placeholder pack): one model per occupied pool slot, by archetype
 * (registry index -> ArchetypeDef -> data.spriteId -> PLACEHOLDER_VISUALS: swarmer ball, sniper wedge facing its aim,
 * bruiser block, turret drums, the boss's large block), at data.spriteScale (bosses at least ACTOR_VIEW.bossMinDrawPx
 * wide). Interpolated by the sim's alpha, turned to the actor's facing, tinted while the hit flash runs or while
 * winding up a telegraphed attack (pulsing), fading out as a corpse, removed when the slot is freed (models go back
 * to a per-visual pool). The player: the `class.vanguard` capsule with a facing pip on the floor (`ui.cursor`), a
 * tumble while rolling, the i-frame tint, the post-hit blink and lying down greyed when dead.
 *
 * Looks and fades come from the same pure rules on both paths (shared/view actorLook, playerLook, playerBlinkVisible,
 * corpseTransparency; roles in ACTOR_VIEW.lookRoles). Every part moves in ONE workspace:BulkMoveTo per frame.
 * Co-op (M4): every party member is drawn the same way (one view each, index order); unused ones are parked.
 */
@Controller({})
export class ActorRenderController implements OnStart {
	private folder: Folder | undefined;
	private pack: ThemePack | undefined;
	private readonly views = new Array<ActorView | undefined>();
	private readonly free = new Map<string, PlaceholderModel[]>();
	private readonly freeSprites = new Map<string, SpriteView[]>();
	/** spriteId -> its sprite set, or false (placeholder path). */
	private readonly spriteSets = new Map<string, SpriteSet | false>();
	/** One past the highest slot ever given a view (`views` has holes, so its size() is unreliable). */
	private viewSlots = 0;
	/**
	 * Views released this frame, parked after the actor loop unless re-acquired in the same frame: a part must not be
	 * listed twice in one BulkMoveTo.
	 */
	private readonly parking = new Set<PlaceholderModel>();
	private readonly spriteParking = new Set<SpriteView>();
	private readonly moveParts = new Array<BasePart>();
	private readonly moveCFrames = new Array<CFrame>();
	private readonly players = new Array<PlayerView>();
	private readonly basis: IsoBasis = isoBasis(degToRad(CAMERA_YAW_DEG), degToRad(CAMERA_PITCH_DEG));
	/** Animation clock: sim seconds of the last frame, and the state it was read from (a new run restarts it). */
	private lastSimSec: number | undefined;
	private lastState: SimState | undefined;
	private dtSec = 0;
	private swordIndex: number | undefined;

	constructor(private readonly sim: SimController, private readonly theme: ThemeController) {}

	onStart(): void {
		const pack = this.theme.getPack();
		this.pack = pack;
		const folder = new Instance("Folder");
		folder.Name = ACTOR_VIEW.folderName;
		folder.Parent = Workspace;
		this.folder = folder;
		this.players.push(this.buildPlayerView(pack, folder));

		RunService.BindToRenderStep(RENDER_STEP, Enum.RenderPriority.Camera.Value + RENDER_ORDER.viewsAfterCamera, () =>
			this.frame(),
		);
	}

	private frame(): void {
		const state = this.sim.getState();
		if (state === undefined) return;
		const alpha = this.sim.getAlpha();
		const simSec = (state.tick + alpha) / SIM_HZ;
		this.dtSec = animDtSec(state === this.lastState ? this.lastSimSec : undefined, simSec);
		this.lastSimSec = simSec;
		this.lastState = state;
		this.moveParts.clear();
		this.moveCFrames.clear();
		this.drawPlayers(state, alpha);

		const actors = state.combat.actors;
		const n = actors.size();
		for (let slot = 0; slot < n; slot++) {
			const a = actors[slot];
			let view = this.views[slot];
			if (a.kind === NO_KIND) {
				if (view !== undefined) this.release(slot, view);
				continue;
			}
			if (view === undefined || view.kind !== a.kind || view.id !== a.id) {
				if (view !== undefined) this.release(slot, view);
				view = this.acquire(slot, a);
			}
			this.drawActor(view, a, state.tick, alpha);
		}
		for (let slot = n; slot < this.viewSlots; slot++) {
			const view = this.views[slot];
			if (view !== undefined) this.release(slot, view);
		}
		for (const model of this.parking) this.place(model, PARKED);
		this.parking.clear();
		for (const sprite of this.spriteParking) {
			sprite.park();
			this.moveParts.push(sprite.anchor);
			this.moveCFrames.push(PARKED);
		}
		this.spriteParking.clear();
		if (this.moveParts.size() > 0) {
			Workspace.BulkMoveTo(this.moveParts, this.moveCFrames, Enum.BulkMoveMode.FireCFrameChanged);
		}
	}

	private place(model: PlaceholderModel, origin: CFrame): void {
		for (const piece of model.pieces) {
			this.moveParts.push(piece.part);
			this.moveCFrames.push(origin.mul(piece.offset));
		}
	}

	/** The pack's sprite set for a visual ID (cached), undefined for the placeholder path. */
	private spriteSet(id: string): SpriteSet | undefined {
		let set = this.spriteSets.get(id);
		if (set === undefined) {
			set = this.pack!.sprites(id) ?? false;
			this.spriteSets.set(id, set);
		}
		return set === false ? undefined : set;
	}

	private lookColor(pack: ThemePack, look: ActorLook): Color3 | undefined {
		return look === "normal" ? undefined : pack.color(ACTOR_VIEW.lookRoles[look]);
	}

	private acquire(slot: number, a: Readonly<ActorState>): ActorView {
		const pack = this.pack!;
		const def = archetypeAt(a.kind);
		const id = def.data.spriteId;
		const corpseTicks = def.data.corpseTicks ?? CORPSE_TICKS;
		const spriteInput = ACTOR_SPRITE_INPUTS.get(def.id);
		const set = spriteInput !== undefined ? this.spriteSet(id) : undefined;
		let view: ActorView;
		if (set !== undefined) {
			const key = SPRITE_KEY + id;
			const sprite = this.freeSprites.get(key)?.pop() ?? new SpriteView(set, this.folder!);
			this.spriteParking.delete(sprite);
			sprite.reset();
			view = {
				kind: a.kind,
				id: a.id,
				model: undefined,
				sprite,
				spriteInput,
				look: "normal",
				transparency: 0,
				corpseTicks,
			};
		} else {
			const visual = pack.placeholder(id);
			let scale = def.data.spriteScale ?? 1;
			if (def.data.boss === true && visual.cellPx.w * scale < ACTOR_VIEW.bossMinDrawPx) {
				scale = ACTOR_VIEW.bossMinDrawPx / visual.cellPx.w;
			}
			const key = `${id}@${scale}`;
			const model = this.free.get(key)?.pop() ?? buildPlaceholder(pack, key, visual, scale, this.folder!, true);
			this.parking.delete(model);
			setModelColor(model, model.baseColor);
			setModelTransparency(model, 0);
			view = {
				kind: a.kind,
				id: a.id,
				model,
				sprite: undefined,
				spriteInput: undefined,
				look: "normal",
				transparency: 0,
				corpseTicks,
			};
		}
		this.views[slot] = view;
		this.viewSlots = math.max(this.viewSlots, slot + 1);
		return view;
	}

	private release(slot: number, view: ActorView): void {
		this.views[slot] = undefined;
		const sprite = view.sprite;
		if (sprite !== undefined) {
			this.spriteParking.add(sprite);
			pushFree(this.freeSprites, SPRITE_KEY + sprite.set.id, sprite);
			return;
		}
		const model = view.model!;
		this.parking.add(model);
		pushFree(this.free, model.visualId, model);
	}

	private drawActor(view: ActorView, a: Readonly<ActorState>, tick: number, alpha: number): void {
		const pack = this.pack!;
		const x = studsX(lerp(a.prevX, a.x, alpha));
		const z = studsZ(lerp(a.prevZ, a.z, alpha));
		const at = new Vector3(x, floorStudsY() + ACTOR_VIEW.liftStuds, z);
		const look = actorLook(a.alive, a.flashTicks, a.aiState, tick);
		const transparency = corpseTransparency(a.alive, a.deadTicks, view.corpseTicks);

		const sprite = view.sprite;
		if (sprite !== undefined) {
			this.moveParts.push(sprite.anchor);
			this.moveCFrames.push(new CFrame(at));
			const choice = chooseActorAnim(view.spriteInput!(a, alpha), sprite.set);
			sprite.update(choice, a.faceX, a.faceZ, this.basis, this.dtSec);
			if (look !== view.look) {
				view.look = look;
				sprite.setTint(this.lookColor(pack, look) ?? SPRITE_TINT_NONE);
			}
			sprite.setTransparency(transparency);
			return;
		}

		const model = view.model!;
		const origin =
			model.faces && (a.faceX !== 0 || a.faceZ !== 0)
				? CFrame.lookAlong(at, new Vector3(a.faceX, 0, a.faceZ))
				: new CFrame(at);
		this.place(model, origin);
		if (look !== view.look) {
			view.look = look;
			setModelColor(model, this.lookColor(pack, look) ?? model.baseColor);
		}
		if (transparency !== view.transparency) {
			view.transparency = transparency;
			setModelTransparency(model, transparency);
		}
	}

	private buildPlayerView(pack: ThemePack, folder: Folder): PlayerView {
		const set = this.spriteSet(ACTOR_VIEW.playerVisualId);
		const sprite = set !== undefined ? new SpriteView(set, folder) : undefined;
		const model =
			set === undefined
				? buildPlaceholder(
						pack,
						ACTOR_VIEW.playerVisualId,
						pack.placeholder(ACTOR_VIEW.playerVisualId),
						1,
						folder,
						true,
				  )
				: undefined;
		const pipVisual = pack.placeholder(ACTOR_VIEW.facingPipVisualId);
		const pip = renderPart("Part", false);
		pip.Name = "FacingPip";
		pip.Size = new Vector3(pipVisual.size[0] * PIP_SCALE, PIP_THICKNESS, pipVisual.size[0] * PIP_SCALE);
		pip.Color = pack.visualColor(pipVisual.color);
		pip.Material = Enum.Material[pipVisual.material];
		pip.Parent = folder;
		return {
			model,
			sprite,
			pip,
			ring: set !== undefined ? buildRing(pack, set, folder) : undefined,
			look: "normal",
			transparency: 0,
		};
	}

	/** Every player (co-op: each party member, index order); views beyond the party are parked. */
	private drawPlayers(state: SimState, alpha: number): void {
		const pack = this.pack;
		const folder = this.folder;
		if (pack === undefined || folder === undefined) return;
		const n = partySize(state);
		while (this.players.size() < n) this.players.push(this.buildPlayerView(pack, folder));
		const localIndex = this.sim.getLocalPlayerIndex();
		for (let i = 0; i < this.players.size(); i++) {
			const view = this.players[i];
			if (i < n) {
				this.drawPlayer(view, state, i, alpha, pack, i === localIndex);
				continue;
			}
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
	}

	private drawPlayer(
		view: PlayerView,
		state: SimState,
		index: number,
		alpha: number,
		pack: ThemePack,
		isLocal: boolean,
	): void {
		const p = playerAt(state, index);
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

		const sprite = view.sprite;
		if (sprite !== undefined) {
			this.moveParts.push(sprite.anchor);
			this.moveCFrames.push(new CFrame(at));
			const input = playerSpriteInput(
				p,
				weaponsAt(state, index),
				state.tick,
				alpha,
				this.sword(),
				swordTimingOf(state, index),
			);
			sprite.update(choosePlayerAnim(input, sprite.set), dirX, dirZ, this.basis, this.dtSec);
			if (look !== view.look) {
				view.look = look;
				// Dead: the death animation shows it (the placeholder greys out instead).
				sprite.setTint(look === "dead" ? SPRITE_TINT_NONE : this.lookColor(pack, look) ?? SPRITE_TINT_NONE);
			}
			sprite.setVisible(visible);
		} else {
			this.drawPlayerModel(view, p, at, dirX, dirZ, dead, rolling, alpha, pack, look, visible);
		}

		const ring = view.ring;
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
			return;
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
			const t = math.clamp((ROLL_TICKS - p.rollTicks + alpha) / ROLL_TICKS, 0, 1);
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

	/** Destroys every pooled view (not used in play; kept for tests / teardown). */
	destroy(): void {
		for (const [, list] of this.free) for (const m of list) destroyModel(m);
		this.free.clear();
		for (const [, list] of this.freeSprites) for (const s of list) s.destroy();
		this.freeSprites.clear();
	}
}

function pushFree<T extends defined>(free: Map<string, T[]>, key: string, item: T): void {
	const list = free.get(key);
	if (list !== undefined) list.push(item);
	else free.set(key, [item]);
}

/**
 * The `ui.ring.player` image as a Decal on a flat, invisible floor Part, sized from the player set's texel density
 * (shared/view floorImageSize), or undefined when the pack has no such image.
 */
function buildRing(pack: ThemePack, set: SpriteSet, folder: Folder): Ring | undefined {
	const image = pack.image(ACTOR_VIEW.ringVisualId);
	if (image === undefined) return undefined;
	const [w, d] = floorImageSize(image.w, image.h, set.pixelsPerTile);
	const [ox, oz] = floorImageOffset(image.w, image.h, set.pixelsPerTile, image.pivot);
	const part = renderPart("Part", false);
	part.Name = "PlayerRing";
	part.Transparency = HIDDEN;
	part.Size = new Vector3(w, SPRITE_VIEW.ringThicknessStuds, d);
	part.CFrame = PARKED;
	const decal = new Instance("Decal");
	decal.Face = Enum.NormalId.Top;
	decal.Texture = image.assetId;
	decal.Parent = part;
	part.Parent = folder;
	return { part, decal, offset: new CFrame(ox, 0, oz), color: undefined };
}
