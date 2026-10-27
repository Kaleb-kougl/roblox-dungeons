import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
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
	ACTOR_OUTLINE,
	ACTOR_SPRITE_INPUTS,
	ACTOR_VIEW,
	BULLET_VIEW,
	RENDER_ORDER,
	SPRITE_VIEW,
	actorGroup,
	actorLook,
	actorOutlined,
	animDtSec,
	bossSpriteLayout,
	chooseActorAnim,
	choosePlayerAnim,
	corpseTransparency,
	degToRad,
	floorImageOffset,
	floorImageSize,
	floorStudsY,
	isoBasis,
	lerp,
	outlineSwitchOn,
	playerBlinkVisible,
	playerLook,
	playerSpriteInput,
	studsX,
	studsZ,
	swordTimingOf,
	type ActorGroup,
	type ActorLook,
	type ActorSpriteInput,
	type IsoBasis,
} from "shared/view";
import {
	FEEL_HIT,
	HitReactSlots,
	freezeFrameOn,
	motionScale,
	nearestLivingPlayer,
	pushOffsetStuds,
	type FxEventBuffer,
} from "shared/view/fx";
import type { JuiceSettings } from "shared/settings";
import { FxTrackerController } from "../fx/FxTrackerController";
import { SimController } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import {
	buildPlaceholder,
	destroyModel,
	renderPart,
	setModelColor,
	setModelParent,
	setModelTransparency,
	type PlaceholderModel,
} from "./placeholders";
import { SPRITE_TINT_NONE, SpriteView } from "./SpriteView";
import { MotionFx } from "./motionFx";

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
	/** The placeholder visual has an outline role (enemies and bosses; shared/view actorGroup). Sprite views: the
	 * SpriteView was built with the rim (plan O4). */
	hasOutline: boolean;
	/** The model's pieces are under the enemies Model (the shared Highlight), not corpses. Sprite views: false. */
	outlined: boolean;
	/** Hit reaction (docs/FEEL.md J5), placeholder views only: the pieces are under the flashing Model; the push in
	 * texels and as the world offset added to the model's origin. */
	flashing: boolean;
	pushX: number;
	pushY: number;
	push: Vector3;
}

/**
 * Every actor and the player, drawn from sim state (web ActorsView + PlayerView). Per ID, one of two paths:
 *
 * Sprites (docs/ART.md S4): when the pack has a `sprites` set for the ID (`pack.sprites(id)`) and, for actors, the
 * archetype has a sprite input builder (shared/view ACTOR_SPRITE_INPUTS: the swarmer, the sniper, the tutorial's
 * turret.sniper, the bruiser, Mother Bramble and the Demon Lord), a pooled SpriteView (BillboardGui on a feet anchor)
 * shows the animation chosen from sim state (shared/view sprites.ts) in the facing nearest the sim's facing on screen;
 * juice through the label: hit flash / telegraph pulse / i-frame tints (ImageColor3), corpse fade (ImageTransparency),
 * the post-hit blink (Visible). A boss sprite (data.boss: Mother Bramble, the Demon Lord) is drawn at least
 * ACTOR_VIEW.bossMinDrawPx wide (shared/view bossSpriteLayout, the placeholder bosses' rule; both sets already are, so
 * neither changes), and a sprite's corpse fade starts at its input's `corpseFadeFrom` (the Demon Lord's
 * SPRITE_VIEW.bossCorpseFadeFrom: his death plays first; everyone else fades over the whole corpse time); its baked
 * rim follows the placeholder's outline role like every enemy's. The player's ring (`ui.ring.player`, tinted uiAccent
 * for the local player, uiTextDim for teammates) replaces the facing pip when the pack has it.
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
 *
 * Enemy outlines (enemy outline plan O2, shared/view outline.ts): the folder has three children (ACTOR_OUTLINE.groups).
 * `Enemies` is a Model with ONE Highlight (rim only, `enemyOutline`, Occluded) holding the pieces of every living
 * placeholder enemy / boss whose visual has an outline role; `Corpses` takes them the first frame the actor is dead
 * (shared/view actorGroup; once, tracked in ActorView.outlined) and holds every released, pooled model; `Players` holds
 * the party's views. Enemy sprite anchors stay in the folder itself: their rim is baked (plan O4), the outline sheet in
 * the SpriteView's "Outline" label, tinted the same role, shown while shared/view actorOutlined. Workspace
 * KV_EnemyOutline = false turns the Highlight and the sprite rims off (read on change, never per frame).
 */
