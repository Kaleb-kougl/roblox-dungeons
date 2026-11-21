/**
 * Enemy variants on screen (docs/ENEMY_VARIANTS.md EV9, decisions EVD5 / EVD12 / EVD15 / EVD16): the pure rules the
 * client renderers share, in plain numbers so they run headlessly (variants.spec.ts). Presentation only: read-only on
 * the sim, nothing here feeds `step()`. Tunables: variantsConfig.ts.
 *
 *   affixes     which affix an actor carries (state.affixes, the actorId guard), its theme id, colour role and name
 *               chip key; elite = elite room OR affixed (EVD15: runtime spawns in an elite room keep the plate); the
 *               Hulking draw scale (radius / data radius, snapped); the floor ring's pieces; the shield segment and
 *               the chip above the health bar; the shield-hit flash (ShieldFlashWatch, a per-frame diff of the durable
 *               shield values: a frame can step several ticks, so the per-tick events would miss hits)
 *   Vengeful    the per-actor corpse length (EVD16: held while armed, then a short fade) and its telegraph pulse
 *   goo         which bullet pool draws a bullet (BulletKind.GOO -> the decal pool, unless GOO_VIEW.decal is off) and a
 *               puddle's pop-in / fade (gooDecalLook); the floor sprite's cell / variant / mirror / fade (gooSpriteLook) and
 *               size by the cover-the-hit rule (gooSpriteSize, gooSpritePlacement; docs/GOO_ART.md GA3)
 *   imp blink   BlinkWatch: the frame an imp lands (blink wind-up -> landing aim), where it left and where it landed
 *   fx hints    viewFxHints: the summoner's casting ring drawn only during its summon (its sim hint keys on the state)
 *
 * Never a Highlight (docs/OUTLINE.md: the engine draws at most 31): affix colour is a floor ring, the sprite rim's tint
 * and the name chip.
 *
 * @module
 */
import { AffixKind, affixThemeIndex } from "shared/dungeon";
import {
	AiState,
	BulletKind,
	BulletPayload,
	CHARGER,
	IMP_ATTACK_BLINK,
	IMP_ATTACK_FAN,
	NO_KIND,
	SUMMONER,
	SUMMONER_ATTACK_SUMMON,
	type ActorState,
} from "shared/sim";
import { AFFIX_IDS, affixNameKey, affixRole, type AffixId, type ColorRole } from "shared/theme";
import { ACTOR_VIEW } from "./config";
import type { ActorFxHintsView, SegmentSink } from "./markings";
import type { ActorLook } from "./sprites";
import { AFFIX_VIEW, GOO_ART_VIEW, GOO_VIEW } from "./variantsConfig";
import { STRIKE_VIEW } from "./newEnemiesConfig";
import { isShellPayload } from "./newEnemies3";

const TAU = 2 * math.pi;

// ---------------------------------------------------------------------------------------------
// Affixes

/** One actor slot's affix as the view reads it (structurally a shared/sim AffixSlot). */
export interface AffixSlotView {
	readonly affix: number;
	readonly actorId: number;
	readonly shield: number;
	readonly shieldMax: number;
	readonly vengeTicks: number;
}

/** The slice of SimState the affix reads need (structural, so specs pass plain objects). */
export interface AffixedState {
	readonly affixes?: { readonly slots: ReadonlyArray<AffixSlotView> };
}

/** The live affix slot of actor slot `slot` holding actor id `actorId` (the stale-slot guard), else undefined. */
export function affixSlotView(state: AffixedState, slot: number, actorId: number): AffixSlotView | undefined {
	const s = state.affixes?.slots[slot];
	if (s === undefined || s.affix === AffixKind.NONE || actorId === 0 || s.actorId !== actorId) return undefined;
	return s;
}

/** The affix (shared/dungeon AffixKind) of the actor `actorId` in slot `slot`; NONE without one. */
export function viewAffix(state: AffixedState, slot: number, actorId: number): number {
	return affixSlotView(state, slot, actorId)?.affix ?? AffixKind.NONE;
}

