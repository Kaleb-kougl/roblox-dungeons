# Enemy outlines: plan

Enemies are hard to see when their colour is close to the floor's: the Lords of Pain skeleton (`enemy.swarmer`) on the
dark stone floor (vale biome.1 mean `#1a1619`), and placeholder bodies like `enemy.summoner` `#5a8a4a` on the verdant
floor. This plan adds a theme-coloured contrast outline to every enemy and the boss. Work it task by task, like
`PLAN.md` and `docs/DECOR.md`; each task ends with a **Verify**. It is **presentation only**: nothing touches
`src/shared/sim/**`, collision, or a replay hash.

## Status (2026-10-26, `main`)

O1-O4 and the O7 docs are **code-complete and verified headlessly only**: typecheck, lint, `check:assets`,
`test:art` (24 node:test specs of the atlas pipeline) and the Lune suite (1637 tests, all passing on the aarch64 VM,
including the `forge.spec.ts` vector that fails on x86). **Nothing has run in Studio.** O5 is done (the four swarmer
files re-uploaded 2026-10-26 9:25). Open: O6 (the Studio check, `docs/CLIENT.md` "Enemy outlines" smoke steps).

The O3 pad change re-cut the skeleton's atlases (94x70 -> 98x74 cells), so its old ids were dropped and the two
atlases were re-uploaded with both outline sheets (O5); the bundled vale pack now draws the skeleton with its rim
(`vale.spec` checks every swarmer frame carries its sheet's outline). Whenever `art:build` changes one of these PNGs,
re-upload it and paste the new id.

As built, differing from the text below:

- **O1.** `MIN_ENEMY_OUTLINE_CONTRAST` 3.0 and `MIN_ENEMY_OUTLINE_BULLET_DIFFERENCE` 40 in `contract.ts`;
  `enemyOutlineReport` in `validate.ts` (wired into `validateManifest`). The darkest-band check is not in the
  validator (theme cannot import shared/view, as for the bullet): `decorBandContrastReport(manifest, band, check)` now
  takes a `DecorBandContrastCheck` (`ENEMY_BULLET_BAND_CHECK`, `ENEMY_OUTLINE_BAND_CHECK`), and `profile.spec` runs
  both for every bundled pack at every band. Every `enemy.*` archetype (the dummy too) and `boss.*` visual carries
  `outline: "enemyOutline"`; the lowest contrast of `#ff3b30` on any floor or wall is 3.40:1.
- **O2.** `shared/view/outline.ts`: `ACTOR_OUTLINE` (role, group names, `EnemyOutline` Highlight settings,
  `KV_EnemyOutline`), `outlineSwitchOn`, `actorOutlined(hasOutline, alive, enabled)`, `actorGroup`. Parenting ignores
  the switch (toggling never reparents); the Highlight's `Enabled` follows the attribute through
  `GetAttributeChangedSignal`. Released models wait under `Corpses`. Sprite anchors stay directly in `KV_Actors`.
- **O3.** `scripts/art/build-atlases.js` exports its pure helpers (`outlineConfig`, `bodyMask`, `discOffsets`,
  `dilateCells`, `outlineSheet`, ...) and runs `main()` only as a script; `scripts/art/build-atlases.test.js`
  (`npm run test:art`, part of `verify`). The layout's sprite sheets gain `outlineFile`; the knight is byte-identical.
  Per cell of the real build: 186-318 (move) / 190-410 (death) rim pixels, none inside the opaque body, no cell
  without a rim, nothing on a cell's border.
- **O4.** `SpriteSheetImage.outlineAssetId` (validated like `assetId`, and never equal to it), `SpriteFrame.outlineImage`,
  `spriteSheetOutline`; a malformed outline id draws the sheet rimless with one warning. `SpriteView(set, parent,
  layout, extraDepthStuds, outline?)`: an `Outline` ImageLabel at ZIndex 1 under the frame's 2 (`ZIndexBehavior`
  Sibling), `setOutlineShown`; `spriteOutlineVisible` in `shared/view/outline.ts`.

## What existed (read 2026-10-26)

`ActorRenderController` draws every actor one of two ways, and the outline needs a different technique for each:

| Path | Who uses it | How it draws | Outline technique |
|---|---|---|---|
| **Sprites** | `enemy.swarmer` only (`ACTOR_SPRITE_INPUTS` has one entry), and the player | `SpriteView`: a BillboardGui + one ImageLabel on an invisible feet anchor; tints through `ImageColor3` | A second, **baked outline sheet** drawn behind the frame (O3, O4) |
| **Placeholders** | every other enemy, `boss.act1`, the tutorial dummy, and every enemy in the placeholder pack | 3D Parts from `buildPlaceholder`, moved by one `BulkMoveTo`, parented to the `KV_Actors` Folder | One **`Highlight`** on a shared enemies Model (O2) |

