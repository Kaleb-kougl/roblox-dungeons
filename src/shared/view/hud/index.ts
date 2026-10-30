/**
 * Barrel for the HUD's pure helpers and tunables: the font token, layout sizes, the UIScale rule, hearts, the clock,
 * boss phases, every theme string key the HUD and the Options screen read, and the tutorial's HUD / marker
 * presentation (tutorial.ts), the co-op spectate bar (spectate.ts), the corner panels' anchors (corners.ts), the
 * timed hints (hints.ts), the in-run HUD's footprint budget (footprint.ts, docs/HUD_LAYOUT.md H2; the corner minimap's box, minimapHud.ts), wrapping rows
 * of equal cells (wrap.ts), the corner panels' occlusion fade (occlusion.ts, H7) and the combo's tiers, kill pitch,
 * display state machine and floor shout test (comboConfig.ts, combo.ts; docs/COMBO.md CB2), and how the combo row, meter
 * and floor shout are drawn (comboDraw.ts, CB6 / CB7), and the PARRY! floor flash's placement, size, opacity and label
 * (parryFlash.ts, docs/GRAZE_PARRY.md GP7).
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
export * from "./touch";
export * from "./roomClear";
export * from "./comboConfig";
export * from "./combo";
export * from "./comboStrings";
export * from "./comboDraw";
export * from "./parryFlash";