@Controller({})
export class ActorRenderController implements OnStart {
	private folder: Folder | undefined;
	/** The folder's children: the outlined enemies Model, corpses and players (ACTOR_OUTLINE.groups). */
	private groups: Readonly<Record<ActorGroup, Instance>> | undefined;
	private readonly janitor = new Janitor();
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
	/** The KV_EnemyOutline debug switch (outlineSwitchOn), read on change: the Highlight's Enabled and sprite rims. */
	private outlineOn = true;
	/** Squash & stretch and afterimages (docs/FEEL.md J6 / J7; ./motionFx.ts), built in onStart. */
	private motion: MotionFx | undefined;

	// --- hit reaction (docs/FEEL.md J4 / J5) ---------------------------------------------------
	private readonly hitReact = new HitReactSlots(this.basis);
	/** The hit-reaction clock (s): real frame time, stopped while paused, not slowed by the hitstop clock. */
	private hitNow = 0;
	private hitMotion = 1;
	private hitFlashColor = SPRITE_TINT_NONE;
	/** KV_Actors/Flashing: the flashing placeholder bodies, under ONE fill Highlight (J5). */
	private flashingModel: Model | undefined;
	private readonly hitToward = { x: 0, z: 0 };
	private readonly pushScratch = [0, 0, 0];

	constructor(
		private readonly sim: SimController,
		private readonly theme: ThemeController,
		private readonly fx: FxTrackerController,
	) {}

