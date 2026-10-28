# Player outline: plan

In a crowded room your own knight is hard to pick out among enemies, bullets and teammates. This plan adds a
theme-coloured rim around **your** character only. It is the player-side twin of the enemy outline (`docs/OUTLINE.md`)
and reuses both of its techniques. It is **presentation only**: nothing touches `src/shared/sim/**`, collision, a
replay or a hash.

## Status (2026-10-28)

P1-P6 are code-complete and verified headlessly only (typecheck, lint, `check:assets`, `test:art`, the theme / settings
/ view specs under Lune). The 8 knight outline sheets were uploaded 2026-10-28 8:35 AM (ids in `assetIds.ts`), so the
bundled vale pack draws the knight with its rim. **Nothing has run in Studio.** Open: P7 (the Studio check).

## Decisions

- **P1. Who:** the watched player only: the local player, or the teammate a dead player spectates
  (`SimController.getViewPlayerIndex`, the same index the local ring uses). Teammates never get it. A dead player
  drops it the tick they die (the death animation / lying capsule shows without it), like an enemy corpse.
- **P2. Depth:** Occluded. Walls hide the rim exactly as they hide the body (the BillboardGui's `AlwaysOnTop` stays
  false; the Highlight's DepthMode is Occluded).
- **P3. Width:** 1 art px on the knight (`widthPx: 1`). The placeholder capsule's Highlight width is the engine's.
- **P4. Default On:** Options > Display > Player outline (`DisplaySettings.playerOutline`, only Off stored, settings
  doc stays v2), plus the Workspace debug switch `KV_PlayerOutline` (boolean, absent = on).
- **P5. Colour:** one role `playerOutline` = `#f4f1ea`, the minimap's "you" (`minimap.self`). The ring's gold
  (`uiAccent`) was rejected: CIE76 38 from `telegraph` (< 40) and close to the knight's own tan body.
- **P6. Constant rim:** no hit flash or pulse on it; the i-frame tint and the post-hit blink act on the body (the blink
  hides the rim with it).

## As built

- **P1. Theme role** (`shared/theme`). `playerOutline` in `COLOR_ROLES`; `MIN_PLAYER_OUTLINE_CONTRAST` 3.0 on every
  biome floor and wall, `MIN_PLAYER_OUTLINE_DIFFERENCE` 40 (CIE76) from `PLAYER_OUTLINE_DIFFERENCE_ROLES` (the enemy
  bullets, `telegraph`, `enemyOutline`, every boost colour: a boost's aura is drawn on the player); `playerOutlineReport`
  wired into `validateManifest`; `PLAYER_OUTLINE_BAND_CHECK` in `shared/view/decor/profile.ts` covers the darkest band.
  `#f4f1ea` is >= 10.6:1 on every surface, >= 72 from the threats and >= 49 from every boost.
- **P2. Knight outline sheets** (`art/atlases.json` `class.vanguard`, `scripts/art/build-atlases.js`). The cells cannot
  grow (128 px, 8 x 8 fill a 1024 atlas; pad 2 would make them 132), so `outline` gained the opt-in
  `clipAtCellEdge: true`: the pad rule is lifted and the rim stops at the cell edge. The build prints what it clips
  (`rimClip`): only `vanguard-attack2` (3 of 64 cells, 20 body px); everything else that touches a cell edge is the baked
  shadow, which the body mask leaves out. The 8 body sheets came out byte-identical, so their ids stayed; `layout.ts`
  only gained `outlineFile` on each knight sheet. Specs: `build-atlases.test.js` (`outlineConfig`, `rimClip`, a pad-0
  set), `vale.spec.ts` (the knight carries its outline sheets; rimless until they are uploaded).
- **P3. Upload.** `vanguard-*-outline.png` (8 files) uploaded 2026-10-28 8:35 AM by k9kbdev.
- **P4. Rule** (`shared/view/outline.ts`). `PLAYER_OUTLINE` (role, the `Outlined` Model and `PlayerOutline` Highlight
  names, rim-only look, Occluded, `KV_PlayerOutline`) and `playerOutlined(isView, dead, settingOn, switchOn)`.
- **P5. Renderer** (`ActorRenderController`). Every player's `SpriteView` is built with the `playerOutline` rim and
  shows it while `playerOutlined` (`setOutlineShown`); the afterimages (`SpriteView.snapshot`) copy the frame only, so
  ghosts stay rimless. A placeholder capsule moves into `KV_Actors/Players/Outlined` (a Model with ONE Highlight) while
  outlined, reparented only on a change (death, a spectate switch, a toggle); the Highlight is Enabled while that
  capsule is also visible, so the hurt blink blinks the rim too. The setting is read through a store subscription and
  the attribute on change, never per frame. Engine Highlights in use: 3 (enemies, flashing, player).
- **P6. Setting.** `DEFAULT_PLAYER_OUTLINE` (`shared/settings/config.ts`), `DisplaySettings.playerOutline`, the Options
  row (order 5 on the Display tab), string `options.display.playerOutline` ("Player outline").

## Tasks

- [x] **P1. Theme role and validator.** → Verify: `playerOutline.spec.ts`, `validate.spec.ts`, `profile.spec.ts`.
- [x] **P2. Knight outline sheets.** → Verify: `npm run test:art`; body sheets byte-identical; contact sheet by eye.
- [x] **P3. Upload.** → Verify: `vale.spec.ts` (every id names an art/build file).
- [x] **P4. Rule.** → Verify: `outline.spec.ts`.
- [x] **P5. Renderer.** → Verify: typecheck / lint; Studio (P7).
- [x] **P6. Setting.** → Verify: `settings.spec.ts`, `hud.spec.ts`.
- [ ] **P7. Studio check and tuning.** `docs/CLIENT.md` "Player outline" smoke steps: solo and co-op (spectating), PC
  and the phone emulator, every biome and band, the setting and `KV_PlayerOutline`; judge the 1 px width and the colour
  next to the enemy rim and the ring.

## Risks

- **1 px on a phone.** The billboard scales the atlas down; a 1 px rim may shimmer or vanish at small sizes. Fallback:
  `widthPx: 2` (re-run `art:build`, re-upload the 8 outline sheets only; the body sheets stay byte-identical).
- **Clipped rim.** 3 attack.2 frames lose 20 rim px at the cell edge (sword tip / shield at full reach). Invisible at
  play speed; if not, trim those frames or move attack.2 to per-sheet cells.
- **Near-white on snow.** biome.3 (Snow) floor reads lighter than its manifest colour once textured; the validator
  passes on the manifest colour. Check in Studio.
