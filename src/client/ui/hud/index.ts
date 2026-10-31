/**
 * Barrel for the game HUD (task 8 part B): the React + Reflex HUD, the pause overlay and the Options screen.
 * HudController mounts GameHud with HudActionsContext. docs/CLIENT.md "HUD". The primitives and the UIScale hook are
 * exported for the menu shell (client/ui/menu), which builds on them; the corner registry (cornerFade) for
 * HudOcclusionController (docs/HUD_LAYOUT.md H7); the minimap's host registry (minimapHosts) and the corner map's show
 * rule (MinimapPanel cornerMapShown) for MinimapController (docs/MINIMAP.md M8); the combo row and meter's bindings
 * (comboUi COMBO_UI) for ComboController (docs/COMBO.md CB6 / CB7); the draft reveal's bindings (draftUi DRAFT_UI) for
 * DraftRevealController (docs/DRAFT_REVEAL.md DR5 / DR6).
 */
export * from "./actions";
export * from "./cornerFade";
export * from "./comboUi";
export * from "./draftUi";
export * from "./minimapHosts";
export * from "./MinimapPanel";
export * from "./GameHud";
export * from "./MenuFit";
export * from "./primitives";
export * from "./roomClearBindings";
export * from "./ScreenDim";
export * from "./useHudScale";
