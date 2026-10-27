/**
 * Barrel for the game HUD (task 8 part B): the React + Reflex HUD, the pause overlay and the Options screen.
 * HudController mounts GameHud with HudActionsContext. docs/CLIENT.md "HUD". The primitives and the UIScale hook are
 * exported for the menu shell (client/ui/menu), which builds on them; the corner registry (cornerFade) for
 * HudOcclusionController (docs/HUD_LAYOUT.md H7).
 */
export * from "./actions";
export * from "./cornerFade";
export * from "./GameHud";
export * from "./primitives";
export * from "./useHudScale";