/** The theme id of affix `kind` ("hulking", ...), undefined for NONE / unknown. */
export function affixIdOf(kind: number): AffixId | undefined {
	const i = affixThemeIndex(kind);
	return i >= 0 ? AFFIX_IDS[i] : undefined;
}

/** The colour role of affix `kind` (`affix.<id>`: floor ring, rim tint, chip), undefined for NONE. */
export function affixRoleOf(kind: number): ColorRole | undefined {
	const id = affixIdOf(kind);
	return id !== undefined ? affixRole(id) : undefined;
}

/** The health bar chip's string key of affix `kind` (`affix.<id>.name`), undefined for NONE. */
export function affixChipKey(kind: number): string | undefined {
	const id = affixIdOf(kind);
	return id !== undefined ? affixNameKey(id) : undefined;
}

/**
 * The elite look (health plate, x1.5 gold sparks, the heavier kill freeze): an actor first seen in an elite room
 * (today's rule, so summons and slimelets spawned there keep it, EVD15) OR carrying an affix.
 */
export function eliteView(eliteRoom: boolean, affix: number): boolean {
	return eliteRoom || affix !== AffixKind.NONE;
}

/**
 * The draw scale of an actor whose radius differs from its archetype's (Hulking: x1.2 in the sim), snapped to
 * AFFIX_VIEW.scaleStep so pools keep few keys: radius / dataRadius, 1 for a missing or non-positive data radius.
 */
export function affixDrawScale(radius: number, dataRadius: number | undefined): number {
	if (dataRadius === undefined || !(dataRadius > 0) || !(radius > 0)) return 1;
	const inv = math.round(1 / AFFIX_VIEW.scaleStep);
	const s = math.round((radius / dataRadius) * inv) / inv;
	return s > 0 ? s : 1;
}

/** The floor ring's radius under an actor of `radius` (tiles). */
export function affixRingRadius(radius: number): number {
	return radius + AFFIX_VIEW.ringMarginTiles;
}

/** Pieces of the floor ring of `radius`: at least ringMinPieces, each at most ringPieceTiles of the circle. */
export function affixRingPieces(radius: number): number {
	if (!(radius > 0)) return 0;
	return math.max(AFFIX_VIEW.ringMinPieces, math.ceil((TAU * radius) / AFFIX_VIEW.ringPieceTiles));
}

/** The floor ring around (x, z) as straight pieces (a closed polygon of affixRingPieces(radius) sides). */
export function affixRingSegments(sink: SegmentSink, x: number, z: number, radius: number): void {
	const n = affixRingPieces(radius);
	if (n <= 0) return;
	let px = x;
	let pz = z + radius;
	for (let i = 1; i <= n; i++) {
		const h = (i * TAU) / n;
		const nx = x + math.sin(h) * radius;
		const nz = z + math.cos(h) * radius;
		sink.seg(px, pz, nx, nz);
		px = nx;
		pz = nz;
	}
}

/** A rect in render px relative to the feet anchor, y up (the health bar's frame of reference). */
export interface BarRect {
	left: number;
	bottom: number;
	w: number;
	h: number;
}

/**
 * A fresh BarRect (all zero) for the caller to keep and hand to `shieldRowRect` / `affixChipRect`, which write it in
 * place. HealthBarController owns one.
 */
export function createBarRect(): BarRect {
	return { left: 0, bottom: 0, w: 0, h: 0 };
}

/** The bar geometry fields the affix rows sit on (shared/view/fx BarGeometry). */
export interface BarFrame {
	readonly innerLeft: number;
	readonly innerW: number;
	readonly plateLeft: number;
	readonly plateW: number;
	/** Top edge of the plate. */
	readonly top: number;
}

/** Whole px of a segment worth `value` of `max` over `width` (anything above 0 shows at least 1 px). */
function pxOf(width: number, value: number, max: number): number {
	if (!(value > 0) || !(max > 0)) return 0;
	const w = math.round((width * math.min(value, max)) / max);
	return w < 1 ? 1 : w;
}

