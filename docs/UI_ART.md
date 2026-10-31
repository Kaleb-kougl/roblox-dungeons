# UI art: plan

The UI drops its flat code-drawn look (solid `uiPanel` frames, 1 px `UIStroke`s, square pips) for the **ToffeeCraft
"UI User Interface Pack - Horror"** sheet (`art/vendor/toffeecraft-horror-ui/UiHorror.png`): stone-black frames with
blood-red trim, skull ornaments, red / dark buttons, pills, hearts, potions, framed icon buttons, corner brackets.
Work it task by task, like `PLAN.md` and `docs/CURSOR.md`; each task ends with a **Verify**.

It is **presentation only**: nothing touches `src/shared/sim/**`, `src/shared/dungeon/**`, the lockstep wire, the
server, a fixture or a replay hash. Every string stays a theme string in the HUD font; the art is frames, icons and
bars behind and beside the text.

## Status (2026-10-30)

**Code-complete headlessly on branch `ui-art`** (UA0-UA13, UA14 docs); not merged to `main`. Nothing is uploaded
and nothing has been seen in Studio: with no art every screen renders today's flat look (two deliberate size changes
below), and every art path is checked by typecheck, lint, build and the pure-logic specs only. Decisions UAD1-UAD10
were taken as recommended (Kaleb, 2026-10-30: "proceed"). Built on the merged Draft reveal (`slice`, `SlicedImage`,
the sheet crops, the notices entry). Changes from the plan found while building are in "As built".

Merged to `main` (`3393c8a`). The 13 PNGs (12 sliced `ui-*.png` + `ui-icons.png`) were uploaded 2026-10-30 8:41 PM
and their ids are in `packs/vale/assetIds.ts`, so the bundled vale pack now draws the skin (`valeUi.spec.ts` pins it).
**Owner steps left:** spike UA1 (`KV_UiArtSpike`, docs/SPIKES.md) and the Studio smoke test below (UA12, UA15).

## The source

| Fact | Consequence |
|---|---|
| ToffeeCraft, "UI User Interface Pack - Horror", **paid licence held** (2026-10-30): commercial use, may edit, no attribution, **may not redistribute or resell** (`docs/ART.md` packs table, docs/DRAFT_REVEAL.md "Look") | Same rule as every pack: the sheet stays in gitignored `art/vendor/`, only cropped, uploaded images ship. The notices entry comes with the reveal's DR3 |
| One sheet, **1024 x 607** RGBA, every piece at **1 art pixel = 1 image pixel**; most pieces sit on a 16 / 32 px pitch | Cut by pixel rect, the reveal's crop syntax. Rects are measured with a tool (UA2), never typed by eye |
| Panel interiors carry a noise texture (mean about `#1f1f1f`); trim reds `#3d1313` / `#441515`; hearts `#c60b21` | A stretched 9-slice centre smears the noise into blocks once the panel is large (a menu panel is ~5x the art): UAD4 |
| Many pieces have text baked in (`PLAY`, `SETTINGS`, `EXIT`, the A-Z font, word strips) | Not used: strings are localised theme strings (UAD5). Only blank variants are cut |

### Pieces the reveal already takes

| Piece (x, y, w, h) | Reveal id |
|---|---|
| Skull-and-chain landscape panel (897, 241, 93, 47) | `ui.draft.back` (+ the derived `ui.draft.back.eyes` mask) |
| Plain rounded landscape panel (834, 290, 91, 46) | `ui.draft.card.common` |
| Studded panel with red trim and tab (931, 369, 88, 61) | `ui.draft.card.rare` |
| Red-eyed black corner skulls, cut from the menu frame (290, 194, 91, 119) | `ui.draft.skull.left` / `.right` |

The menus and HUD **do not reuse the card back or the legendary skulls**, so the draft keeps its own look (UAD8).
The plain panels can share a crop with a card face where the art is the same piece; each use keeps its own id.

### What else is on the sheet, and where it goes

Rects are approximate alpha bounding boxes in sheet pixels; UA2 re-measures and records them.

