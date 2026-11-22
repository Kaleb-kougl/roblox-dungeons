/**
 * The actor renderer's records and shared constants (docs/ACTOR_RENDER.md): one {@link ActorView} per occupied actor
 * slot, one {@link PlayerView} per party member with its optional {@link Ring}. Mutable caches of what was last
 * written to the Instances, so a frame writes a property only when it changes.
 *
 * @module
 */
import type { CosmeticLook } from "shared/cosmetics";
import type { ActorState } from "shared/sim";
import { BULLET_VIEW, type ActorLook, type ActorSpriteInput, type VariantLook } from "shared/view";
import type { PlaceholderModel } from "../placeholders";
import type { SpriteView } from "../SpriteView";

/** Where every unused part waits (BULLET_VIEW.parkedStuds: far under the floor). */
export const PARKED = new CFrame(BULLET_VIEW.parkedStuds[0], BULLET_VIEW.parkedStuds[1], BULLET_VIEW.parkedStuds[2]);
/** A fully transparent part (Transparency). */
export const HIDDEN = 1;
/** A player view's cosmetic colour not written yet (rgb8Key gives -1 for none, >= 0 for a colour). */
export const UNWRITTEN = -2;

/** Pip: a flat diamond (the ui.cursor placeholder turned 45 degrees), this thin, scaled down from its cell. */
export const PIP_THICKNESS = 0.05;
/** The pip's size as a fraction of the `ui.cursor` placeholder's cell. */
export const PIP_SCALE = 0.35;

/** The co-op ring under a player (`ui.ring.player`, a Decal on a flat invisible Part). */
export interface Ring {
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
export interface PlayerView {
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
	/**
	 * docs/COSMETICS.md CS5: the colours last written for this player's look (rgb8Key; -2: never written): the dye,
	 * the rim (an outline item, else playerOutline) and the roll trail, each rebuilt as a Color3 only on a change.
	 */
	dyeKey: number;
	rimKey: number;
	trailKey: number;
	rimColor: Color3 | undefined;
	/**
	 * The look and sprite set the keys above were last computed for, and whether that look animates (Prismatic): an
	 * unchanged, still look skips applyLook's colour work entirely (no allocation per frame).
	 */
	cosmeticRef: CosmeticLook | undefined;
	cosmeticVisual: string;
	cosmeticAnimated: boolean;
}

/**
 * One occupied actor slot's view: a pooled SpriteView (art) or a pooled placeholder model (every other id, and the
 * stand-in while the art is not ready), with the look last written to it.
 */
export interface ActorView {
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