/**
 * The shield segment (enemyShield): a shieldRowPx row on top of the plate, from the inner row's left edge, as wide as
 * shield / shieldMax of the inner row (0 wide when the shield is down). Writes `out` and returns it.
 */
export function shieldRowRect(g: BarFrame, shield: number, shieldMax: number, out: BarRect): BarRect {
	out.left = g.innerLeft;
	out.bottom = g.top;
	out.w = pxOf(g.innerW, shield, shieldMax);
	out.h = AFFIX_VIEW.shieldRowPx;
	return out;
}

/**
 * The affix name chip: chipPx tall, centred over the bar, at least chipMinWidthPx (or the plate) wide, chipGapPx above
 * the plate (above the shield row when there is one). Writes `out` and returns it.
 */
export function affixChipRect(g: BarFrame, shieldRow: boolean, out: BarRect): BarRect {
	const w = math.max(AFFIX_VIEW.chipMinWidthPx, g.plateW);
	out.w = w;
	out.left = g.plateLeft + g.plateW / 2 - w / 2;
	out.bottom = g.top + (shieldRow ? AFFIX_VIEW.shieldRowPx : 0) + AFFIX_VIEW.chipGapPx;
	out.h = AFFIX_VIEW.chipPx;
	return out;
}

function filled(n: number, v: number): number[] {
	const out: number[] = [];
	for (let i = 0; i < n; i++) out.push(v);
	return out;
}

/** The slice of SimState ShieldFlashWatch reads. */
export interface ShieldWatchState extends AffixedState {
	readonly tick: number;
	readonly combat: { readonly actors: ReadonlyArray<Readonly<ActorState>> };
}

/**
 * Shield hits by diffing (slot, actor id) -> shield every frame: a shield that went DOWN since the last frame is a
 * hit, flashing the body in `enemyShield` for AFFIX_VIEW.shieldFlashTicks sim ticks from that frame's tick (a refill
 * never flashes). A new run (another state, the tick going back) forgets everything. Read-only on the sim.
 */
export class ShieldFlashWatch {
	private readonly ids: number[];
	private readonly shields: number[];
	private readonly flashTick: number[];
	private lastState: ShieldWatchState | undefined;
	private lastTick = -1;

	constructor(private readonly capacity: number) {
		this.ids = filled(capacity, 0);
		this.shields = filled(capacity, 0);
		this.flashTick = filled(capacity, -math.huge);
	}

	update(state: ShieldWatchState): void {
		if (state !== this.lastState || state.tick < this.lastTick) {
			for (let i = 0; i < this.capacity; i++) this.ids[i] = 0;
			this.lastState = state;
		}
		this.lastTick = state.tick;
		const actors = state.combat.actors;
		const n = math.min(actors.size(), this.capacity);
		for (let i = 0; i < this.capacity; i++) {
			const a = i < n ? actors[i] : undefined;
			const s = a !== undefined && a.kind !== NO_KIND ? affixSlotView(state, i, a.id) : undefined;
			if (a === undefined || s === undefined || s.affix !== AffixKind.SHIELDED) {
				this.ids[i] = 0;
				continue;
			}
			if (this.ids[i] !== a.id) {
				this.ids[i] = a.id;
				this.flashTick[i] = -math.huge;
			} else if (s.shield < this.shields[i]) {
				this.flashTick[i] = state.tick;
			}
			this.shields[i] = s.shield;
		}
	}

	/** True while slot `slot`'s actor `actorId` flashes from a shield hit at sim tick `tick`. */
	flashing(slot: number, actorId: number, tick: number): boolean {
		if (slot < 0 || slot >= this.capacity || this.ids[slot] !== actorId || actorId === 0) return false;
		const age = tick - this.flashTick[slot];
		return age >= 0 && age < AFFIX_VIEW.shieldFlashTicks;
	}
}

