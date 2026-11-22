/**
 * The actors' hit reaction (docs/FEEL.md J4 / J5; docs/ACTOR_RENDER.md): the reaction clock, the tracker feed, and the
 * look it puts on a view each frame: a sprite's rim flash, hold and texel push; a placeholder's push offset and its
 * move under the flashing Model. Owned by ActorRenderController, which calls it inside its actor loop.
 *
 * @module
 */
import type { Janitor } from "@rbxts/janitor";
import { Workspace } from "@rbxts/services";
import type { JuiceSettings } from "shared/settings";
import type { ThemePack } from "shared/theme";
import { ACTOR_OUTLINE, outlineSwitchOn, type ActorGroup, type IsoBasis } from "shared/view";
import {
	FEEL_HIT,
	HitReactSlots,
	freezeFrameOn,
	motionScale,
	nearestLivingPlayer,
	pushOffsetStuds,
	type FxEventBuffer,
} from "shared/view/fx";
import type { FxTrackerController } from "../../fx/FxTrackerController";
import type { SimController } from "../../game/SimController";
import { setModelParent, type PlaceholderModel } from "../placeholders";
import { SPRITE_TINT_NONE } from "../SpriteView";
import { buildOutline } from "./actorParts";
import { HIDDEN, type ActorView } from "./actorViews";

/**
 * The hit reaction of every actor view (docs/FEEL.md J4 / J5): built with the controller, started from its onStart
 * (the flashing Model, its Highlight and the tracker's frame feed), then asked once per actor per frame, before the
 * actor is drawn.
 */
export class ActorHitReact {
	private readonly hitReact: HitReactSlots;
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

	/** The actor folder's groups (enemies / corpses / players), from {@link start}. */
	private groups: Readonly<Record<ActorGroup, Instance>> | undefined;
	/** enemyShield: a sprite's rim flash on a shield hit when no hit flash runs. */
	private shieldColor = SPRITE_TINT_NONE;

	constructor(
		private readonly sim: SimController,
		private readonly fx: FxTrackerController,
		private readonly basis: IsoBasis,
		private readonly janitor: Janitor,
	) {
		this.hitReact = new HitReactSlots(basis);
	}

	/** Seconds since slot `slot`'s actor `actorId` was last hit, on the hit-reaction clock (docs/DUMMY_ART.md DD1). */
	hitAge(slot: number, actorId: number): number {
		return this.hitReact.hitAge(slot, actorId, this.hitNow);
	}

	/**
	 * The flashing Model (a sibling of the enemies Model) with its ONE Highlight, and the tracker feed. The Highlight
	 * fills in FEEL_HIT.flashRole; its rim is the enemies Highlight's while KV_EnemyOutline is on and hidden while it
	 * is off (the flash itself always shows, like the sprites' rim flash).
	 */
	start(pack: ThemePack, folder: Folder, groups: Readonly<Record<ActorGroup, Instance>>, shieldColor: Color3): void {
		this.groups = groups;
		this.shieldColor = shieldColor;
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
	applyHitReact(slot: number, view: ActorView, shieldFlash: boolean): void {
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
	syncModelGroup(view: ActorView, model: PlaceholderModel): void {
		const parent =
			view.flashing && this.flashingModel !== undefined
				? this.flashingModel
				: this.groups![view.outlined ? "enemies" : "corpses"];
		setModelParent(model, parent);
	}
}
