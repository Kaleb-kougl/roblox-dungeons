/**
 * Barrel for the HUD's pure helpers and tunables: the font token, layout sizes, the UIScale rule, hearts, the clock,
 * boss phases, every theme string key the HUD and the Options screen read, and the tutorial's HUD / marker
 * presentation (tutorial.ts), the co-op spectate bar (spectate.ts), the corner panels' anchors (corners.ts), the
 * timed hints (hints.ts), the in-run HUD's footprint budget (footprint.ts, docs/HUD_LAYOUT.md H2; the corner minimap's box, minimapHud.ts), wrapping rows
 * of equal cells (wrap.ts), the corner panels' occlusion fade (occlusion.ts, H7) and the combo's tiers, kill pitch,
 * display state machine and floor shout test (comboConfig.ts, combo.ts; docs/COMBO.md CB2), and how the combo row, meter
 * and floor shout are drawn (comboDraw.ts, CB6 / CB7), the PARRY! floor flash's placement, size, opacity and label
 * (parryFlash.ts, docs/GRAZE_PARRY.md GP7), and the boon draft reveal's tunables and state machine
 * (draftRevealConfig.ts, draftReveal.ts; docs/DRAFT_REVEAL.md DR1) and how it is drawn (draftRevealView.ts, DR5), and the
 * UI skin's pixel scales, icon fit and part-to-image chains (skinConfig.ts, skin.ts; docs/UI_ART.md UA5), and the
 * new-best celebration's tunables, strings, frozen run baseline, per-frame tracker, text / roll helpers and confetti
 * paths (newBestConfig.ts, newBestStrings.ts, newBest.ts; docs/NEW_BEST.md NB3), and the builds HUD: draft card kinds
 * (draftCards.ts, docs/BUILDS.md BU9), items-row cells and the Build list (buildHud.ts, BU10).
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
export * from "./minimapHud";
export * from "./wrap";
export * from "./occlusion";
export * from "./touchLayout";
export * from "./touchStrip";
export * from "./touch";
export * from "./roomClear";
export * from "./comboConfig";
export * from "./combo";
export * from "./comboStrings";
export * from "./comboDraw";
export * from "./parryFlash";
export * from "./draftRevealConfig";
export * from "./draftReveal";
export * from "./draftRevealView";
export * from "./draftCards";
export * from "./buildHud";
export * from "./skinConfig";
export * from "./skin";
export * from "./hudSkin";
export * from "./newBestConfig";
export * from "./newBestStrings";
export * from "./newBest";