/**
 * An actor's tint state with the affix looks: "shield" = a shield hit's flash in `enemyShield`; "aura" = inside a
 * Warbanner's aura (docs/NEW_ENEMIES.md NE8: placeholders lerp their body toward `enemyAura`, sprites tint the rim).
 */
export type VariantLook = ActorLook | "shield" | "aura";

/**
 * An actor's look with its affix: a corpse whose Vengeful ring is pending pulses in the telegraph look while
 * `vengefulPulse` (vengefulArmed and vengefulPulseOn); a living actor whose shield was just hit shows "shield" unless
 * the hit flash itself shows ("flash" wins: hp was lost too); a living actor inside a Warbanner's aura (`aura`, shared/view
 * AuraView) shows "aura" while nothing else would show (flash, telegraph and shield win). Everyone else keeps `base`
 * (shared/view actorLook).
 */
export function variantLook(
	base: ActorLook,
	alive: number,
	vengefulPulse: boolean,
	shieldFlash: boolean,
	aura = false,
): VariantLook {
	if (alive === 0) return vengefulPulse ? "telegraph" : base;
	if (shieldFlash && base !== "flash") return "shield";
	if (aura && base === "normal") return "aura";
	return base;
}

// ---------------------------------------------------------------------------------------------
// Vengeful (EVD16)

/** A corpse's drawn length: corpseTransparency(alive, deadTicks, corpseTicks, fadeFrom). */
export interface CorpseView {
	readonly corpseTicks: number;
	readonly fadeFrom: number;
}

/**
 * A Vengeful corpse's drawn length: the sim holds it until its ring fires `telegraphTicks` after the kill and frees it
 * on the next actor phase, so the slot shows deadTicks 0..telegraphTicks; corpseTicks covers that (at least the
 * archetype's own `baseTicks`), and the body stays opaque except over the last `fadeTicks` (the pulse stays visible
 * while armed). A plain corpse keeps (baseTicks, 0).
 */
export function vengefulCorpseView(baseTicks: number, telegraphTicks: number, fadeTicks: number): CorpseView {
	const corpseTicks = math.max(baseTicks, telegraphTicks + 1);
	const fade = math.clamp(fadeTicks, 0, corpseTicks);
	return { corpseTicks, fadeFrom: corpseTicks > 0 ? (corpseTicks - fade) / corpseTicks : 0 };
}

/** True while slot `slot`'s corpse `actorId` has its Vengeful ring pending. */
export function vengefulArmed(state: AffixedState, slot: number, actorId: number): boolean {
	const s = affixSlotView(state, slot, actorId);
	return s !== undefined && s.affix === AffixKind.VENGEFUL && s.vengeTicks > 0;
}

/** The armed corpse's pulse (the telegraph tint's on / off rhythm, ACTOR_VIEW.telegraphPulseTicks). */
export function vengefulPulseOn(tick: number): boolean {
	return math.floor(tick / ACTOR_VIEW.telegraphPulseTicks) % 2 === 0;
}

// ---------------------------------------------------------------------------------------------
// Goo (EVD5)

/** True for a goo puddle's payload (its `kind` field is BulletKind.GOO; graze bits above the layout are ignored). */
export function isGooPayload(payload: number): boolean {
	return BulletPayload.get(payload, "kind") === BulletKind.GOO;
}

/**
 * Which enemy bullet pool draws a bullet with `payload`: goo goes to the decal pool while GOO_VIEW.decal is on, a
 * strike (docs/NEW_ENEMIES.md NE8, BulletKind.STRIKE) to the strike flash pool while STRIKE_VIEW.decal is on, except a
 * Mortar's shell (docs/NEW_ENEMIES_3.md NT7, newEnemies3.ts isShellPayload), which goes to its own disc pool: never the
 * lightning's art or scorch.
 */