| Piece | Sheet (approx.) | Use |
|---|---|---|
| Blank long buttons, 90 x 27: red fill / red rim (162, 100), black fill / red rim (162, 130); the same pair without the outer red (259, 101) / (259, 132) | top centre-left | `MenuButton` 9-slice: normal = black, focused / active = red fill |
| Blank short bars, ~55 x 14: red (6, 168), grey (70, 168) | under the small PLAY / SETTINGS / EXIT buttons | Options option buttons (`optionSize` 92 x 30): red = the chosen value, grey = the others |
| Plain frames: 44 x 76 (770, 194), 64 x 76 with a red tab (824, 194), rounded 91 x 46 (899, 194), tabbed 87 x 78 (932, 289) | right half | `Panel` skins: `menu` = tabbed 87 x 78, `hud` = rounded 91 x 46, tall frames for the lobby lists |
| Menu frames 92 x 117 with bone skulls and chains on top (1, 197), (97, 197), (193, 196) | left | Only their **top edge** (bone skulls + chain) is cut, as the main-menu and pause-panel ornament (fixed size, never stretched) |
| Two-slot panel 96 x 60 (208, 515); slot squares 32 x 32 (320, 512) x4 | bottom | Weapon panel (two weapons) |
| Inventory panels, 4 x 3 slot grid, 88 x 80 (4 colourways) | top right | Not in this plan (a future "your build" grid) |
| Pills 48 x 16, 32 x 16 and 16 x 16 dots, 6 colourways including **white** (614, 136) | top centre | Bars: boss bar, combo meter track, loading / stage progress. The white pill is tinted by a role (fills keep their roles: `boss`, combo tiers, `uiAccent`) |
| Rounded chips 14 x 14 / 10 x 14 / 10 x 10, red / black / grey / brown | top centre | Pips: armor (grey), Aegis (white copy tinted `BOOST_VIEW.aegisPipRole`), combo shards |
| Framed icon buttons 14 x 14 on a 16 px grid (play, pause, +, check, x, -, ?, $), 4 colourways x states | left, rows 315-505 | Pause button, Options toggles (check / x), close / back (x), help (?) |
| Bare glyphs on a 16 px grid: check, x, ?, $, gear, home, speaker, mute, pause, play, arrow, minus; red / pink / grey / white / black | centre, rows 315-505 | Icons beside button labels: Options (gear), Leave run / main menu (home), audio rows (speaker / mute) |
| Corner brackets (L pieces), many colourways | centre right, rows 315-505 | The focus ring: four brackets on the focused button (hover and gamepad alike) |
| Arrows and carets 12 x 8 / 8 x 12 | top right | Option steppers, scroll hints |
| Hearts 18 x 15, in three columns: full (823, 361), half (855, 361), empty / pale (887, 361); rows are variants | right | `StatusPanel` hearts: full / half / empty map 1:1 onto `heartFills` (fill 2 / 1 / 0) |
| Potions, 3 shapes x black / blue / red, ~18 x 23 (935, 485) | bottom right | Flask charges: red = full, black = spent |
| Skulls 28 x 29 x4 (red eyes, hollow, bleeding, dim) (130, 162) | left | Curses in `RunItems` (bleeding), run-over header (red eyes), dead teammate (dim) |
| Lit candles (884, 435), candelabras (710, 502) | bottom | Ember pips (a lit candle), loading-screen ornaments |
| White ghost (500, 515), black wraith (549, 515), RIP stones (595, 518) | bottom | Spectate bar, run-over panel |
| Gold coin (inside the portrait-frame example) | top left | Score panel icon |
| Round frames 39 x 39 (709, 405) x4 | right | Touch controls (Phase 3) |
| Colour stripes 48 x 3 x7 (710, 359) | right | Dividers in Options and the pause overlay |
| Portrait status frames, font sheet, word strips, teddy bears, doll, eye, jars, bones, arrows, dagger | misc | Not used (UAD5; the props are world-decor candidates, docs/DECOR.md) |

## What the code gives us (checked against `main` @ `3900250`, plus the reveal plan)

