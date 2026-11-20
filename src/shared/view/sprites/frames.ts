/**
 * Sprite frames, billboards and looks (docs/CODEBASE_SCALE.md DX8: a pure move out of view/sprites.ts).
 *
 * @module
 */
import type { Pivot } from "shared/theme";
import { CAMERA_PITCH_DEG, PIXELS_PER_TILE, STUDS_PER_TILE } from "shared/config";
import { degToRad } from "../iso";
import { ACTOR_VIEW, SPRITE_VIEW } from "../config";
import { AiState } from "shared/sim";
import type { AnimSegment, SpriteAnimChoice, SpriteAnimSource } from "./facing";

// ---------------------------------------------------------------------------------------------
// Frames

/** A view's animation clock: the animation it is in and how many frames it has advanced (clock-driven ones). */
export interface SpriteClock {
	readonly anim: string;
	readonly phase: number;
}

/** The frame to show; keep it as the view's clock for the next call. */
export interface SpritePick extends SpriteClock {
	readonly frame: number;
}

/** floor(progress * frames), clamped to [0, frames - 1] (progress > 1 holds the last frame; NaN -> 0). */
export function stretchedFrame(progress: number, frames: number): number {
	const last = math.max(1, frames) - 1;
	const f = math.floor(progress * (last + 1));
	return f >= 0 ? math.min(f, last) : 0;
}

/** First frame of `segment` in a `frames`-frame animation: round(from * frames), clamped to [0, frames - 1] (NaN -> 0). */
export function segmentStart(segment: Readonly<AnimSegment>, frames: number): number {
	const n = math.max(1, frames);
	const f = math.round(segment.from * n);
	return f >= 0 ? math.min(f, n - 1) : 0;
}

/** Frames in `segment`: from segmentStart up to round(to * frames) (clamped to the animation), at least one. */
export function segmentLength(segment: Readonly<AnimSegment>, frames: number): number {
	const n = math.max(1, frames);
	const e = math.round(segment.to * n);
	const stop = e <= n ? e : n; // NaN -> n
	return math.max(1, stop - segmentStart(segment, n));
}

/** stretchedFrame inside `segment` (the whole animation when undefined): its first frame + floor(progress * length). */
export function segmentFrame(progress: number, frames: number, segment?: Readonly<AnimSegment>): number {
	if (segment === undefined) return stretchedFrame(progress, frames);
	return segmentStart(segment, frames) + stretchedFrame(progress, segmentLength(segment, frames));
}

/**
 * The frame of `choice` this render frame. Stretched: from its progress (inside its segment, if any). Clock-driven: the clock restarts at frame 0
 * when the animation changes (or with no clock), else advances `dtSec * fps * rate` frames; loops wrap, one-shots
 * hold their last frame. An animation the set lacks (only idle can get here) shows frame 0.
 */
export function spriteFrame(
	anims: SpriteAnimSource,
	choice: SpriteAnimChoice,
	clock: SpriteClock | undefined,
	dtSec: number,
): SpritePick {
	const anim = choice.anim;
	const def = anims.animation(anim);
	if (def === undefined) return { anim, phase: 0, frame: 0 };
	const frames = math.max(1, def.frames);
	const progress = choice.progress;
	if (progress !== undefined) return { anim, phase: 0, frame: segmentFrame(progress, frames, choice.segment) };
	if (clock === undefined || clock.anim !== anim) return { anim, phase: 0, frame: 0 };
	let phase = clock.phase + math.max(0, dtSec) * def.fps * choice.rate;
	if (!(phase >= 0)) phase = 0;
	if (def.loop) {
		phase -= math.floor(phase / frames) * frames;
		return { anim, phase, frame: math.min(frames - 1, math.floor(phase)) };
	}
	phase = math.min(phase, frames);
	return { anim, phase, frame: math.min(frames - 1, math.floor(phase)) };
}

// ---------------------------------------------------------------------------------------------
// Billboard

/** The SpriteSetAsset fields that size and place the billboard. */
export interface SpriteLayout {
	readonly frameW: number;
	readonly frameH: number;
	readonly pivot: Readonly<Pivot>;
	readonly pixelsPerTile: number;
}