export function enemyBulletPool(
	payload: number,
	decal: boolean = GOO_VIEW.decal,
	strikeDecal: boolean = STRIKE_VIEW.decal,
): "goo" | "strike" | "shell" | "enemy" {
	const kind = BulletPayload.get(payload, "kind");
	if (decal && kind === BulletKind.GOO) return "goo";
	if (strikeDecal && kind === BulletKind.STRIKE) return isShellPayload(payload) ? "shell" : "strike";
	return "enemy";
}

/** A puddle's look this frame: drawn scale (0..1) and transparency (0 opaque .. 1 gone). */
export interface GooLook {
	scale: number;
	transparency: number;
}

/**
 * A puddle with `lifeLeft` of its `totalLife` seconds (bullet time, so Hourglass stretches both ends alike): it pops in
 * (scale 0 -> 1) over GOO_VIEW.popSec and fades out over its last GOO_VIEW.fadeSec. Writes `out` and returns it.
 */
export function gooDecalLook(lifeLeft: number, totalLife: number, out: GooLook): GooLook {
	const age = totalLife - lifeLeft;
	out.scale = GOO_VIEW.popSec > 0 ? math.clamp(age / GOO_VIEW.popSec, 0, 1) : 1;
	out.transparency = GOO_VIEW.fadeSec > 0 ? 1 - math.clamp(lifeLeft / GOO_VIEW.fadeSec, 0, 1) : 0;
	return out;
}

/** Which cell a goo floor sprite shows (docs/GOO_ART.md GA3): the land cell, then a hold variant. */
export type GooSpriteFrame = "land" | "hold";

/** A goo floor sprite's look this frame (gooSpriteLook). */
export interface GooSpriteLook {
	frame: GooSpriteFrame;
	/** The hold variant (0 .. holdFrames - 1), from the slot. */
	variant: number;
	/** Mirrored along screen X, from the slot. */
	mirror: boolean;
	/** 0 opaque .. 1 gone (gooDecalLook's fade). */
	transparency: number;
}

/**
 * A goo floor sprite with `lifeLeft` of its `totalLife` seconds in bullet slot `slot` (docs/GOO_ART.md GA3): the land
 * cell while its age (bullet time, so the Hourglass stretches it like the disc's pop) is under GOO_ART_VIEW.landSec,
 * then the hold cell; transparency fades over the last GOO_VIEW.fadeSec exactly as gooDecalLook; no scale pop. The
 * hold variant (of `holdFrames`) and the mirror come from the slot's bits (GOO_ART_VIEW.mirrorMask / variantShift):
 * deterministic, no rng, constant for a puddle's life. Writes `out` and returns it.
 */
export function gooSpriteLook(
	lifeLeft: number,
	totalLife: number,
	slot: number,
	out: GooSpriteLook,
	holdFrames = 1,
): GooSpriteLook {
	const age = totalLife - lifeLeft;
	out.frame = age < GOO_ART_VIEW.landSec ? "land" : "hold";
	const n = math.max(1, holdFrames);
	out.variant = bit32.rshift(slot, GOO_ART_VIEW.variantShift) % n;
	out.mirror = bit32.band(slot, GOO_ART_VIEW.mirrorMask) !== 0;
	out.transparency = GOO_VIEW.fadeSec > 0 ? 1 - math.clamp(lifeLeft / GOO_VIEW.fadeSec, 0, 1) : 0;
	return out;
}

/** The goo puddle's lit box on the floor (gooSpriteSize), tiles: across the screen and up it (the floor depth). */
export interface GooSpriteSize {
	widthTiles: number;
	depthTiles: number;
}

/**
 * The floor size of a goo floor sprite's lit box (`litW` x `litH` art px), tiles, by the "cover the hit" rule (docs/
 * GOO_ART.md GAD3 / GAD4): drawn flat on the floor and seen at `pitchDeg`, a floor length L reads L * sin(pitch) tall
 * on screen, so the depth is stretched by 1 / sin(pitch) and the screen shows the art's own aspect (litH / litW); the
 * lit ellipse on screen is the smallest of that aspect that covers the hit circle's on-screen ellipse (2 * radius
 * wide, 2 * radius * sin(pitch) tall). Concentric and axis-aligned, so covering means both axes at least the hit's.
 * 31 x 17 at radius 0.35, pitch 55: about 1.05 wide, 0.70 deep. Writes `out` (a new table when absent) and returns it.
 */