	onStart(): void {
		const pack = this.theme.getPack();
		this.pack = pack;
		const folder = new Instance("Folder");
		folder.Name = ACTOR_VIEW.folderName;
		folder.Parent = Workspace;
		this.folder = folder;
		const enemies = new Instance("Model");
		enemies.Name = ACTOR_OUTLINE.groups.enemies;
		enemies.Parent = folder;
		const corpses = new Instance("Folder");
		corpses.Name = ACTOR_OUTLINE.groups.corpses;
		corpses.Parent = folder;
		const players = new Instance("Folder");
		players.Name = ACTOR_OUTLINE.groups.players;
		players.Parent = folder;
		this.groups = { enemies, corpses, players };
		const highlight = buildOutline(pack, enemies);
		const syncSwitch = () => {
			this.outlineOn = outlineSwitchOn(Workspace.GetAttribute(ACTOR_OUTLINE.enabledAttribute));
			highlight.Enabled = this.outlineOn;
		};
		syncSwitch();
		this.janitor.Add(Workspace.GetAttributeChangedSignal(ACTOR_OUTLINE.enabledAttribute).Connect(syncSwitch));
		this.players.push(this.buildPlayerView(pack, players));
		this.startHitReact(pack, folder);
		this.startMotion(folder);

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
		this.motion?.beginFrame(state, this.dtSec, this.fx.settings());
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
			this.applyHitReact(slot, view);
			this.drawActor(view, a, state.tick, alpha);
			this.motionActor(slot, view, a, alpha);
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
		this.motion?.endFrame(this.moveParts, this.moveCFrames);
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
			// The baked rim (plan O4) follows the placeholder visual's outline role, like the Highlight (O2). It depends
			// on the ID alone, so the pool key needs nothing more.
			const hasOutline = pack.placeholder(id).outline !== undefined;
			const boss = def.data.boss === true;
			const key = SPRITE_KEY + id;
			const sprite =
				this.freeSprites.get(key)?.pop() ??
				new SpriteView(
					set,
					this.folder!,
					boss ? bossSpriteLayout(set, ACTOR_VIEW.bossMinDrawPx) : set,
					0,
					hasOutline ? pack.color(ACTOR_OUTLINE.role) : undefined,
				);
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
				hasOutline,
				outlined: false,
				flashing: false,
				pushX: 0,
				pushY: 0,
				push: Vector3.zero,
			};
		} else {
			const visual = pack.placeholder(id);
			let scale = def.data.spriteScale ?? 1;
			if (def.data.boss === true && visual.cellPx.w * scale < ACTOR_VIEW.bossMinDrawPx) {
				scale = ACTOR_VIEW.bossMinDrawPx / visual.cellPx.w;
			}
			const key = `${id}@${scale}`;
			const hasOutline = visual.outline !== undefined;
			const group = actorGroup(hasOutline, a.alive !== 0);
			const parent = this.groups![group];
			const model = this.free.get(key)?.pop() ?? buildPlaceholder(pack, key, visual, scale, parent, true);
			// Pooled models wait under corpses; an outlined actor's go under the shared Highlight.
			setModelParent(model, parent);
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
				hasOutline,
				outlined: group === "enemies",
				flashing: false,
				pushX: 0,
				pushY: 0,
				push: Vector3.zero,
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
		// Off the Highlight while pooled (a slot freed alive, e.g. on a floor change): the next acquire puts it back.
		if (view.outlined || view.flashing) setModelParent(model, this.groups!.corpses);
		this.parking.add(model);
		pushFree(this.free, model.visualId, model);
	}

	private drawActor(view: ActorView, a: Readonly<ActorState>, tick: number, alpha: number): void {
		const pack = this.pack!;
		const x = studsX(lerp(a.prevX, a.x, alpha));
		const z = studsZ(lerp(a.prevZ, a.z, alpha));
		const at = new Vector3(x, floorStudsY() + ACTOR_VIEW.liftStuds, z);
		const look = actorLook(a.alive, a.flashTicks, a.aiState, tick);

		const sprite = view.sprite;
		if (sprite !== undefined) {
			this.moveParts.push(sprite.anchor);
			this.moveCFrames.push(new CFrame(at));
			const input = view.spriteInput!(a, alpha);
			const choice = chooseActorAnim(input, sprite.set);
			const transparency = corpseTransparency(a.alive, a.deadTicks, view.corpseTicks, input.corpseFadeFrom);
			sprite.update(choice, a.faceX, a.faceZ, this.basis, this.dtSec);
			if (look !== view.look) {
				view.look = look;
				sprite.setTint(this.lookColor(pack, look) ?? SPRITE_TINT_NONE);
			}
			sprite.setTransparency(transparency);
			// The rim goes the frame the actor dies (the corpse fades without it) and with KV_EnemyOutline = false.
			sprite.setOutlineShown(actorOutlined(view.hasOutline, a.alive !== 0, this.outlineOn));
			return;
		}

		const transparency = corpseTransparency(a.alive, a.deadTicks, view.corpseTicks);
		const model = view.model!;
		// A corpse drops the outline the first frame it is dead (once: only a change of group reparents).
		const outlined = actorGroup(view.hasOutline, a.alive !== 0) === "enemies";
		if (outlined !== view.outlined) {
			view.outlined = outlined;
			this.syncModelGroup(view, model);
		}
		const origin =
			model.faces && (a.faceX !== 0 || a.faceZ !== 0)
				? CFrame.lookAlong(at, new Vector3(a.faceX, 0, a.faceZ))
				: new CFrame(at);
		this.place(model, view.pushX === 0 && view.pushY === 0 ? origin : origin.add(view.push));
		if (look !== view.look) {
			view.look = look;
			setModelColor(model, this.lookColor(pack, look) ?? model.baseColor);
		}
		if (transparency !== view.transparency) {
			view.transparency = transparency;
			setModelTransparency(model, transparency);
		}
	}

	private buildPlayerView(pack: ThemePack, folder: Instance): PlayerView {
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
		const folder = this.groups?.players;
		if (pack === undefined || folder === undefined) return;
		const n = partySize(state);
		while (this.players.size() < n) this.players.push(this.buildPlayerView(pack, folder));
		const localIndex = this.sim.getViewPlayerIndex(); // co-op spectating: the watched player gets the local ring
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
			this.motion?.player(index, sprite, p, at);
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

	// ---------------------------------------------------------------------------------------------
	// Motion feel (docs/FEEL.md J6 squash & stretch, J7 afterimages): ./motionFx.ts does the work.

	/** Builds the ghost pool under the actor folder and feeds it the tracker's hit / spawned / killed events. */
	private startMotion(folder: Folder): void {
		const motion = new MotionFx(folder);
		this.motion = motion;
		this.fx.onEvent((e) => motion.onFxEvent(e));
		this.janitor.Add(() => motion.destroy(), true);
	}

	/** A sprite actor's squash (and the Demon Lord's charge ghosts), after drawActor updated its frame. */
	private motionActor(slot: number, view: ActorView, a: Readonly<ActorState>, alpha: number): void {
		const sprite = view.sprite;
		const motion = this.motion;
		if (sprite === undefined || motion === undefined) return;
		const x = studsX(lerp(a.prevX, a.x, alpha));
		const z = studsZ(lerp(a.prevZ, a.z, alpha));
		motion.actor(slot, sprite, a, x, floorStudsY() + ACTOR_VIEW.liftStuds, z);
	}

	/** The sword's weapon index (resolved once; NO_WEAPON if it is not registered). */
	private sword(): number {
		if (this.swordIndex === undefined) {
			const [ok, index] = pcall(() => weaponIndex(SWORD.id));
			this.swordIndex = ok ? (index as number) : NO_WEAPON;
		}
		return this.swordIndex;
	}

	// --- hit reaction (docs/FEEL.md J4 / J5) ---------------------------------------------------

	/**
	 * The flashing Model (a sibling of the enemies Model) with its ONE Highlight, and the tracker feed. The Highlight
	 * fills in FEEL_HIT.flashRole; its rim is the enemies Highlight's while KV_EnemyOutline is on and hidden while it
	 * is off (the flash itself always shows, like the sprites' rim flash).
	 */
	private startHitReact(pack: ThemePack, folder: Folder): void {
		this.hitFlashColor = pack.color(FEEL_HIT.flashRole);
		const model = new Instance("Model");
		model.Name = FEEL_HIT.flashingGroupName;
		model.Parent = folder;
		this.flashingModel = model;
		const highlight = buildOutline(pack, model);
		highlight.Name = FEEL_HIT.flashingHighlightName;
		highlight.FillColor = this.hitFlashColor;
		highlight.FillTransparency = FEEL_HIT.fillTransparency;
		const syncSwitch = () => {
			const on = outlineSwitchOn(Workspace.GetAttribute(ACTOR_OUTLINE.enabledAttribute));
			highlight.OutlineTransparency = on ? ACTOR_OUTLINE.outlineTransparency : HIDDEN;
		};
		syncSwitch();
		this.janitor.Add(Workspace.GetAttributeChangedSignal(ACTOR_OUTLINE.enabledAttribute).Connect(syncSwitch));
		this.fx.onFrame((events, settings, dt) => this.hitReactFrame(events, settings, dt));
	}

	/** Once per frame after the tracker: advance the hit-reaction clock, then feed the frame's events. */
	private hitReactFrame(events: FxEventBuffer, settings: Readonly<JuiceSettings>, dt: number): void {
		if (this.sim.getContext()?.live?.isPaused() !== true) {
			this.hitNow += math.min(math.max(dt, 0), FEEL_HIT.maxFrameDtSec);
		}
		this.hitMotion = motionScale(settings);
		const state = this.sim.getState();
		const alpha = this.sim.getAlpha();
		const now = this.hitNow;
		const killHolds = freezeFrameOn(settings);
		for (let i = 0; i < events.count(); i++) {
			const e = events.at(i);
			const toward =
				e.type === "hit" && state !== undefined && nearestLivingPlayer(state, alpha, e.x, e.z, this.hitToward)
					? this.hitToward
					: undefined;
			this.hitReact.onEvent(e, now, toward, killHolds);
		}
	}

	/** Slot `slot`'s hit look onto its view, before drawActor (a held sprite must not step this frame). */
	private applyHitReact(slot: number, view: ActorView): void {
		const look = this.hitReact.look(slot, view.id, this.hitNow, this.hitMotion);
		const sprite = view.sprite;
		if (sprite !== undefined) {
			sprite.setRimFlash(look.rimFlash ? this.hitFlashColor : undefined);
			sprite.setHold(look.hold);
			sprite.setPushTexels(look.pushX, look.pushY, this.basis);
			return;
		}
		// Placeholders: no sprite clock to hold; the push offsets the model, the flash reparents it (on change only).
		if (look.pushX !== view.pushX || look.pushY !== view.pushY) {
			view.pushX = look.pushX;
			view.pushY = look.pushY;
			const o = pushOffsetStuds(look.pushX, look.pushY, this.basis, this.pushScratch);
			view.push = new Vector3(o[0], o[1], o[2]);
		}
		if (look.rimFlash !== view.flashing && this.flashingModel !== undefined) {
			view.flashing = look.rimFlash;
			this.syncModelGroup(view, view.model!);
		}
	}

	/** A placeholder's pieces to their group: flashing while the hit flash runs, else enemies / corpses. */
	private syncModelGroup(view: ActorView, model: PlaceholderModel): void {
		const parent =
			view.flashing && this.flashingModel !== undefined
				? this.flashingModel
				: this.groups![view.outlined ? "enemies" : "corpses"];
		setModelParent(model, parent);
	}

	/** Destroys every pooled view (not used in play; kept for tests / teardown). */
	destroy(): void {
		for (const [, list] of this.free) for (const m of list) destroyModel(m);
		this.free.clear();
		for (const [, list] of this.freeSprites) for (const s of list) s.destroy();
		this.freeSprites.clear();
		this.janitor.Cleanup();
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
function buildRing(pack: ThemePack, set: SpriteSet, folder: Instance): Ring | undefined {
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

/**
 * The shared enemy outline (shared/view ACTOR_OUTLINE): one Highlight on the enemies Model, rim only, in the pack's
 * outline role, hidden behind walls like the bodies.
 */
function buildOutline(pack: ThemePack, enemies: Model): Highlight {
	const highlight = new Instance("Highlight");
	highlight.Name = ACTOR_OUTLINE.highlightName;
	highlight.FillTransparency = ACTOR_OUTLINE.fillTransparency;
	highlight.OutlineTransparency = ACTOR_OUTLINE.outlineTransparency;
	highlight.OutlineColor = pack.color(ACTOR_OUTLINE.role);
	highlight.DepthMode = Enum.HighlightDepthMode[ACTOR_OUTLINE.depthMode];
	highlight.Adornee = enemies;
	highlight.Parent = enemies;
	return highlight;
}
