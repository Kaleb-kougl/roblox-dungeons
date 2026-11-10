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
	BOW_WEAPON_ID,
	ROLL_TICKS,
	SIM_HZ,
	SWORD,
	archetypeAt,
	partySize,
	weaponIndex,
	type ActorState,
	type PlayerState,
	type SimState,
} from "shared/sim";
import { AFFIX_IDS, ENEMY_AURA_ROLE, ENEMY_SHIELD_ROLE, affixRole, type SpriteSet, type ThemePack } from "shared/theme";
import {
	ACTOR_OUTLINE,
	ACTOR_SPRITE_INPUTS,
	ACTOR_VIEW,
	AFFIX_VIEW,
	AURA_VIEW,
	AuraView,
	BULLET_VIEW,
	NEW_ENEMY_SPRITE_VIEW,
	PLAYER_OUTLINE,
	RENDER_ORDER,
	SPRITE_VIEW,
	actorGroup,
	actorLook,
	actorOutlined,
	actorSpriteScale,
	affixDrawScale,
	animDtSec,
	bomberDetonated,
	bomberFuseFlashOn,
	bomberFusing,
	bossSpriteLayout,
	chooseActorAnim,
	choosePlayerAnim,
	corpseTransparency,
	degToRad,
	detonationCorpseView,
	floorImageOffset,
	floorImageSize,
	floorStudsY,
	isoBasis,
	lerp,
	newEnemyKinds,
	outlineSwitchOn,
	playerBlinkVisible,
	playerLook,
	playerOutlined,
	playerSpriteInputFor,
	playerVisualIdOf,
	scaledSpriteLayout,
	studsX,
	studsZ,
	variantLook,
	vengefulArmed,
	vengefulCorpseView,
	vengefulPulseOn,
	viewAffix,
	FlipTracker,
	ShieldFlashWatch,
	type ActorGroup,
	type ActorLook,
	type ActorSpriteInput,
	type CorpseView,
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
import { VIEW_HIT_CLIP_SEC } from "shared/view/dummy";
import { goldenFlickerTransparency, goldenTicksLeft, isGoldenKind } from "shared/view/golden";
import { FxTrackerController } from "../fx/FxTrackerController";
import { PreloadController } from "../game/PreloadController";
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

/**
 * One player's view (co-op: one per party member, built on first use): the sprite set of the player's visual
 * (docs/ARCHER.md AR9: their character's), or the placeholder capsule while the pack has no set or its art is not ready
 * (the stand-in, docs/STAGE_ASSETS.md SA17). Each body is built the first time it is drawn and kept until the player's
 * visual changes (a new run as another character); the one not drawn is parked.
 */
interface PlayerView {
	/** The theme visual it draws (shared/view playerVisualIdOf: class.vanguard for the Knight, class.ranger the Archer). */
	readonly visualId: string;
	model: PlaceholderModel | undefined;
	sprite: SpriteView | undefined;
	readonly pip: BasePart;
	/** Built with the sprite (undefined: the pack has no ring image). */
	ring: Ring | undefined;
	/** The body drawn last frame (undefined: none yet). */
	drawn: "art" | "standIn" | undefined;
	/** As last written (undefined: rewrite, after a swap). */
	look: ActorLook | undefined;
	transparency: number;
	/** The placeholder capsule sits under the player-outline Model (shared/view playerOutlined; changes reparent). */
	outlined: boolean;
}

interface ActorView {
	kind: number;
	id: number;
	/** The archetype's visual id (data.spriteId): the logical id whose readiness picks art or stand-in. */
	visualId: string;
	/** The view could be drawn as art (a sprite input and a pack set); art then follows the id's readiness (SA17). */
	artCapable: boolean;
	/** Exactly one of model / sprite is set. */
	model: PlaceholderModel | undefined;
	sprite: SpriteView | undefined;
	/** The archetype's sprite input builder (sprite views only). */
	spriteInput: ((a: Readonly<ActorState>, alpha: number) => ActorSpriteInput) | undefined;
	/**
	 * Seconds of the view-side hit clip (docs/DUMMY_ART.md DD1: shared/view/dummy VIEW_HIT_CLIP_SEC; the training
	 * dummy's wobble), timed by HitReactSlots.hitAge. Sprite views of those archetypes only; undefined otherwise.
	 */
	hitClipSec: number | undefined;
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
 * turret.sniper, M1's turret.sprayer / turret.caster, the bruiser, Mother Mayhem and the Demon Lord), a pooled
 * SpriteView (BillboardGui on a feet anchor) shows the animation chosen from sim state (shared/view sprites.ts) in the
 * facing nearest the sim's facing on screen;
 * juice through the label: hit flash / telegraph pulse / i-frame tints (ImageColor3), corpse fade (ImageTransparency),
 * the post-hit blink (Visible). A boss sprite (data.boss: Mother Mayhem, the Demon Lord) is drawn at least
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
 * to a per-visual pool). The player: their visual's capsule (docs/ARCHER.md AR9: their character's, shared/view
 * playerVisualIdOf) with a facing pip on the floor (`ui.cursor`), a tumble while rolling, the i-frame tint, the
 * post-hit blink and lying down greyed when dead.
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
 * rim (its set's baked 1 px outline sheets: the knight's, the Archer's) and shows it while playerOutlined. A
 * placeholder capsule moves into `Players/Outlined`, a Model with ONE Highlight (rim only, Occluded), while
 * playerOutlined (reparented only on a change); the Highlight is Enabled while that player is also visible, so the
 * post-hit blink blinks the rim too.
 *
 * Enemy variants (docs/ENEMY_VARIANTS.md EV9; rules in shared/view variants.ts): the imp / Ooze / summoner draw through
 * the same two paths (Cone / Dome placeholders; ACTOR_SPRITE_INPUTS once their sets land; `slime.small` wears the
 * Ooze's set at its spriteScale). Elite affixes, never through a Highlight (EVD12): a Hulking actor is drawn at radius /
 * data radius (affixDrawScale, in both pool keys); an affixed sprite's baked rim is tinted `affix.<id>`; a shield hit
 * (ShieldFlashWatch) tints the body / flashes the rim in enemyShield; a Vengeful corpse (EVD16) is drawn as long as the
 * sim holds it (vengefulCorpseView: opaque, then a short fade) and pulses in the telegraph look while its ring is
 * pending. The floor ring is AffixRingController's.
 *
 * The second endless set (docs/NEW_ENEMIES.md NE8; rules in shared/view newEnemies.ts): the five draw through the same
 * two paths (their placeholder visuals; ACTOR_SPRITE_INPUTS once their sets land in NE9). A fusing Bomber flashes
 * between the flash and telegraph looks, ever faster (bomberFuseFlashOn); a detonated Bomber corpse plays `death.2`
 * when its set has it, else it is gone fast (detonationCorpseView; ParticleController adds the burst). Actors inside a
 * Warbanner's aura (AuraView: shared/sim warbannerAuraMask on the view's state, once per frame): a sprite's rim is
 * tinted `enemyAura` (over the affix colour), a placeholder's body is lerped AURA_VIEW.placeholderTint toward it
 * while no other look shows (the "aura" look). Never a Highlight (EVD12). The aura ring and the stun stars are
 * NewEnemyMarksController's.
 *
 * The Goldling (docs/FORTUNE.md FO8): through the same two paths (its placeholder gold block; ACTOR_SPRITE_INPUTS'
 * `golden` once the pack has an `enemy.golden` set: idle / move / hit / death), flickering in its last seconds
 * (goldenFlicker; never under reduced motion). Its timer ring is GoldenRenderController's.
 *
 * Stand-ins (docs/STAGE_ASSETS.md "Revision 2", SA17): a set is drawn only once its art is READY on this device
 * (PreloadController.isArtReady: every sheet of the set, rims included, downloaded; no optional sheet joins on its
 * own, so a set never draws a blank frame); until then the actor takes the placeholder path above (the stand-in:
 * under the one Enemies Highlight like any placeholder enemy, never a Highlight per actor). The sprite-set cache
 * keeps the pack's answer; readiness is asked at acquire. Each frame polls the readiness (shared/view FlipTracker):
 * when the epoch moved, every LIVE actor whose visual id flipped and is drawn the wrong way is released and
 * re-acquired (the pools' keys already keep sprites and placeholders apart), so a pack turns into its art mid-fight,
 * and back under KV_StandInsForce. A corpse keeps the view it died with until its slot frees (no swap mid-death).
 * Players: the capsule until the players' set is ready, then the sprite (usePlayerBody: each body built on first draw,
 * the other parked, the capsule out of the player-outline Model); the ring replaces the pip only once its image is
 * ready too.
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
	private bowIndex: number | undefined;
	/** Each player's visual id (shared/view playerVisualIdOf), worked out once per run state (a run's loadouts never change). */
	private visualIds = new Array<string>();
	private visualState: SimState | undefined;
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
	/** Siege Bolt's pin hold (docs/BUILDS_V2.md BV11c; setPinHolds): slot -> held, or undefined. */
	private pinHolds: ReadonlyArray<boolean> | undefined;

	// --- elite affixes (docs/ENEMY_VARIANTS.md EV9) ----------------------------------------------
	/** Shield hits from a per-frame diff of state.affixes (the body flashes in enemyShield). */
	private readonly shieldWatch = new ShieldFlashWatch(MAX_ACTORS);
	/** `affix.<id>` per AFFIX_IDS index (the sprite rim's tint), enemyShield, and the plain rim (enemyOutline). */
	private affixColors = new Array<Color3>();
	private shieldColor = SPRITE_TINT_NONE;
	private outlineColor = SPRITE_TINT_NONE;

	// --- the second endless set (docs/NEW_ENEMIES.md NE8) -----------------------------------------
	/** Who stands in a Warbanner's aura this frame (rebuilt once per frame from the view's state). */
	private readonly aura = new AuraView();
	private auraColor = SPRITE_TINT_NONE;

	// --- stand-ins (docs/STAGE_ASSETS.md SA17) ---------------------------------------------------
	/** This frame's readiness flips (polled once per frame). */
	private readonly flips = new FlipTracker();
	/** This frame: the players' set is drawn (the pack has it and it is ready), and the ring image is ready. */
	/** This frame's art readiness (docs/STAGE_ASSETS.md SA17): each player's body by their own visual (ARCHER AR9). */
	private readiness: ReturnType<PreloadController["getReadiness"]> | undefined;
	private ringReady = false;

	constructor(
		private readonly sim: SimController,
		private readonly theme: ThemeController,
		private readonly fx: FxTrackerController,
		private readonly preload: PreloadController,
	) {}

	onStart(): void {
		const pack = this.theme.getPack();
		this.pack = pack;
		this.affixColors = AFFIX_IDS.map((id) => pack.color(affixRole(id)));
		this.shieldColor = pack.color(ENEMY_SHIELD_ROLE);
		this.outlineColor = pack.color(ACTOR_OUTLINE.role);
		this.auraColor = pack.color(ENEMY_AURA_ROLE);
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
		this.players.push(this.buildPlayerView(pack, players, ACTOR_VIEW.playerVisualId));
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
		// Stand-ins (SA17): which ids flipped since last frame; the players' art and ring, read once per frame.
		const readiness = this.preload.getReadiness();
		const flipped = this.flips.poll(readiness);
		this.readiness = readiness;
		this.ringReady = readiness.isReady(ACTOR_VIEW.ringVisualId);
		this.motion?.beginFrame(state, this.dtSec, this.fx.settings());
		this.drawPlayers(state, alpha);
		this.shieldWatch.update(state);
		this.aura.update(state);

		const actors = state.combat.actors;
		const n = actors.size();
		for (let slot = 0; slot < n; slot++) {
			const a = actors[slot];
			let view = this.views[slot];
			if (a.kind === NO_KIND) {
				if (view !== undefined) this.release(slot, view);
				continue;
			}
			if (view === undefined || view.kind !== a.kind || view.id !== a.id || (flipped && this.swapDue(view, a))) {
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

	/**
	 * A live view whose visual id flipped this frame and is now drawn the wrong way (art while not ready, a stand-in
	 * while ready): released and re-acquired. Corpses keep the view they died with until the slot frees (SA17).
	 */
	private swapDue(view: ActorView, a: Readonly<ActorState>): boolean {
		if (a.alive === 0 || !view.artCapable || !this.flips.has(view.visualId)) return false;
		return this.preload.isArtReady(view.visualId) !== (view.sprite !== undefined);
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

	/** A look's body colour (undefined: the base colour / no tint). "aura" tints no sprite body (its rim carries it). */
	private lookColor(pack: ThemePack, look: VariantLook): Color3 | undefined {
		if (look === "shield") return this.shieldColor;
		if (look === "aura") return undefined;
		return look === "normal" ? undefined : pack.color(ACTOR_VIEW.lookRoles[look]);
	}

	private acquire(slot: number, a: Readonly<ActorState>, state: SimState): ActorView {
		const pack = this.pack!;
		const def = archetypeAt(a.kind);
		const id = def.data.spriteId;
		const corpseTicks = def.data.corpseTicks ?? CORPSE_TICKS;
		const spriteInput = ACTOR_SPRITE_INPUTS.get(def.id);
		const artSet = spriteInput !== undefined ? this.spriteSet(id) : undefined;
		// SA17: the set's art only once its content is ready on this device; until then the placeholder (stand-in)
		const set = artSet !== undefined && this.preload.isArtReady(id) ? artSet : undefined;
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
				visualId: id,
				artCapable: true,
				model: undefined,
				sprite,
				spriteInput,
				hitClipSec: VIEW_HIT_CLIP_SEC.get(def.id),
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
				visualId: id,
				artCapable: artSet !== undefined,
				model,
				sprite: undefined,
				spriteInput: undefined,
				hitClipSec: undefined,
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
		const bomber = a.kind === newEnemyKinds().bomber;
		// A detonated Bomber (NE8): its own corpse length (a quick fade without `death.2`); it never arms Vengeful.
		const detonated = bomber && bomberDetonated(a);
		const vengefulCorpse =
			!detonated && a.alive === 0 && affix === AffixKind.VENGEFUL && state.affixes !== undefined;
		let corpse: CorpseView | undefined;
		if (detonated) {
			const set = view.sprite?.set;
			const hasAnim = set !== undefined && set.animation(NEW_ENEMY_SPRITE_VIEW.anims.detonation) !== undefined;
			corpse = detonationCorpseView(view.corpseTicks, hasAnim);
		} else if (vengefulCorpse) {
			corpse = vengefulCorpseView(
				view.corpseTicks,
				state.affixes!.config.vengefulTelegraphTicks,
				AFFIX_VIEW.vengefulFadeTicks,
			);
		}
		const pulse = vengefulCorpse && vengefulArmed(state, slot, a.id) && vengefulPulseOn(tick);
		let base = actorLook(a.alive, a.flashTicks, a.aiState, tick);
		// The fuse flash (NE8): flash / telegraph, quickening over the fuse (a real hit flash still wins).
		if (bomber && base !== "flash" && bomberFusing(a)) {
			base = bomberFuseFlashOn(a.aiTicks, alpha) ? "flash" : "telegraph";
		}
		const buffed = this.aura.buffed(a);
		const look = variantLook(base, a.alive, pulse, shieldFlash, buffed);

		const sprite = view.sprite;
		if (sprite !== undefined) {
			this.moveParts.push(sprite.anchor);
			this.moveCFrames.push(new CFrame(at));
			let input = view.spriteInput!(a, alpha);
			const hitClipSec = view.hitClipSec;
			if (hitClipSec !== undefined) {
				// DD1: the hit plays over the seconds since the last hit (hitReact's clock), not the 0.1 s sim flash.
				const elapsed = this.hitReact.hitAge(slot, a.id, this.hitNow);
				input = { ...input, hitClip: { elapsed, total: hitClipSec } };
			}
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
			sprite.setTransparency(math.max(transparency, this.goldenFlicker(a, slot, state, alpha)));
			if (view.hasOutline) {
				// The aura's tint wins on the rim (the affix keeps its floor ring and name chip).
				const k = affixThemeIndex(affix);
				const rim = k >= 0 ? this.affixColors[k] ?? this.outlineColor : this.outlineColor;
				sprite.setRimColor(buffed ? this.auraColor : rim);
			}
			// The rim goes the frame the actor dies (the corpse fades without it) and with KV_EnemyOutline = false.
			sprite.setOutlineShown(actorOutlined(view.hasOutline, a.alive !== 0, this.outlineOn));
			return;
		}

		const transparency = math.max(
			corpse !== undefined
				? corpseTransparency(a.alive, a.deadTicks, corpse.corpseTicks, corpse.fadeFrom)
				: corpseTransparency(a.alive, a.deadTicks, view.corpseTicks),
			this.goldenFlicker(a, slot, state, alpha),
		);
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
			setModelColor(
				model,
				look === "aura"
					? model.baseColor.Lerp(this.auraColor, AURA_VIEW.placeholderTint)
					: this.lookColor(pack, look) ?? model.baseColor,
			);
		}
		if (transparency !== view.transparency) {
			view.transparency = transparency;
			setModelTransparency(model, transparency);
		}
	}

	/**
	 * The Goldling's flicker in its last seconds (docs/FORTUNE.md FO8, shared/view/golden goldenFlickerTransparency, on
	 * sim time; none under reduced motion, where its timer ring's colour carries the warning): the body's extra
	 * transparency, 0 for every other actor.
	 */
	private goldenFlicker(a: Readonly<ActorState>, slot: number, state: SimState, alpha: number): number {
		if (a.alive === 0 || !isGoldenKind(a.kind)) return 0;
		const simSec = (state.tick + alpha) / SIM_HZ;
		return goldenFlickerTransparency(goldenTicksLeft(state, slot), simSec, this.fx.settings().reducedMotion);
	}

	/** A player's view: the facing pip now; the body (sprite or capsule) on its first draw (usePlayerBody). */
	private buildPlayerView(pack: ThemePack, folder: Instance, visualId: string): PlayerView {
		const pipVisual = pack.placeholder(ACTOR_VIEW.facingPipVisualId);
		const pip = renderPart("Part", false);
		pip.Name = "FacingPip";
		pip.Size = new Vector3(pipVisual.size[0] * PIP_SCALE, PIP_THICKNESS, pipVisual.size[0] * PIP_SCALE);
		pip.Color = pack.visualColor(pipVisual.color);
		pip.Material = Enum.Material[pipVisual.material];
		pip.Parent = folder;
		return {
			visualId,
			model: undefined,
			sprite: undefined,
			pip,
			ring: undefined,
			drawn: undefined,
			look: undefined,
			transparency: -1,
			outlined: false,
		};
	}

	/**
	 * Stand-ins (docs/STAGE_ASSETS.md SA17): makes `mode` the drawn body of `view`, building it on first use (the sprite
	 * with its ring and the player-outline rim; the capsule under the players group) and parking the other one (a
	 * parked capsule leaves the player-outline Model). The cached look / transparency are reset so the new body is
	 * written in full this frame.
	 */
	private usePlayerBody(view: PlayerView, mode: "art" | "standIn", pack: ThemePack): void {
		if (view.drawn === mode) return;
		const folder = this.groups!.players;
		if (mode === "art") {
			const set = this.spriteSet(view.visualId)!;
			if (view.sprite === undefined) {
				// Every player's view carries the player-outline rim; drawPlayer shows it on the watched player only.
				view.sprite = new SpriteView(set, folder, set, 0, pack.color(PLAYER_OUTLINE.role));
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
	}

	/** Every player (co-op: each party member, index order); views beyond the party are parked. */
	private drawPlayers(state: SimState, alpha: number): void {
		const pack = this.pack;
		const folder = this.groups?.players;
		if (pack === undefined || folder === undefined) return;
		const n = partySize(state);
		if (state !== this.visualState) {
			this.visualState = state;
			this.visualIds = [];
		}
		while (this.players.size() < n) {
			this.players.push(this.buildPlayerView(pack, folder, this.playerVisualId(state, this.players.size())));
		}
		const localIndex = this.sim.getViewPlayerIndex(); // co-op spectating: the watched player gets the local ring
		let rimDrawn = false; // the player-outline Highlight: an outlined capsule is drawn this frame
		for (let i = 0; i < this.players.size(); i++) {
			let view = this.players[i];
			if (i < n) {
				const visualId = this.playerVisualId(state, i);
				if (view.visualId !== visualId) {
					// docs/ARCHER.md AR9: this player is another character now (a new run): their own sprite or capsule.
					destroyPlayerView(view);
					view = this.buildPlayerView(pack, folder, visualId);
					this.players[i] = view;
				}
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

	/**
	 * docs/BUILDS_V2.md BV11c, Siege Bolt: SiegeFxController's pin mask (PinHoldMask.held, slot -> carried by an arrow),
	 * handed over once and read every frame by applyHitReact: a pinned actor's sprite holds while it is carried.
	 */
	setPinHolds(held: ReadonlyArray<boolean>): void {
		this.pinHolds = held;
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
			sprite.setHold(look.hold || this.pinHolds?.[slot] === true); // BV11c: a Siege Bolt pin holds the sprite
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

/** Destroys a player's view (its sprite or capsule, facing pip and ring). */
function destroyPlayerView(view: PlayerView): void {
	view.sprite?.destroy();
	if (view.model !== undefined) destroyModel(view.model);
	view.pip.Destroy();
	view.ring?.part.Destroy();
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
