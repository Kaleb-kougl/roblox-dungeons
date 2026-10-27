/**
 * Barrel for the HUD's pure helpers and tunables: the font token, layout sizes, the UIScale rule, hearts, the clock,
 * boss phases, every theme string key the HUD and the Options screen read, and the tutorial's HUD / marker
 * presentation (tutorial.ts), the co-op spectate bar (spectate.ts), the corner panels' anchors (corners.ts), the
 * timed hints (hints.ts), the in-run HUD's footprint budget (footprint.ts, docs/HUD_LAYOUT.md H2), wrapping rows
 * of equal cells (wrap.ts) and the corner panels' occlusion fade (occlusion.ts, H7).
 */
export * from "./layout";
export * from "./strings";
export * from "./progression";
export * from "./options";
export * from "./tutorial";
export * from "./spectate";
export * from "./corners";
export * from "./hints";
export * from "./footprint";
export * from "./wrap";
export * from "./occlusion";
