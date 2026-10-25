/**
 * Barrel for the menu shell and lobby UI's pure half (tasks L3, L5, L6; client/ui/menu draws it): the screen + back
 * stack reducer (nav.ts), the lobby screens' view models and run handoff / exit rules (lobby.ts), every menu / lobby
 * string key (strings.ts) and the layout tunables and menu keys (config.ts). Headlessly tested (menu.spec.ts; the
 * string keys in shared/view/hud hud.spec.ts).
 */
export * from "./config";
export * from "./nav";
export * from "./lobby";
export * from "./strings";