/**
 * Billboard size in studs and the offset from the actor's feet (the anchor) to the billboard's centre in billboard /
 * camera space (x right, y up, z toward the camera), so the pivot pixel lands on the feet. Moving along z does not move
 * the sprite on screen; it moves it in depth.
 *
 * Floor clearance. The billboard is a screen-aligned plane through the feet, tilted back by the camera pitch, and it is
 * depth-tested. The cell below the pivot (the baked shadow, the feet's lower edge) hangs down the camera's up axis, and
 * a point `b` studs down that axis is b * cos(pitch) below the feet: under the floor, so the floor would hide it. A
 * shift `d` toward the camera raises every point by d * sin(pitch), so the whole cell clears the floor when
 * d >= b * cot(pitch). offsetZ = that minimum (plus SPRITE_VIEW.floorClearanceMarginStuds) + `depthBiasStuds`
 * (SPRITE_VIEW.depthBiasStuds, the wall tuning of spike S0, on top).
 */
export interface SpriteBillboard {
	readonly w: number;
	readonly h: number;
	readonly offsetX: number;
	readonly offsetY: number;
	readonly offsetZ: number;
}

/** The camera-ward shift that lifts a point `belowStuds` down the camera's up axis back onto the floor (+ margin). */
export function floorClearanceStuds(belowStuds: number, pitchDeg: number = CAMERA_PITCH_DEG): number {
	if (!(belowStuds > 0)) return 0;
	const p = degToRad(pitchDeg);
	return (belowStuds * math.cos(p)) / math.sin(p) + SPRITE_VIEW.floorClearanceMarginStuds;
}

export function spriteBillboard(
	layout: SpriteLayout,
	studsPerTile: number = STUDS_PER_TILE,
	depthBiasStuds: number = SPRITE_VIEW.depthBiasStuds,
	pitchDeg: number = CAMERA_PITCH_DEG,
): SpriteBillboard {
	const s = studsPerTile / layout.pixelsPerTile;
	const below = (layout.frameH - layout.pivot.y) * s;
	return {
		w: layout.frameW * s,
		h: layout.frameH * s,
		offsetX: (layout.frameW / 2 - layout.pivot.x) * s,
		offsetY: (layout.pivot.y - layout.frameH / 2) * s,
		offsetZ: floorClearanceStuds(below, pitchDeg) + depthBiasStuds,
	};
}

/**
 * Where a flat floor image's centre sits relative to its pivot (default: the centre, so [0, 0]), studs, in the frame
 * floorImageSize lays it in: [x along the camera's right, z toward the camera], with the image's top edge away from the
 * camera (rows down the image = toward the camera, stretched by 1 / sin(pitch) like its depth).
 */
export function floorImageOffset(
	wPx: number,
	hPx: number,
	pixelsPerTile: number,
	pivot?: Readonly<Pivot>,
	studsPerTile: number = STUDS_PER_TILE,
	pitchDeg: number = CAMERA_PITCH_DEG,
): readonly [number, number] {
	if (pivot === undefined) return [0, 0];
	const s = studsPerTile / pixelsPerTile;
	return [(wPx / 2 - pivot.x) * s, ((hPx / 2 - pivot.y) * s) / math.sin(degToRad(pitchDeg))];
}

/**
 * A flat floor image (the co-op ring) in studs, [x, z]: x = w / pixelsPerTile tiles; z is h / pixelsPerTile tiles
 * stretched by 1 / sin(pitch), because the art is drawn as seen on screen and the camera foreshortens the floor's
 * depth by sin(pitch). Lay it with its x axis along the camera's right (turned by the camera yaw).
 */
export function floorImageSize(
	wPx: number,
	hPx: number,
	pixelsPerTile: number,
	studsPerTile: number = STUDS_PER_TILE,
	pitchDeg: number = CAMERA_PITCH_DEG,
): readonly [number, number] {
	const s = studsPerTile / pixelsPerTile;
	return [wPx * s, (hPx * s) / math.sin(degToRad(pitchDeg))];
}

/**
 * A camera-facing image `heightTiles` tall (the whole image) with `pivot` (default: its bottom centre) on the anchor,
 * e.g. the relic pedestal's beam on the pedestal's top; the part below the pivot clears that surface like a sprite.
 */
