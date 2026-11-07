/**
 * Barrel for the gamepad menus' focus scopes (docs/GAMEPAD_MENUS.md GM2; the pure rules are shared/view/menu focus.ts
 * and padActions.ts): useFocusScope / FocusScope register a surface with the client's FocusController through
 * FocusScopesContext (HudController and LoadingController provide it), so components never import controllers. Its own
 * directory, below client/ui/hud and client/ui/menu (both use it), so neither imports the other through it. PAD_HOLD_UI
 * (padHold.ts) is the run-over hold-B fill FocusController writes and the Exit button draws (GM9).
 */
export * from "./FocusScope";
export * from "./padHold";
export * from "./scope";