export function gooSpriteSize(
	litW: number,
	litH: number,
	radius: number = GOO_ART_VIEW.hitRadius,
	pitchDeg: number = GOO_ART_VIEW.cameraPitchDeg,
	out: GooSpriteSize = { widthTiles: 0, depthTiles: 0 },
): GooSpriteSize {
	const sinPitch = math.sin(math.rad(pitchDeg));
	const aspect = litH / litW; // screen height / width of the art
	const hitWide = 2 * radius;
	const hitTall = hitWide * sinPitch;
	const width = math.max(hitWide, hitTall / aspect);
	out.widthTiles = width;
	out.depthTiles = (width * aspect) / sinPitch;
	return out;
}

/** Where a goo floor sprite's whole cell lies (gooSpritePlacement), tiles. */
export interface GooSpritePlacement {
	/** The cell across the screen and up it (the floor depth). */
	widthTiles: number;
	depthTiles: number;
	/** The cell centre from the puddle's centre: to the screen's right, and down the screen along the floor. */
	rightTiles: number;
	downTiles: number;
}

/**
 * The drawn cell of a goo floor sprite (`frameW` x `frameH` art px, pivot (`pivotX`, `pivotY`) = the lit box's centre,
 * from the cell's top-left) whose lit box (`litW` x `litH`) is drawn `size` (gooSpriteSize): the cell's floor size at
 * the same px-to-tile scales, and its centre's offset from the puddle centre (the pivot lies on the bullet), mirrored
 * across with `mirror` (the art flips about the pivot). Writes `out` (a new table when absent) and returns it.
 */
export function gooSpritePlacement(
	frameW: number,
	frameH: number,
	pivotX: number,
	pivotY: number,
	litW: number,
	litH: number,
	size: GooSpriteSize,
	mirror: boolean,
	out: GooSpritePlacement = { widthTiles: 0, depthTiles: 0, rightTiles: 0, downTiles: 0 },
): GooSpritePlacement {
	const across = size.widthTiles / litW;
	const along = size.depthTiles / litH;
	out.widthTiles = frameW * across;
	out.depthTiles = frameH * along;
	const right = (frameW / 2 - pivotX) * across;
	out.rightTiles = mirror ? -right : right;
	out.downTiles = (frameH / 2 - pivotY) * along;
	return out;
}

// ---------------------------------------------------------------------------------------------
// Imp blink

/** One landing: the actor, where it stood during the wind-up and where it landed (sim units). */
export interface BlinkPuff {
	slot: number;
	actorId: number;
	kind: number;
	fromX: number;
	fromZ: number;
	toX: number;
	toZ: number;
}

/** The slice of SimState BlinkWatch reads. */
export interface BlinkWatchState {
	readonly tick: number;
	readonly combat: { readonly actors: ReadonlyArray<Readonly<ActorState>> };
}

/**
 * Imp landings by a per-frame diff of (slot, actor id) -> (aiState, attack, position): a slot of `impKind` that was in
 * its blink wind-up (TELEGRAPH, IMP_ATTACK_BLINK) last frame and is in its landing aim (TELEGRAPH, IMP_ATTACK_FAN) now
 * has landed (the aim lasts IMP_LAND_AIM_TICKS, far longer than one frame's ticks). A cancelled blink (back to
 * repositioning) is no landing. A new run (another state, the tick going back) forgets everything.
 */
export class BlinkWatch {
	private readonly ids: number[];
	private readonly windup: boolean[];
	private readonly xs: number[];
	private readonly zs: number[];
	private readonly puffs: BlinkPuff[] = [];
	private lastState: BlinkWatchState | undefined;
	private lastTick = -1;