export function uprightImageBillboard(
	wPx: number,
	hPx: number,
	heightTiles: number,
	pivot?: Readonly<Pivot>,
	studsPerTile: number = STUDS_PER_TILE,
): SpriteBillboard {
	return spriteBillboard(
		{ frameW: wPx, frameH: hPx, pivot: pivot ?? { x: wPx / 2, y: hPx }, pixelsPerTile: hPx / heightTiles },
		studsPerTile,
		0,
	);
}

/**
 * The animation clock's step this render frame: sim seconds since the last frame ((tick + alpha) / SIM_HZ), so it
 * stops while the run is paused and follows hitstop; 0 on the first frame, capped at SPRITE_VIEW.maxAnimDtSec, never
 * negative (a new run).
 */
export function animDtSec(prevSimSec: number | undefined, simSec: number): number {
	if (prevSimSec === undefined) return 0;
	const d = simSec - prevSimSec;
	return d > 0 ? math.min(d, SPRITE_VIEW.maxAnimDtSec) : 0;
}

// ---------------------------------------------------------------------------------------------
// Looks (shared by the placeholder and sprite paths of ActorRenderController)

/** An actor's / the player's tint state; every look but "normal" names a colour role in ACTOR_VIEW.lookRoles. */
export type ActorLook = "normal" | "flash" | "telegraph" | "iframes" | "dead";

/** Actor: the hit flash, else the telegraph pulse (ACTOR_VIEW.telegraphPulseTicks on / off) while winding up. */
export function actorLook(alive: number, flashTicks: number, aiState: number, tick: number): ActorLook {
	if (alive === 0) return "normal";
	if (flashTicks > 0) return "flash";
	const pulseOn = math.floor(tick / ACTOR_VIEW.telegraphPulseTicks) % 2 === 0;
	return aiState === AiState.TELEGRAPH && pulseOn ? "telegraph" : "normal";
}

/** Player: dead, else dodge i-frames. */
export function playerLook(dead: number, iframeTicks: number): ActorLook {
	if (dead !== 0) return "dead";
	return iframeTicks > 0 ? "iframes" : "normal";
}

/** The post-hit blink (ACTOR_VIEW.blinkTicks shown / hidden, from the sim's hurtTicks): is the player drawn? */
export function playerBlinkVisible(dead: number, hurtTicks: number): boolean {
	return dead !== 0 || hurtTicks === 0 || math.floor(hurtTicks / ACTOR_VIEW.blinkTicks) % 2 === 0;
}

/**
 * Corpse fade: 0 alive, deadTicks / corpseTicks while dead (1 at once without a corpse time). `fadeFrom` (default 0)
 * holds it at 0 for that fraction of the corpse time and fades over the rest (boss sprites: their death plays first).
 */
export function corpseTransparency(alive: number, deadTicks: number, corpseTicks: number, fadeFrom = 0): number {
	if (alive !== 0) return 0;
	if (!(corpseTicks > 0)) return 1;
	const t = deadTicks / corpseTicks;
	if (fadeFrom <= 0) return math.clamp(t, 0, 1);
	if (fadeFrom >= 1) return t >= 1 ? 1 : 0;
	return math.clamp((t - fadeFrom) / (1 - fadeFrom), 0, 1);
}

/**
 * A boss sprite's layout, drawn at least `minDrawPx` web pixels wide (ACTOR_VIEW.bossMinDrawPx, the placeholder
 * bosses' rule, at PIXELS_PER_TILE pixels per tile): the layout itself when it already is, else a copy with a smaller
 * pixelsPerTile (the billboard grows, the pivot stays on the feet).
 */
export function bossSpriteLayout(layout: SpriteLayout, minDrawPx: number): SpriteLayout {
	if (!(layout.frameW > 0) || !(layout.pixelsPerTile > 0)) return layout;
	if ((layout.frameW / layout.pixelsPerTile) * PIXELS_PER_TILE >= minDrawPx) return layout;
	return {
		frameW: layout.frameW,
		frameH: layout.frameH,
		pivot: layout.pivot,
		pixelsPerTile: (layout.frameW * PIXELS_PER_TILE) / minDrawPx,
	};
}
