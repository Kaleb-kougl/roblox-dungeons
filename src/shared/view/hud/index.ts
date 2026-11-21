/**
 * Barrel for the HUD's pure helpers and tunables: the font token, layout sizes, the UIScale rule, hearts, the clock,
 * boss phases, every theme string key the HUD and the Options screen read, the solo run-over line (runOverLine.ts), and the tutorial's HUD / marker
 * presentation (tutorial.ts), the co-op spectate bar (spectate.ts), the corner panels' anchors (corners.ts), the
 * timed hints (hints.ts), the in-run HUD's footprint budget (footprint.ts, docs/HUD_LAYOUT.md H2; the corner minimap's box, minimapHud.ts), wrapping rows
 * of equal cells (wrap.ts), the corner panels' occlusion fade (occlusion.ts, H7) and the combo's tiers, kill pitch,
 * display state machine and floor shout test (comboConfig.ts, combo.ts; docs/COMBO.md CB2), and how the combo row, meter
 * and floor shout are drawn (comboDraw.ts, CB6 / CB7), the PARRY! floor flash's placement, size, opacity and label
 * (parryFlash.ts, docs/GRAZE_PARRY.md GP7), the SYNC! callout's label, size and tether opacity (syncCallout.ts,
 * docs/RUN_RECAP.md CM5), and the boon draft reveal's tunables and state machine
 * (draftRevealConfig.ts, draftReveal.ts; docs/DRAFT_REVEAL.md DR1) and how it is drawn (draftRevealView.ts, DR5), and the
 * UI skin's pixel scales, icon fit and part-to-image chains (skinConfig.ts, skin.ts; docs/UI_ART.md UA5), and the
 * new-best celebration's tunables, strings, frozen run baseline, per-frame tracker, text / roll helpers and confetti
 * paths (newBestConfig.ts, newBestStrings.ts, newBest.ts; docs/NEW_BEST.md NB3), the builds HUD: draft card kinds
 * (draftCards.ts, docs/BUILDS.md BU9), items-row cells and the Build list (buildHud.ts, BU10), and the seeded roster's
 * stage card line and its priority against new best's (rosterLine.ts, docs/DAILY.md DS2), the Daily's menu / result
 * strings, text helpers (countdown, UTC date, standing), leaderboard tabs and run-over daily block (dailyStrings.ts,
 * dailyText.ts, dailyBoard.ts, dailyResult.ts; docs/DAILY.md DS9 / DS11), and the Daily's in-run rank layer:
 * tunables, strings, frozen rank baseline, tracker and text helpers (dailyRankConfig.ts, dailyRankStrings.ts,
 * dailyRank.ts; docs/DAILY.md DS10), Options > Display > Language's choices and labels (language.ts,
 * docs/LOCALIZATION.md L6), and the run-over recap's tunables, highlight table, strings, near-miss line, highlights,
 * stairs distance and timeline (recapConfig.ts, recap.ts; docs/RUN_RECAP.md RR2) and how the recap is drawn (recapUi.ts,
 * RR5), and the co-op contribution's rows, shares, standing and titles (contributionConfig.ts, contribution.ts;
 * docs/RUN_CONTRIBUTION.md CT3), how its tabs, You card and Party rows are drawn (contributionUi.ts, CT5) and the
 * recap's clocks per tab (recapViews.ts, CT7), and the characters on the HUD (docs/ARCHER.md AR9 / AR10): the weapon
 * sets shown and the swap target (weaponSets.ts), the per-character string overrides of the progression texts
 * (characterText.ts) and the character icons (characterIcon.ts).
 *
 * @module
 */
export * from "./layout";
export * from "./strings";
export * from "./runOverLine";
export * from "./progression";
export * from "./options";
export * from "./language";
export * from "./tutorial";
export * from "./spectate";
export * from "./corners";
export * from "./hints";
export * from "./footprint";
export * from "./minimapHud";
export * from "./wrap";
export * from "./occlusion";
export * from "./bossBarPlace";
export * from "./touchLayout";
export * from "./touchTutorial";
export * from "./weaponSets";
export * from "./characterText";
export * from "./characterIcon";
export * from "./touchStrip";
export * from "./touch";
export * from "./roomClear";
export * from "./comboConfig";
export * from "./combo";
export * from "./comboStrings";
export * from "./comboDraw";
export * from "./parryFlash";
export * from "./syncCallout";
export * from "./draftRevealConfig";
export * from "./draftReveal";
export * from "./draftRevealView";
export * from "./draftCards";
export * from "./buildHud";
export * from "./tooltip";
export * from "./tooltipConfig";
export * from "./skinConfig";
export * from "./skin";
export * from "./hudSkin";
export * from "./newBestConfig";
export * from "./newBestStrings";
export * from "./newBest";
export * from "./rosterLine";
export * from "./dailyStrings";
export * from "./dailyText";
export * from "./dailyBoard";
export * from "./dailyResult";
export * from "./dailyRankConfig";
export * from "./dailyRankStrings";
export * from "./dailyRank";
export * from "./recapConfig";
export * from "./recap";
export * from "./recapUi";
export * from "./contributionConfig";
export * from "./contribution";
export * from "./contributionUi";
export * from "./recapViews";
export * from "./overcapPopDuck";