	constructor(private readonly capacity: number) {
		this.ids = filled(capacity, 0);
		this.xs = filled(capacity, 0);
		this.zs = filled(capacity, 0);
		this.windup = [];
		for (let i = 0; i < capacity; i++) this.windup.push(false);
		for (let i = 0; i < capacity; i++)
			this.puffs.push({ slot: 0, actorId: 0, kind: 0, fromX: 0, fromZ: 0, toX: 0, toZ: 0 });
	}

	/** Diffs this frame; returns how many landings `at(0 .. n - 1)` holds (reused records: read now, never keep). */
	update(state: BlinkWatchState, impKind: number): number {
		if (state !== this.lastState || state.tick < this.lastTick) {
			for (let i = 0; i < this.capacity; i++) this.ids[i] = 0;
			this.lastState = state;
		}
		this.lastTick = state.tick;
		const actors = state.combat.actors;
		const n = math.min(actors.size(), this.capacity);
		let count = 0;
		for (let i = 0; i < this.capacity; i++) {
			const a = i < n ? actors[i] : undefined;
			if (a === undefined || a.kind !== impKind || a.alive === 0) {
				this.ids[i] = 0;
				continue;
			}
			const tele = a.aiState === AiState.TELEGRAPH;
			const windup = tele && a.attack === IMP_ATTACK_BLINK;
			if (this.ids[i] === a.id && this.windup[i] && tele && a.attack === IMP_ATTACK_FAN) {
				const p = this.puffs[count];
				p.slot = i;
				p.actorId = a.id;
				p.kind = a.kind;
				p.fromX = this.xs[i];
				p.fromZ = this.zs[i];
				p.toX = a.x;
				p.toZ = a.z;
				count++;
			}
			this.ids[i] = a.id;
			this.windup[i] = windup;
			this.xs[i] = a.x;
			this.zs[i] = a.z;
		}
		return count;
	}

	at(i: number): Readonly<BlinkPuff> {
		return this.puffs[i];
	}
}

// ---------------------------------------------------------------------------------------------
// Fx hints

/**
 * Attack filters the view adds to an archetype's `ring` hint when the sim's hint has none: the summoner's casting circle
 * keys on aiState TELEGRAPH only, which its panic wind-up shares (summoner.ts view contract), so the view draws it only
 * during the summon (the panic wind-up gets the generic ring instead).
 */
const RING_ATTACK_FILTERS: ReadonlyMap<string, number> = new Map([[SUMMONER.id, SUMMONER_ATTACK_SUMMON]]);
/**
 * Archetypes whose aim line is drawn at its full length past intact breakables (docs/NEW_ENEMIES.md NE8): the
 * Charger's lane, since its charge breaks every piece it passes (charger.ts).
 */
const UNCLIPPED_AIM_IDS: ReadonlyArray<string> = [CHARGER.id];
const patchedHints = new Map<string, ActorFxHintsView>();

/**
 * Archetype `id`'s fx hints as the markings draw them (RING_ATTACK_FILTERS and UNCLIPPED_AIM_IDS applied; cached; the
 * hint itself when neither applies).
 */
export function viewFxHints(id: string, fx: ActorFxHintsView | undefined): ActorFxHintsView | undefined {
	if (fx === undefined) return undefined;
	const attack = RING_ATTACK_FILTERS.get(id);
	const ring = fx.ring;
	const patchRing = attack !== undefined && ring !== undefined && ring.attack === undefined;
	const aim = fx.aimLine;
	const patchAim = aim !== undefined && aim.clip === undefined && UNCLIPPED_AIM_IDS.includes(id);
	if (!patchRing && !patchAim) return fx;
	let p = patchedHints.get(id);
	if (p === undefined) {
		p = {
			aimLine: patchAim ? { ...aim!, clip: false } : aim,
			shockwave: fx.shockwave,
			ring: patchRing ? { ...ring!, attack } : ring,
			strikeRow: fx.strikeRow,
		};
		patchedHints.set(id, p);
	}
	return p;
}
