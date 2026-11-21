/**
 * Barrel for the menu shell and the lobby screens (tasks L3 / L5; React + Reflex): MenuLayer (its own ScreenGui:
 * main menu, lobby browser, lobby room, invite toasts / badge, lobby notices) and MenuActionsContext. HudController
 * mounts MenuLayer next to GameHud. The view logic is pure in shared/view/menu. docs/CLIENT.md "Main menu and lobbies".
 *
 * @module
 */
export * from "./actions";
export * from "./MenuLayer";