- **`Highlight` does not work on GUI** (Parts and Models only), so it cannot outline a billboard sprite.
- **`UIStroke` strokes the ImageLabel's rectangle**, not the image's alpha.
- No `Highlight` was used before, so the engine's limit (31 rendered at once) is all ours; one per enemy (or bullet)
  would blow it, hence one shared Highlight.
- The atlas pipeline already had a body mask (alpha > `bodyAlpha` and max(R,G,B) > `bodyMinRgb`) that leaves out the
  pack's black baked shadow, so the rim traces the body, not the shadow.

## Decisions

- **E1. One colour role `enemyOutline`, hostile red `#ff3b30`.** >= 3.4:1 on every biome floor and wall; CIE76 63 from
  `enemyBullet`, 98 from `enemyBulletOutline`. Weakest gap: 35 from `telegraph` `#ff8a3d` (the telegraph tints the
  body or draws on the floor, never the rim). Fallback yellow `#ffe14d` is only 16 from `boss`. The boss shares the role.
- **E2. Who:** every enemy archetype, the boss and the tutorial dummy; not players. Corpses lose the rim at death.
- **E3. DepthMode `Occluded`.** `AlwaysOnTop` would show enemies behind near-side walls, but also every enemy in the
  next rooms. Revisit in O6.
- **E4. Width:** 2 art px on sprites (`widthPx` 1-4, pad >= widthPx + 1); the Highlight's width is fixed. Match by eye.
- **E5. Constant rim:** no telegraph pulse or hit flash on it.
- **E6. On by default;** `KV_EnemyOutline` (boolean) for A/B in Studio. An Options toggle is not in v1.

## Tasks

- [x] **O1. Theme role and validator.** `enemyOutline` role, contrast and colour-difference rules, `outline` on enemy
  and boss visuals. → Verify: validator specs (floor-coloured, bullet-coloured and darkest-band-only failures; the
  bundled packs clean).
- [x] **O2. Placeholder enemies: one shared `Highlight`.** `Enemies` / `Corpses` / `Players` under `KV_Actors`, one
  Highlight on `Enemies`, reparent on death and release, `actorOutlined`, `KV_EnemyOutline`.
  → Verify: specs for the pure rules; in Studio (O6) every archetype and the boss show a rim, corpses lose it.
- [x] **O3. Outline sheets in the atlas pipeline.** `"outline": { "widthPx": 2 }` on `enemy.swarmer`, pad 3,
  `<sheet>-outline.png`, `outlineFile` in `layout.ts`, tinted contact sheets.
  → Verify: `npm run test:art`; two builds byte-identical; contact sheets by eye (O6).
- [x] **O4. Sprite renderer.** `outlineAssetId` / `outlineImage`, the vale mapping (an outline never switches a set
  on; a missing one leaves the set rimless), the `Outline` label, rims on enemy sprites only.
  → Verify: pack, validate, vale and outline specs.
- [x] **O5. Upload.** See Status. → Verify: in Studio the skeleton stands where it did, with a rim.
- [ ] **O6. Studio check and tuning.** `docs/CLIENT.md` "Enemy outlines" smoke steps: every biome and band, solo and
  co-op, PC and phone emulator, `KV_EnemyOutline` on and off; tune `widthPx` and the hex; decide E3.
- [x] **O7. Docs.** `docs/CLIENT.md`, `docs/ART.md`, `src/shared/theme/README.md`, `CLAUDE.md` (document table and
  decision log). The optional Options toggle is not done.

## Risks

- **The Highlight adornee.** Confirm in Studio that it follows parts moved by `BulkMoveTo` (`FireCFrameChanged`) and
  that reparenting on death does not flicker. Fallback: one Highlight per live enemy, up to 31, nearest first.
- **Width mismatch.** The Highlight's line is a fixed screen width; the sprite rim scales with the billboard.
- **Texture memory.** Two more 980x962 sheets per sprite enemy; budget it before the Slime and Demonlord sets.
- **Busy screens.** Many red rims at the abyss band: drop `outlineTransparency` to ~0.3 or `widthPx` to 1 if needed.
- **Future sprite enemies** must add `"outline"` in `atlases.json`; `vale.spec` fails for an `enemy.*` sheet without
  `outlineFile`.
