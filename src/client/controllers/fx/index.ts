/**
 * Barrel for the juice controllers (task 8 part B; render side only): the FX hit tracker that turns each frame's sim
 * changes into events, enemy health bars, damage numbers, death particles, sprite effects (FxSpriteController,
 * docs/FX_AUDIO.md F4), the freeze frame (+ camera nudge), the room clear celebration (RoomClearController,
 * docs/ROOM_CLEAR.md), the combo's row / meter / floor shout / break kick (ComboController, docs/COMBO.md CB7), the one
 * near-miss director (NearMissController) and the PARRY! floor flash + solo freeze (ParryFlashController,
 * docs/GRAZE_PARRY.md GP7). The pure logic is shared/view/fx (and shared/view/hud for the combo and the PARRY! text);
 * these only draw it.
 * docs/CLIENT.md "Juice".
 */
export * from "./FxTrackerController";
export * from "./FreezeFrameController";
export * from "./HealthBarController";
export * from "./DamageNumberController";
export * from "./ParticleController";
export * from "./ScorePopController";
export * from "./FxSpriteController";
export * from "./HurtFlashController";
export * from "./ComboController";
export * from "./RoomClearController";
export * from "./NearMissController";
export * from "./ParryFlashController";