| Fact | Where | Consequence |
|---|---|---|
| Almost every surface goes through four primitives: `Panel` (34 uses), `MenuButton` (48), `Pip`, `Text`; plus `ListRow` / `ScrollList` | `client/ui/hud/primitives.tsx`, `client/ui/menu/widgets.tsx` | Skinning the primitives restyles most of the UI at once. Nine raw `role("uiPanel")` frames are done by hand: `BossBar`, `ComboMeter`, `DraftOverlay` (the reveal's), `FullMapOverlay`, `PauseButton`, `StatusPanel` (hearts), `WeaponPanel`, `widgets.tsx`, `TouchControlsController` |
| The reveal adds `SlicedImage` to `primitives.tsx`: theme image + `slice` -> ImageLabel `ScaleType.Slice`, `SliceCenter`, `SliceScale` **2** (1 art px = 2 reference px), Pixelated | docs/DRAFT_REVEAL.md DR5 | The frame primitive this plan uses. UA6 only adds snapping to it (UAD1) |
| The reveal adds `ImageAsset.slice` (ui images, validator: inside the image), crops in `art/atlases.json` `images` with `slice`, `VALE_IMAGE_LAYOUTS.slice`, each crop its own uploaded PNG | DR3 | New skin pieces are more `images` entries; no new contract field for frames |
| No ImageLabel in `client/ui` today; ImageRect flipbooks exist in the world renderers (`SpriteView`, `FxSpriteController`) | grep | The icon atlas (UAD10) uses the known ImageRect pattern |
| `ui.*` is a `STILL` slot. Required: `ui.cursor`, `ui.panel`, `ui.icon.health` / `.mana` / `.ember`, `ui.font.digits`; optional port ids exist (`ui.ring.player`, `ui.marker.*`, the reveal's `ui.draft.*`) | `shared/theme/contract.ts` | New skin ids are **optional** port ids: the placeholder pack draws exactly today's flat UI |
| HUD sizes are reference px on a 1280 x 720 design; one `UIScale` = min(w/1280, h/720), 0.6-1.75, x1.25 on ten-foot, times the HUD scale setting (70-125 %) | `shared/view/hud/layout.ts` `HUD_VIEW`, `useHudScale` | A fixed `SliceScale` 2 lands on whole screen px at 720 / 1080 / 1440 p at 100 % only; other windows and HUD scales give uneven pixels unless snapped (UAD1) |
| `HUD_FONTS.text` = `Arcade` (a pixel font), every label through `str()` | `layout.ts`, `client/ui/theme` | Keep: it already matches the art |
| Corner panels are `CanvasGroup`s faded by `HudOcclusionController`; `panelTransparency` 0.25; footprint boxes pinned by `footprint.spec.ts` | `primitives.tsx`, docs/HUD_LAYOUT.md | Skinned corner panels keep the fade and their footprint; any size change reruns the spec |
| Colours: `uiPanel` `#1c1c24`, `uiAccent` `#c9a45c` (gold), `uiHealth` `#d94848`, `uiText` `#e8e6e3`; the reveal adds `boon.common` bone / `.rare` blood red / `.legendary` candle gold | placeholder manifest, DR3 | The art's black is close to `uiPanel`; gold stays the focus / chosen colour (UAD3) |
| Preload's core tier loads every `ui.*` content id before the main menu | `shared/view/preloadConfig.ts` | New images join the core tier through `contentIds`, nothing else to do |
| `contract.luau` sits at Luau's 200-locals limit | CLAUDE.md | New contract lists go inside a function, never as top-level constants |

### Merge hotspots with the reveal branch

`primitives.tsx` (its `SlicedImage`, our skins), `shared/theme/contract.ts` / `types.ts` / `validate.ts`,
`art/atlases.json`, `scripts/art/build-atlases.js`, `packs/vale/manifest.ts` / `assetIds.ts` / `layout.ts`,
`THIRD_PARTY_NOTICES.md`, `docs/ART.md`. Starting from `main` after the merge avoids all of them. `DraftOverlay.tsx`
is the reveal's alone: this plan never edits it.

## Player experience

- **Main menu, lobby, Options, pause, run over, tutorial outro:** black stone panels with a red rim and tab; the main
  menu and pause panel carry the bone skulls and chain on top. Buttons are dark slabs that fill red when hovered or
  selected; the chosen setting is a red bar, the others grey. Focus (mouse hover or gamepad selection) puts four
  corner brackets around the button.
- **In a run:** the corner panels become dark rounded frames (no red, so red keeps meaning danger on screen) at the
  same transparency and footprint, still fading under the action. Hearts are pixel hearts (full / half / empty),
  flask charges are red potions turning black when spent, Ember pips are candles, armor and Aegis are chips. The boss
  bar and combo meter are pills; the pause button is the framed pause icon.
- **Draft:** the reveal's cards, unchanged by this plan.
- **Loading screen and stage card:** the pill progress bar with candelabras at the sides.
- **Touch:** ringed round frames for the sticks and buttons, glyphs on them.
- Crisp at any window size and HUD scale: every art pixel is a whole number of screen pixels (UAD1).
- The placeholder pack, and vale before the images are uploaded, look exactly like today.

## Architecture

### 1. Art (`art/atlases.json`, `scripts/art/build-atlases.js`)

- **Sliced pieces** (panels, buttons, option bars, bars, slots, the touch rings): more `images` entries in the
  reveal's crop syntax, each with its `slice`; each its own PNG, like the reveal's cards.
- **One new builder option** on those entries: `centre: "flat"` fills the slice centre with its rounded mean colour, so
  a large panel shows no smeared noise (UAD4).
- **Small fixed-size pieces** (hearts, potions, chips, candles, skulls, glyphs, framed icons, corner bracket, carets,
  coin, ghost, RIP, ornament): packed into **one `ui-icons.png`** (MaxRects, the world atlas packer, <= 1024 x 1024,
  1 px extruded gutter), with `packs/vale/uiIconLayout.ts` (`VALE_UI_ICONS`: rect, pivot per id) and a contact sheet.
  One upload instead of ~40 (UAD10). White copies use the existing `rgb: "white"`.
- `scripts/art/ui-measure.js <x> <y>`: flood-fills the piece under a sheet point and prints its alpha rect, so every
  rect comes from a measurement.

### 2. Theme

- Port-only optional ids, listed inside a function in `contract.ts` (`uiSkinIds()`):
  - sliced: `ui.panel.menu` / `.hud` / `.tall`, `ui.button` / `.focus` / `.disabled`, `ui.option.on` / `.off`,
    `ui.bar.track` / `.fill`, `ui.slot.pair`, `ui.stick.ring`, `ui.touch.button`;
  - icons (`rect` into the icon atlas): `ui.ornament.bones`, `ui.focus.corner`, `ui.chip` / `.chip.white`,
    `ui.heart.full` / `.half` / `.empty`, `ui.flask.full` / `.empty`, `ui.candle`, `ui.caret`, `ui.divider`,
    `ui.icon.<glyph>` (pause, check, cross, gear, home, speaker, mute, help, coin, skull, skull.curse, ghost, rip).
- `rect` (today decor / breakable only) is allowed on `ui.*` icons; validator: inside the image.
- The required ids get art too: `ui.panel` = the `hud` panel crop, `ui.icon.health` = the full heart, `ui.icon.mana` =
  the red potion, `ui.icon.ember` = the candle.
- vale manifest: each id becomes an `image` once its file has an id in `assetIds.ts` (the icon atlas: all icons at
  once), else absent (optional) / placeholder (required). `contentIds` picks them up for preload.

### 3. Pure view logic: `shared/view/hud/skin.ts` + `skinConfig.ts` (headless-tested)

- `UI_ART` tunables: `refPerArt` 2 (the reveal's `SliceScale`), which skin each primitive uses in menus and in a run
  (UAD2), icon boxes.
- `artPixelScale(uiScale, refPerArt)` -> whole screen px per art px: `max(1, round(uiScale * refPerArt))`.
- `snappedSliceScale(uiScale, refPerArt)` -> `artPixelScale / uiScale`, the `SliceScale` whose borders land on whole
  screen px (equal to 2 at 720 / 1080 / 1440 p at 100 %).
- `fitArt(artW, artH, boxRef, uiScale)` -> the reference-px size of an icon at the largest whole screen-px scale that
  fits its box, so layouts and footprints keep their box sizes (UAD7).
- `skinFor(pack, part, state)` -> the visual id for `panel` / `button` / `option` / `pip` / `heart` / `flask` / `bar`
  in a state (`normal` / `focused` / `active` / `disabled`, `full` / `half` / `empty`), along a fallback chain, finally
  `undefined` = the flat look.

### 4. Client

- `SlicedImage` (the reveal's): gains an optional `snap` that takes `snappedSliceScale(useHudScale())` instead of the
  fixed 2. Off by default, so the reveal's cards are unchanged until UAD1 says otherwise.
- `ArtImage` (new, `primitives.tsx`): one icon from the icon atlas (`ImageRectOffset` / `ImageRectSize`, Pixelated),
  sized by `fitArt`, tinted by an optional role.
- `FocusCorners` (new): four `ui.focus.corner` images (rotated 0 / 90 / 180 / 270) on a focused button, replacing the
  `uiAccent` `UIStroke` when the skin exists.
- `Panel`, `MenuButton`, `ListRow`, `Pip`, the heart, `ProgressBar` (loading), `PauseButton` ask `skinFor`;
  `undefined` renders exactly today's tree. Text, layout, padding, list layouts, selection and events are unchanged.

### 5. What does not change

Every sim, dungeon, lockstep and server file; fixtures and hashes; strings and the HUD font; layout reference sizes
(except the heart box, UAD7); the occlusion fade; input and gamepad navigation; the cursor (docs/CURSOR.md); the draft
overlay and its cards (the reveal's); the minimap's map image (only its frame).

## Tasks

### Phase 0: groundwork

- [x] **UA0. Start point.** The reveal branch is merged to `main` with DR3 and DR5 (`slice`, `SlicedImage`, the
  `UiHorror.png` crops, the notices entry). Cut `ui-art` from `main`. → Verify: `npm run verify` green on the new
  branch; `SlicedImage` and `ImageAsset.slice` exist.
- [ ] **UA1. Studio spike** (code built; the Studio run is the owner's) (`KV_UiArtSpike`, off by default, Janitor cleanup; results in `docs/SPIKES.md`), after the
  reveal's DR9 Studio check: a sliced test panel with a fractional `SliceScale` inside a `CanvasGroup` with
  `GroupTransparency`, and an icon cut with `ImageRectOffset`, at 720 / 1080 / 1440 p, UIScale 0.6-1.75 and HUD scale
  70 / 125 %. Answer: (a) `snappedSliceScale` puts borders on whole screen px, (b) no gutter bleed from the icon atlas
  at 1 px, (c) a CanvasGroup keeps pixels crisp, (d) whether a large stretched noise centre needs `flat`. → Verify:
  the four answers in SPIKES.md.
- [x] **UA2. Measuring tool and cuts** *(no reveal code)*. `scripts/art/ui-measure.js`; the list of every piece in
  Architecture 2 with measured rects and chosen slices (kept in this doc until UA3 writes them into `atlases.json`).
  → Verify: `node scripts/art/ui-measure.js 170 110` prints the long red button's rect; Kaleb looks at a contact
  sheet of the cuts.
- [x] **UA3. Pipeline.** The sliced `images` entries; `centre: "flat"`; the icon atlas (packing, extruded gutters,
  `uiIconLayout.ts`, contact sheet); tests in `scripts/art/build-atlases.test.js` (rect inside the sheet, centre >= 1
  px, flat centre colour, gutter pixels equal their edge). → Verify: `npm run test:art`; `art:build` writes the PNGs
  and `ui-icons.png` <= 1024 x 1024.
- [x] **UA4. Theme.** `uiSkinIds()`, `rect` on ui.* icons, validator rules, vale manifest from the layouts once
  uploaded; specs (vale with and without each id; the icon atlas all-or-nothing; placeholder has none of the optional
  ids; `contentIds` holds them). Upload the PNGs and paste the ids. → Verify: `npm test` (theme, vale, preload specs);
  `check:assets`; Lune compiles `contract.luau`.
- [x] **UA5. Pure skin logic** *(no reveal code)*. `skin.ts`, `skinConfig.ts`, barrel; specs: `artPixelScale` and
  `snappedSliceScale` give whole screen px at UIScale 0.6, 0.7, 1, 1.25, 1.5, 1.75, 2.1875 (ten-foot max) and equal 2
  at 1 / 1.5 / 2; `fitArt` never exceeds its box; every `skinFor` fallback branch; placeholder -> `undefined`. →
  Verify: `npm run test:only -- view/hud/skin`.
- [x] **UA6. Client primitives.** `SlicedImage` `snap`, `ArtImage`, `FocusCorners`. → Verify: `npm run verify`;
  Studio with `KV_UiArtSpike`: one of each on screen.

### Phase 1: menus and overlays

- [x] **UA7. Panels and buttons.** `Panel` (menu kind outside a run, hud kind in a run), `MenuButton` (normal /
  focused / active / disabled), option bars, `ListRow`, `ScrollList` bar tint, the bone ornament on the main menu and
  pause panels, dividers in Options. → Verify: Studio: main menu, lobby browser and room, Options (every tab), pause,
  run over, tutorial outro, toasts; gamepad navigation reaches every button and shows the brackets.
- [x] **UA8. Icons.** Pause button icon, Options check / cross toggles and speaker / mute rows, gear / home / help
  beside their labels, run-over skull / RIP, spectate ghost, dead teammate skull, curse skull in `RunItems`. → Verify:
  Studio; every button still has its text label.
- [x] **UA9. Loading and stage covers.** Pill `ProgressBar` (track + white fill tinted `uiAccent`), candelabras on the
  cover. → Verify: `KV_SkipLoading` off, cold join: the bar fills crisply; the stage card on a floor change.

### Phase 2: in-run HUD

- [x] **UA10. Status panel.** Hearts from art (box 22 -> 24, UAD7), the tutorial's ghost heart, potions for flask
  charges, candles for Ember, chips for armor and Aegis, the tutorial's highlight ring around the new rows. → Verify:
  `footprint.spec.ts` updated and green; Studio: take damage to a half heart, drink, spend Ember.
- [x] **UA11. Bars, slots, frames.** Boss bar (pill track, white fill tinted `boss`, notches on top), combo meter
  track and shards (tier colours unchanged), weapon panel's two slots, score coin icon, minimap and full-map frames. →
  Verify: Studio: a boss fight, a combo to x5 and a break, a weapon swap; `comboReport` unchanged.
- [ ] **UA12. Readability over the floor.** (code side done; the Studio walk is the owner's) Corner panels at `panelTransparency`, the occlusion fade over the new art,
  every biome floor; a bullet behind a panel edge still reads. → Verify: Studio, walk past every corner in biomes 1-5.

### Phase 3: touch

- [x] **UA13. Touch controls.** Ring frames for the sticks, round buttons with glyphs; `touchOpacity` / `touchSize`
  apply. → Verify: Studio device emulator (phone landscape); later a real device (docs/MOBILE.md).

### Wrap-up

- [x] **UA14. Docs.** "As built" here; `docs/ART.md` mapping and status rows (the pack row: "draft cards and the
  UI"); `shared/theme/README.md` (the skin ids, `rect` on ui icons, `centre`); CLAUDE.md decision-log line.
- [ ] **UA15. Studio smoke test** (below).

## As built (2026-10-30, branch `ui-art`)

| Piece | Where |
|---|---|
| `scripts/art/ui-measure.js <x> <y>` (8-connected flood fill, prints the alpha rect) + spec | scripts/art |
| 12 sliced `images` entries (rects measured, slices chosen on the contact sheets, `flatBoxes` where a stretched line crosses texture); new `images` options `rgb: "white" \| "grey"` and `clearRgb`; a 4x contact sheet per sliced piece with the slice lines and a 9-sliced preview | art/atlases.json, scripts/art/build-atlases.js |
| `uiIcons` section: 27 icons packed (MaxRects, the world packer's best fit moved into `maxRectsFit`, byte-identical output) into **`ui-icons.png` 115 x 154** with a 1 px extruded gutter; generated `packs/vale/uiIconLayout.ts` (`VALE_UI_ICON_FILE`, `VALE_UI_ICON_ATLAS`, `VALE_UI_ICONS`) | art/atlases.json, scripts/art, packs/vale |
| `uiSkinIds()` / `uiIconIds()` (optional port ids, inside functions: `contract.luau` is at 198 / 200 locals); `rect` on `ui.*` images (inside the image, pivot from the rect, refused together with `slice`); `ImageRef.rect` | shared/theme contract / types / core / validate |
| vale: sliced ids join the optional-image loop; `valeUiIconImages` (all icons once `ui-icons.png` has an id, else none); `VALE_UI_REQUIRED_ART` (`ui.panel` <- `ui.panel.hud`, `ui.icon.health` <- `ui.heart.full`, `.mana` <- `ui.flask.full`, `.ember` <- `ui.candle`); preload core tier lists the atlas once | packs/vale/manifest.ts |
| `UI_ART` (`refPerArt` 2, `hudRefPerArt` 1, `contentInsets`, icon boxes, focus corners), `artPixelScale`, `snappedSliceScale`, `fitArt` / `fitTurnedArt`, `skinFor` / `skinHasOf`, `skinPadding` / `contentInsetsOf`, button state / text role helpers | shared/view/hud/skin.ts, skinConfig.ts |
| `HUD_SKIN` (pip art, dims, pill fit and fill clip, minimap frame, touch art), `UI_SCREEN_SKINS` (which skin every screen's panel takes) | shared/view/hud/hudSkin.ts, shared/view/menu/skin.ts |
| `SlicedImage` `snap` / `refPerArt` / `children`; `ArtImage`; `FocusCorners`; `Panel` `skin` (`menu` \| `hud` \| `list` \| `none`; corner panels default `hud`, others `menu`, a fully transparent Panel always flat) and `flatOnly` children; `MenuButton` `variant="option"` and `icon`; skinned `ListRow`; `Pip` `art` | client/ui/hud/primitives.tsx, client/ui/menu/widgets.tsx |
| Screens: main menu and pause (bones ornament, dividers, gear / home icons), lobby browser / room, Options (option bars, dividers, speaker / mute), run over (skull / RIP header), spectate bar (ghost), RunItems (curse skull), toasts, tutorial panels, the pause button icon, the pill `ProgressBar` (loading + stage covers) | client/ui/hud, menu, loading |
| HUD: hearts / flasks / candles / chips in StatusPanel, pill boss bar with a clipped fill, `ui.slot` weapon slots, the score coin, the full map's frame; touch rings and buttons | client/ui/hud, client/controllers/game/TouchControlsController.ts |
| Spike `KV_UiArtSpike` (`SPIKE_DEFAULTS.uiArt` off) | client/controllers/spikes, client/ui/spikes, docs/SPIKES.md "Spike UA1" |

Changes from the plan, found while building:

- **Content insets.** Padding follows each frame's measured visible border (`UI_ART.contentInsets`: menu 5 / 11 / 5 / 7,
  tall 5 / 10 / 5 / 7, hud 2 / 3 / 2 / 3 art px), not its slice insets: the menu panel's tab forces 43 px side insets,
  which would have padded every menu panel by 86 px a side.
- **Two densities.** Menus draw frames at 2 reference px per art px (the reveal's), in-run frames and list rows at 1
  (`hudRefPerArt`), so corner panels keep their size; both snapped to whole screen px.
- **Deliberate flat-look changes:** `HUD_VIEW.heartSize` 22 -> 24 (UAD7) and `bossBarHeight` 12 -> 16 (a 16 art px
  pill cannot fit 12 at a whole scale at 720 p; footprint specs updated, the touch tutorial prompt moves down 4 px).
- **ui.button.disabled** is the normal button greyed (`rgb: "grey"`): the sheet has no blank button without the red.
- **ui.panel.hud keeps a dark-red rim** (#370f0f): every plain rounded panel on the sheet has one (UAD2 only roughly met).
- **ui.stick.ring / ui.touch.button** are icons (fixed size, whole multiples of 39 px), not sliced pieces.
- **Combo meter unchanged:** the 16 px pill does not fit the 10 px meter, and a taller meter breaks the score panel's
  160 px budget (spec pins it).
- **Corner minimap stays flat** (`HUD_SKIN.minimapFramed` false): its map image is turned 45 degrees and only the
  corner CanvasGroup clips it, at the panel's outer edge, so it would paint over the frame. Framing it needs an inner
  clip first. The full map's frame is drawn (outside the map, under it).
- **Skipped:** candelabras on the covers (not in the icon atlas), check / cross on the On / Off rows (the red bar
  already marks the choice), the dead-teammate skull (no list with a dead state outside the HUD), glyphs on touch
  buttons (their labels fill the circle).
- **The reveal's cards are not snapped yet** (UAD1 says they should be): `SlicedImage` `snap` is opt-in, so
  `DraftOverlay` is unchanged apart from `skin="none"` on its two Panels.
- **Below UIScale ~0.75** art never drops under 1 screen px per art px, so hud frames pad a few px more than 8 and
  icons (ghost, run-over header) can overflow their boxes slightly.

## Phones (2026-10-30, after the first phone look)

Kaleb's phone screenshots (about 693-714 x 320-330 pt landscape, smaller than MOBILE.md's 844 x 390 reference) showed
the menus overflowing the safe area, the bones ornament under Roblox's top bar, and the touch cluster rising into the
score panel. All three predate the skin in part; fixed on `ua-mob-menus` / `ua-mob-touch`, merged to `main`.

- **Menus fit the safe area on touch** (`shared/view/menu/fit.ts`, client `MenuFit`): a safe area under 650 reference
  px tall switches screens to compact layouts (main menu buttons in two columns; run over in two columns; Options' tab
  body scrolls), then one flexible list per screen shrinks (>= 96 px), then the whole panel scales (never under 0.6
  effective, so a button stays >= 24 pt). Mouse, keyboard and gamepad: factor 1, nothing changes. The ornament shows
  only when the fitted panel leaves room above it (the panel may move down up to half its overhang), else it is skipped.
- **Full-screen dims:** MenuLayer's backdrop and the pause / Options / leaderboard / tutorial-outro dims draw in their
  own full-screen ScreenGuis (`KV_MenuBackdrop`, `KV_GameMenuDim`), so they reach under the top bar and the notch. The
  one desktop-visible change: the top-bar strip is dimmed too.
- **Touch cluster clear of the corner panels** (`touchLayout`): a 2D keep-out from the status and score footprints
  (measured in the HUD ScreenGui's rect); the largest scale up to the setting that keeps clear, then a compact cluster
  (`TOUCH_LAYOUT.compact`: Ember under Attack, the rest left of it), then down to the smallest tappable circle; specced
  on 844 x 390, 667 x 375 and 714 x 330 at every HUD scale and inset. Layouts that already fit are unchanged.
- **Touch faces:** labels fit inside each control (`touchFace`, TextScaled with a size cap, a soft stroke); with the art,
  Flask and Ember show `ui.flask.full` / `ui.candle` with a count badge; stick words show at rest, the knob only while
  held (`HUD_SKIN.touch.knobAtRest`); ring art is the largest whole multiple of 39 px inside the circle, at
  transparency 0.55.
- **Touch HUD as one slim top strip** (owner, 2026-10-30; `shared/view/hud/touchStrip.ts`, ScreenGui `KV_TouchStrip`):
  on touch the corner status and score panels are replaced by one row in Roblox's top-bar row, right of the pause
  button: hearts (+ armor / Aegis, ghost heart), flask icon + count, Ember candle + count, coin + score + multiplier
  over a 3 px combo line; no boxes, no row labels, no "Score" title. Under it one 15 px chips line (boosts, then owned
  items capped with `hud.items.more`), then a slim boss bar (flat, no panel). Collapses when narrow (multiplier text,
  then one heart + count, then 80 %, then below the bar). The Floor / Depth line moved to the pause overlay on touch.
  One occlusion-faded CanvasGroup; `touchLayout` keeps clear of the strip, so the small phone gets the normal cluster
  back (x0.53 compact -> x0.75 normal on 693 x 320). About 17 % of a 693 x 320 screen with a boss, ~5 % below the top
  bar without one. Needs the emulator: the strip against Roblox's pill / voice button (`TopbarInset`), chip text
  (~7.5 pt), the stamp / tutorial prompt over the cluster's Flask / Alt.
- **Controls in the corners, nothing behind Roblox's buttons** (owner, 2026-10-31): `TopbarInset.Min.X` ends ~49 pt
  before Roblox's pill on a phone with the voice button, so on touch the pause button sits after `robloxButtonsEnd`
  (Min.X + one Roblox button 44 + gap 8, always on touch; `shared/view/menu/pause.ts` `pauseButtonSlot`) + 8 pt, and
  the strip after it (desktop unchanged). The touch cluster is a tight arc around Attack in the bottom-right corner
  (Attack 10 ref px from both safe edges; Roll, Alt, Flask, Ember on the inner arc, Swap and Accept outside; 4 ref px
  between hit circles), the move stick's idle home near the bottom-left corner; specced to stay in a 45 % x 75 %
  corner box, out of the screen's middle third, both hands, every HUD scale.
- **Needs a device or the emulator:** the compact cluster's thumb reach, the knob-at-rest choice, "Accept" at ~8 pt with
  the art, first-frame unfitted menus, the real panel heights against the estimates.

## Studio smoke test

1. Cold join: loading screen bar, then the main menu with the bone ornament; mouse hover and gamepad selection both
   show the brackets.
2. Options: every tab; the chosen value is the red bar; HUD scale 70 % and 125 %: borders stay crisp, nothing clips.
3. Resize the window 720 p -> 1080 p -> 1440 p and full screen: pixels stay square at every size.
4. Solo run: hearts, flask, Ember, armor, boss bar, combo meter, weapon slots, score, minimap frame; panels fade when
   the knight walks under them.
5. A draft: the reveal's cards look and behave as on its branch.
6. Pause, Options from the pause, Leave run; the run-over panel after a death.
7. Co-op: party overlay, spectate bar, the dead teammate's skull.
8. Tutorial: the highlight rings still sit around hearts, flask and boosts.
9. Switch the active pack to `placeholder`: today's flat UI, unchanged.

## Edge cases

- **Fractional scales.** Snapped borders are whole pixels; a panel's total size stays fractional, absorbed by the
  flat centre, so nothing visible is uneven.
- **Very small windows** (UIScale 0.6): `artPixelScale` floors at 1; icons may then sit smaller than their box
  (centred).
- **Two pixel sizes.** Frames draw at `refPerArt` 2 (3 screen px per art px at 1080 p) and HUD icons fit their boxes
  (2 screen px at 1080 p for the hearts): a slightly finer grain on small icons (UAD7).
- **CanvasGroup texture memory** (corner panels): no new groups.
- **Upload moderation or a missing id:** sliced ids fall back one by one to the flat look; the icon atlas is all or
  nothing.
- **Red on screen.** In a run the frames are the dark colourway (UAD2), so red stays hearts, damage and the boss.

## Decisions (open, recommended default first)

- **UAD1. Pixel snapping:** snap `SliceScale` to whole screen px through `snappedSliceScale`, for this plan's frames and
  (once the reveal is merged) its cards too, identical to its fixed 2 at 720 / 1080 / 1440 p at 100 % (recommended) /
  keep the fixed 2 everywhere (uneven pixels at other windows and HUD scales) / snap only this plan's frames.
- **UAD2. Colourways:** red-rimmed black in menus, dark rounded frames in a run (recommended: red keeps meaning danger
  over the bullets) / red rims everywhere / dark everywhere.
- **UAD3. Accent colour:** keep `uiAccent` gold for chosen / focused text and the brackets (recommended; it is also
  the legendary card's colour family) / the art's red (next to `uiHealth`, `boon.rare` and the enemy bullets).
- **UAD4. Panel centres:** `flat` mean colour (recommended) / stretch the noise / tile it (a second image per panel).
- **UAD5. Baked text and the bitmap font:** not used; Arcade + theme strings (recommended: localisation, one font;
  the reveal also leaves the font for later) / a bitmap title font later.
- **UAD6. In-run panels:** keep `panelTransparency` 0.25 (recommended) / opaque art.
- **UAD7. HUD icon size:** icons fit their boxes at a whole screen-px scale, heart box 22 -> 24 so hearts draw at 2x
  at 1080 p (recommended) / icons at the frames' density (hearts 36 reference px, the status panel grows ~50 %) /
  keep 22 (hearts drop to 1x at 1080 p).
- **UAD8. Menu ornaments:** the menu frames' bone skulls and chain on the main menu and pause panels; the card back
  and the red-eyed skulls stay the draft's (recommended) / reuse the card back's skull-and-chain panel for menus too /
  no ornament.
- **UAD9. Icons with text:** icons sit beside labels, never replace them (recommended) / icon-only pause and close.
- **UAD10. Uploads:** sliced pieces one PNG each (like the reveal), small pieces in one icon atlas (recommended: ~12 +
  1 uploads, and the icons switch on together) / one PNG per piece (~50 uploads) / everything in one atlas (needs
  sliced `rect` support in `SlicedImage`).

## Out of scope

The draft overlay and its cards (docs/DRAFT_REVEAL.md), co-op portrait frames, the inventory grid panels, the A-Z
bitmap font and word strips, world use of the props (docs/DECOR.md if wanted), a new cursor (docs/CURSOR.md), UI
animation beyond today's (the brackets do not pulse), new colour roles.
