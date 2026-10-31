import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { RunService, Workspace } from "@rbxts/services";
import { clientStore, selectDisplay } from "client/store";
import { CAMERA_PITCH_DEG, CAMERA_YAW_DEG, STUDS_PER_TILE } from "shared/config";
import { AffixKind, affixThemeIndex } from "shared/dungeon";
import {
	CORPSE_TICKS,
	MAX_ACTORS,
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
import { AFFIX_IDS, ENEMY_SHIELD_ROLE, affixRole, type SpriteSet, type ThemePack } from "shared/theme";
import {
	ACTOR_OUTLINE,
	ACTOR_SPRITE_INPUTS,
	ACTOR_VIEW,
	AFFIX_VIEW,
	BULLET_VIEW,
	PLAYER_OUTLINE,
	RENDER_ORDER,
	SPRITE_VIEW,
	actorGroup,
	actorLook,
	actorOutlined,
	actorSpriteScale,
	affixDrawScale,
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
	playerOutlined,
	playerSpriteInput,
	scaledSpriteLayout,
	studsX,
	studsZ,
	swordTimingOf,
	variantLook,
	vengefulArmed,
	vengefulCorpseView,
	vengefulPulseOn,
	viewAffix,
	ShieldFlashWatch,
	type ActorGroup,
	type ActorLook,
	type ActorSpriteInput,
	type IsoBasis,
	type VariantLook,
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
	/** The placeholder capsule sits under the player-outline Model (shared/view playerOutlined; changes reparent). */
	outlined: boolean;
}

interface ActorView {
	kind: number;
	id: number;
	/** Exactly one of model / sprite is set. */
	model: PlaceholderModel | undefined;
	sprite: SpriteView | undefined;
	/** The archetype's sprite input builder (sprite views only). */
	spriteInput: ((a: Readonly<ActorState>, alpha: number) => ActorSpriteInput) | undefined;
	/** The free-list key the view goes back to (sprites: set id and draw scale; placeholders: the model's visualId). */
	poolKey: string;
	look: VariantLook;
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
 * turret.sniper, M1's turret.sprayer / turret.caster, the bruiser, Mother Bramble and the Demon Lord), a pooled
 * SpriteView (BillboardGui on a feet anchor) shows the animation chosen from sim state (shared/view sprites.ts) in the
 * facing nearest the sim's facing on screen;
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
 *
 * Player outline (docs/PLAYER_OUTLINE.md, shared/view PLAYER_OUTLINE): the watched player only (getViewPlayerIndex, so a
 * spectator sees it on the teammate they watch), alive, while Options > Display > Player outline and Workspace
 * KV_PlayerOutline are on (shared/view playerOutlined). Every player's SpriteView is built with the `playerOutline`
 * rim (the knight's baked 1 px outline sheets) and shows it while playerOutlined. A placeholder capsule moves into
 * `Players/Outlined`, a Model with ONE Highlight (rim only, Occluded), while playerOutlined (reparented only on a
 * change); the Highlight is Enabled while that player is also visible, so the post-hit blink blinks the rim too.
 *
 * Enemy variants (docs/ENEMY_VARIANTS.md EV9; rules in shared/view variants.ts): the imp / Ooze / summoner draw through
 * the same two paths (Cone / Dome placeholders; ACTOR_SPRITE_INPUTS once their sets land; `slime.small` wears the
 * Ooze's set at its spriteScale). Elite affixes, never through a Highlight (EVD12): a Hulking actor is drawn at radius /
 * data radius (affixDrawScale, in both pool keys); an affixed sprite's baked rim is tinted `affix.<id>`; a shield hit
 * (ShieldFlashWatch) tints the body / flashes the rim in enemyShield; a Vengeful corpse (EVD16) is drawn as long as the
 * sim holds it (vengefulCorpseView: opaque, then a short fade) and pulses in the telegraph look while its ring is
 * pending. The floor ring is AffixRingController's.
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
	/** Player outline (docs/PLAYER_OUTLINE.md): DisplaySettings.playerOutline and KV_PlayerOutline, read on change. */
	private playerOutlineSetting = true;
	private playerOutlineOn = true;
	/** Players/Outlined: the outlined placeholder capsule's Model, and its ONE Highlight. */
	private outlinedPlayers: Model | undefined;
	private playerHighlight: Highlight | undefined;
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

	// --- elite affixes (docs/ENEMY_VARIANTS.md EV9) ----------------------------------------------
	/** Shield hits from a per-frame diff of state.affixes (the body flashes in enemyShield). */
	private readonly shieldWatch = new ShieldFlashWatch(MAX_ACTORS);
	/** `affix.<id>` per AFFIX_IDS index (the sprite rim's tint), enemyShield, and the plain rim (enemyOutline). */
	private affixColors = new Array<Color3>();
	private shieldColor = SPRITE_TINT_NONE;
	private outlineColor = SPRITE_TINT_NONE;

	constructor(
		private readonly sim: SimController,
		private readonly theme: ThemeController,
		private readonly fx: FxTrackerController,
	) {}

	onStart(): void {
		const pack = this.theme.getPack();
		this.pack = pack;
		this.affixColors = AFFIX_IDS.map((id) => pack.color(affixRole(id)));
		this.shieldColor = pack.color(ENEMY_SHIELD_ROLE);
		this.outlineColor = pack.color(ACTOR_OUTLINE.role);
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
		this.startPlayerOutline(pack, players);
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
		this.shieldWatch.update(state);

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
				view = this.acquire(slot, a, state);
			}
			const shieldFlash = this.shieldWatch.flashing(slot, a.id, state.tick);
			this.applyHitReact(slot, view, shieldFlash);
			this.drawActor(view, a, slot, state, shieldFlash, alpha);
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

	private lookColor(pack: ThemePack, look: VariantLook): Color3 | undefined {
		if (look === "shield") return this.shieldColor;
		return look === "normal" ? undefined : pack.color(ACTOR_VIEW.lookRoles[look]);
	}

	private acquire(slot: number, a: Readonly<ActorState>, state: SimState): ActorView {
		const pack = this.pack!;
		const def = archetypeAt(a.kind);
		const id = def.data.spriteId;
		const corpseTicks = def.data.corpseTicks ?? CORPSE_TICKS;
		const spriteInput = ACTOR_SPRITE_INPUTS.get(def.id);
		const set = spriteInput !== undefined ? this.spriteSet(id) : undefined;
		// Hulking (docs/ENEMY_VARIANTS.md EV9): drawn radius / data radius; it is stamped before init, so final here.
		const affixScale =
			viewAffix(state, slot, a.id) === AffixKind.HULKING ? affixDrawScale(a.radius, def.data.radius) : 1;
		let view: ActorView;
		if (set !== undefined) {
			// The baked rim (plan O4) follows the placeholder visual's outline role, like the Highlight (O2). It depends
			// on the ID alone; the draw scale (slime.small's spriteScale, Hulking) is in the pool key.
			const hasOutline = pack.placeholder(id).outline !== undefined;
			const boss = def.data.boss === true;
			const scale = actorSpriteScale(def.id, def.data.spriteScale, affixScale);
			const key = `${SPRITE_KEY}${id}@${scale}`;
			const sprite =
				this.freeSprites.get(key)?.pop() ??
				new SpriteView(
					set,
					this.folder!,
					scaledSpriteLayout(boss ? bossSpriteLayout(set, ACTOR_VIEW.bossMinDrawPx) : set, scale),
					0,
					hasOutline ? this.outlineColor : undefined,
				);
			this.spriteParking.delete(sprite);
			sprite.reset();
			view = {
				kind: a.kind,
				id: a.id,
				model: undefined,
				sprite,
				spriteInput,
				poolKey: key,
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
			scale *= affixScale;
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
				poolKey: key,
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
			pushFree(this.freeSprites, view.poolKey, sprite);
			return;
		}
		const model = view.model!;
		// Off the Highlight while pooled (a slot freed alive, e.g. on a floor change): the next acquire puts it back.
		if (view.outlined || view.flashing) setModelParent(model, this.groups!.corpses);
		this.parking.add(model);
		pushFree(this.free, model.visualId, model);
	}

	private drawActor(
		view: ActorView,
		a: Readonly<ActorState>,
		slot: number,
		state: SimState,
		shieldFlash: boolean,
		alpha: number,
	): void {
		const pack = this.pack!;
		const tick = state.tick;
		const x = studsX(lerp(a.prevX, a.x, alpha));
		const z = studsZ(lerp(a.prevZ, a.z, alpha));
		const at = new Vector3(x, floorStudsY() + ACTOR_VIEW.liftStuds, z);
		// Elite affixes (docs/ENEMY_VARIANTS.md EV9): the rim's tint, the shield-hit flash, a Vengeful corpse's length
		// (EVD16: held while its ring is pending, then a short fade) and its telegraph pulse.
		const affix = viewAffix(state, slot, a.id);
		const vengefulCorpse = a.alive === 0 && affix === AffixKind.VENGEFUL && state.affixes !== undefined;
		const corpse = vengefulCorpse
			? vengefulCorpseView(
					view.corpseTicks,
					state.affixes!.config.vengefulTelegraphTicks,
					AFFIX_VIEW.vengefulFadeTicks,
			  )
			: undefined;
		const pulse = vengefulCorpse && vengefulArmed(state, slot, a.id) && vengefulPulseOn(tick);
		const look = variantLook(actorLook(a.alive, a.flashTicks, a.aiState, tick), a.alive, pulse, shieldFlash);

		const sprite = view.sprite;
		if (sprite !== undefined) {
			this.moveParts.push(sprite.anchor);
			this.moveCFrames.push(new CFrame(at));
			let input = view.spriteInput!(a, alpha);
			if (corpse !== undefined) {
				// The death keeps its own span; only the fade follows the held corpse.
				const deathTicks = input.deathTicks ?? input.corpseTicks * SPRITE_VIEW.deathCorpseFraction;
				input = { ...input, corpseTicks: corpse.corpseTicks, corpseFadeFrom: corpse.fadeFrom, deathTicks };
			}
			const choice = chooseActorAnim(input, sprite.set);
			const transparency =
				corpse !== undefined
					? corpseTransparency(a.alive, a.deadTicks, corpse.corpseTicks, corpse.fadeFrom)
					: corpseTransparency(a.alive, a.deadTicks, view.corpseTicks, input.corpseFadeFrom);
			sprite.update(choice, a.faceX, a.faceZ, this.basis, this.dtSec);
			if (look !== view.look) {
				view.look = look;
				sprite.setTint(this.lookColor(pack, look) ?? SPRITE_TINT_NONE);
			}
			sprite.setTransparency(transparency);
			if (view.hasOutline) {
				const k = affixThemeIndex(affix);
				sprite.setRimColor(k >= 0 ? this.affixColors[k] ?? this.outlineColor : this.outlineColor);
			}
			// The rim goes the frame the actor dies (the corpse fades without it) and with KV_EnemyOutline = false.
			sprite.setOutlineShown(actorOutlined(view.hasOutline, a.alive !== 0, this.outlineOn));
			return;
		}

		const transparency =
			corpse !== undefined
				? corpseTransparency(a.alive, a.deadTicks, corpse.corpseTicks, corpse.fadeFrom)
				: corpseTransparency(a.alive, a.deadTicks, view.corpseTicks);
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
		// Every player's view carries the player-outline rim; drawPlayer shows it on the watched player only.
		const sprite =
			set !== undefined ? new SpriteView(set, folder, set, 0, pack.color(PLAYER_OUTLINE.role)) : undefined;
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
			outlined: false,
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
		let rimDrawn = false; // the player-outline Highlight: an outlined capsule is drawn this frame
		for (let i = 0; i < this.players.size(); i++) {
			const view = this.players[i];
			if (i < n) {
				if (this.drawPlayer(view, state, i, alpha, pack, i === localIndex)) rimDrawn = true;
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
		// Player outline (docs/PLAYER_OUTLINE.md): the watched, living player while the setting and the switch are on.
		const outlined = playerOutlined(isLocal, dead, this.playerOutlineSetting, this.playerOutlineOn);

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
			sprite.setOutlineShown(outlined);
			this.motion?.player(index, sprite, p, at);
		} else {
			this.drawPlayerModel(view, p, at, dirX, dirZ, dead, rolling, alpha, pack, look, visible);
			this.setPlayerOutlined(view, outlined);
		}
		const rimDrawn = view.model !== undefined && outlined && visible;

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
		const parent = outlined ? this.outlinedPlayers : this.groups?.players;
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

	/** Holds an actor's sprite for `seconds` of the hit-reaction clock (docs/ROOM_CLEAR.md RC5). */
	holdActor(slot: number, actorId: number, seconds: number): void {
		this.hitReact.hold(slot, actorId, this.hitNow + seconds);
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

	/**
	 * Slot `slot`'s hit look onto its view, before drawActor (a held sprite must not step this frame). `shieldFlash`: a
	 * shield hit (docs/ENEMY_VARIANTS.md EV9) flashes a sprite's rim in enemyShield when no hit flash runs.
	 */
	private applyHitReact(slot: number, view: ActorView, shieldFlash: boolean): void {
		const look = this.hitReact.look(slot, view.id, this.hitNow, this.hitMotion);
		const sprite = view.sprite;
		if (sprite !== undefined) {
			sprite.setRimFlash(look.rimFlash ? this.hitFlashColor : shieldFlash ? this.shieldColor : undefined);
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
