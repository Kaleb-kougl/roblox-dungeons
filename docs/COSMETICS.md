# Cosmetics from recoloured sprites

Status (2026-11-17): **code-complete on branch `cosmetics`** (rebased onto `main` @ `86e3e8c5`, New enemies 3; not merged, not pushed).
Owner: "proceed" (2026-11-17), so **CSD1-CSD12 are accepted as recommended**; rule 3 was revised while building (the
floor bar is min(3 : 1, the undyed region's own contrast), "As built: theme (CS3)") and **awaits the owner's
confirmation**. Built: CS1-CS7, CS10 (each track's "As built" section below) and an independent review's fixes ("Review
fixes"), and CS8: the 15 dye sheets uploaded 2026-11-17 (ids in `packs/vale/assetIds.ts`), so the bundled vale pack
draws dyes. Open: CS1's sign-off by eye on the dye contact sheets (`art/build/contact/class.*-dye-*.png`), CS0's device
memory check, CS9 (Studio check and playtest, CS7's two clients). Not built: CS11 (earned cosmetics), CS12 (telemetry), the title slot (docs/SILVER.md;
not a recolour).

This is docs/SILVER.md's phase 2 (SV11-SV13, "Cosmetics") made concrete, built on art we already have: **no new
character art is drawn or bought.** Tasks **CS0-CS12**, decisions **CSD1-CSD12**. Numbers marked *(tune)* are
starting points for the validator and the owner's eye, not commitments.

Goal: give Silver (earned and, since docs/SILVER_SHOP.md, bought) something to buy that is **not power** and that
**other players see**: your Knight in cobalt plate, your Archer in teal leathers, your outline, your roll trail. Every
cosmetic is a recolour of a sprite the game already draws.

## The idea in one paragraph

The atlas pipeline already cuts a second, aligned sheet per body sheet (the 1 px player outline,
`<sheet>-outline.png`) and SpriteView already draws it as a second ImageLabel with the frame's own rect, tinted at
runtime by `ImageColor3`. A **dye** is the same trick for the body: `art:build` writes a third aligned sheet per body
sheet, `<sheet>-dye.png`, holding only the pixels of one region (the Knight's plate, the Archer's leathers) as
normalised greyscale, and SpriteView draws it over the frame tinted by the player's dye colour. **One set of dye sheets
per character (15 uploads, once) serves every colour we will ever sell:** a new dye is a hex in a data table, not an
upload. The body sheets do not change (no re-upload), and a player with no dye draws exactly as today. Outline, roll
trail and spark colours need no art at all: those layers are already tinted at runtime. Everything is presentation:
no sim, dungeon, lockstep, hash, replay, fixture or score change.

## Prototype (2026-11-17, the owner's Mac, `art/build/_review/cosmetic-dye-probe.png`)

A throwaway script masked the `-idle` sheets by colour, normalised the masked luminance to its 98th percentile and
multiplied by a colour (exactly what `ImageColor3` will do):

| | Knight (plate) | Archer (leathers) |
|---|---|---|
| Mask rule | alpha > 240, max RGB > 8, HLS saturation < 0.18, luminance >= 88 | alpha > 240, max RGB > 8, luminance < 70, hue < 55 or > 340 degrees |
| Share of opaque body pixels dyed | 64 % (plate, helm, shield face, greaves) | 80 % (tunic, boots, hood / hair, **the bow**) |
| Mean normalised value (dyed colour = colour x this) | 0.71 | 0.48 |
| Untouched | sword, shield rim, leather straps, baked shadow | skin, orange bracers, baked shadow |

By eye: the Knight reads as a painted-armour knight in every colour; the Archer reads as dyed leathers but the bow is
dyed with them (CS1 must exclude it, below). Multiply flattens highlights a little (the brightest plate pixel becomes
the dye colour, never white): accepted for v1 (CSD2).

**The readability gate already bites.** CIE76 of the dyed mean (colour x mean value) against the danger roles
(`enemyBullet` `#ff3fa4`, `telegraph` `#ff8a3d`, `enemyOutline` `#ff3b30`) and the Goldling (`enemy.golden`
`#f5c400`), Knight / Archer:

| Candidate | vs enemyOutline | vs telegraph | vs Goldling | At a 40 bar |
|---|---|---|---|---|
| Crimson `#dc2832` | 38 / 57 | 47 / 60 | 85 / 92 | Knight fails (reads as an enemy's red rim) |
| Scarlet `#c0182a` | 45 / 63 | 52 / 65 | 89 / 95 | passes |
| Ember `#e67828` | 45 / 61 | **30** / 50 | 58 / 73 | Knight fails (telegraph orange) |
| Gilded `#f0be28` | 68 / 72 | **37** / 50 | **34** / 58 | Knight fails twice |
| Cobalt, Verdant, Amethyst, Frost, Teal, Ivory, Bronze | 66-117 | 48-113 | 65-138 | all pass |

So red-orange-gold, the game's danger and treasure colours, are mostly unavailable for the body, which is the right
outcome (CSD6).

## What the code gives us (checked on `main` @ `80f57769`)

| Fact | Where | Consequence |
|---|---|---|
| SpriteView draws an optional second ImageLabel ("Outline") under the frame with the frame's outline sheet and the same `ImageRectOffset` / `Size`, tinted by `ImageColor3`, hidden when the sheet has none; squash, push and visibility already apply to both | `client/controllers/render/SpriteView.ts` | The dye is a third label on the same BillboardGui, written in the same branch as the frame; squash / push come free |
| Every vale body sheet has an `outlineFile` in the generated layout; the pipeline's `outline` option writes them aligned to the body sheet | `packs/vale/layout.ts`, `art/atlases.json`, `scripts/art/build-atlases.js` | A `dye` option writes `dyeFile` the same way; the body sheets stay byte-identical |
| The Knight is 8 body sheets of 1024 x 1024 (128 px cells, 8 x 8); the Archer 7 sheets of 968 x 776 (121 x 97 cells) | `art/atlases.json` `class.vanguard` / `class.ranger` | 15 dye sheets, one upload batch, then never again |
| Build-time `recolor` (gradient map by luminance) exists and made the Goldling | docs/ART.md "Recolour" | The alternative for baked prestige skins (CSD1), not v1 |
| Roll afterimages copy the drawn frame (`SpriteView.snapshot`) into pooled ghost ImageLabels | `client/controllers/render/motionFx.ts` | A trail colour is an `ImageColor3` on the ghost labels; the snapshot must carry the dye too |
| Wallet doc `eq: { [slot]: itemId }`, `applyEquip` (owned and fits the slot), remote `walletEquip`, `WalletStatus.equipped` | `shared/wallet` doc / transforms / status | Equipping is built; only catalogue rows and slots are new |
| `ArmoryItem.kind` `"cosmetic"` with `slot`; the Armory has a Cosmetics tab, empty today; `CONFIRM_FROM_TIER` 6 | `shared/wallet/catalog.ts`, `shared/view/menu/armory.ts` | Catalogue rows (append-only) fill the tab |
| `PartyRunStart` carries per-member `characters` and `upgrades` | `shared/network.ts` | Add per-member `looks` the same way (unhashed, never in `buildWorldSetup`) |
| `playerOutline` is drawn for the **watched** player only (docs/PLAYER_OUTLINE.md) | | Teammates draw without a rim, so a dyed body must stay readable on every floor by itself (gate below) |

To confirm while building (CS0's code half): how the stage manifest's `characters` group lists sheets (dye sheets
join it only when a member wears a dye), how lobby members are drawn (is there a sprite preview to dye?), where graze /
parry sparks take their player colour. The swing fan / blade colour is out of v1 (CSD11).

## Slots and catalogue v1

Equipped per slot in the wallet's `eq`, one item per slot. Prices are tiers of the existing ladder
(`ARMORY_TIERS` 40 / 80 / 150 / 300 / 600 / 1,200 / 2,500 / 5,000); cosmetics sit on tiers 2-8 (SVD23).

| Slot (`eq` key) | Recolours | Art needed | v1 items *(tune)* |
|---|---|---|---|
| `dye.knight` | The Knight's plate (dye sheets) | 8 dye sheets, once | up to 8 colours, tiers 2-6, + Prismatic (Robux only, CSD13) |
| `dye.archer` | The Archer's leathers (dye sheets) | 7 dye sheets, once | up to 8 colours, tiers 2-6, + Prismatic (Robux only, CSD13) |
| `outline` | Your rim (`playerOutline`, drawn for the watched player; the minimap self marker keeps `minimap.self`, CSD9) | none | 8 colours, tiers 2-5 |
| `trail` | Roll afterimage ghosts | none | 6 colours, tiers 3-7 |
| `spark` | Your graze / parry sparks | none | 5 colours, tiers 4-7 |

Draft dye palette (names per character, e.g. "Cobalt Plate" / "Cobalt Leathers"): Scarlet, Cobalt, Verdant,
Amethyst, Frost, Teal, Ivory, Bronze; every one gated by the validator per character before it ships, so the list
may shrink or shift. Prestige (tier 8): **Prismatic** (CS10, CSD7), an animated dye that drifts through validated
stops.

## Readability rules (validator `cosmeticReport`, a spec over the whole catalogue)

A cosmetic may never make a player read as an enemy, a bullet, a hazard or a pickup. Every dye rule is checked on the
**dyed mean** (colour x the character's measured mean value `dyeMeanValue`, written by `art:build` into the layout, so
the spec does not need the PNGs):

1. >= 40 CIE76 from every `ENEMY_BULLET_ROLES` colour, `telegraph` and `enemyOutline`.
2. >= 30 CIE76 from every `boost.*` role and `enemy.golden` *(tune)*.
3. **Contrast on the floor:** the dyed body's luminance contrast >= 3 : 1 against every biome's floor colour *(tune)*,
   because teammates have no rim. Dark dyes are meant to fail (CSD5).
4. Outline colours: exactly `playerOutlineReport`'s rules. Trail colours: rule 1. Spark colours: `nearMissReport`'s
   rules.
5. Prismatic: every stop and every interpolated step (sampled at 16 per segment) passes 1-3.

## Design

### Pipeline (`art:build`)

- A sprite set may carry `"dye": { "rule": { ... }, "normalizePercentile": 98, "exclude": [...] }`. The rule is the
  prototype's predicate in data: `alphaMin`, `minRgb`, `satMax` / `satMin`, `lumMin` / `lumMax`, `hue` ranges.
  `exclude` lists rectangles to drop by hand where colour cannot separate a part (the Archer's bow).
- Output per body sheet: `<sheet>-dye.png`, the same size and cell layout; a masked pixel becomes grey
  `round(255 x min(1, lum / p))` (p = the set's `normalizePercentile` luminance of masked pixels) with its source
  alpha; every other pixel transparent. The layout gains `dyeFile` per sheet and `dyeMeanValue` per set.
- Body and outline sheets byte-identical.
- A contact sheet per set: the body, the mask in magenta, and the body dyed in sample colours, for review by eye
  (`art/build/contact/<set>-dye.png`).

### Theme

- `SpriteSheetImage.dyeAssetId` / `SpriteFrame.dyeImage`, like the outline's; the vale manifest wires a sheet's dye
  only once its `dyeFile` has an uploaded id.
- shared/theme `cosmetics.ts` (a module of its own: keep `contract.luau` / `validate.luau` under Luau's 200
  top-level locals): the colour of every cosmetic item, the Prismatic stops, `cosmeticReport` (rules 1-5), strings
  `cosmetic.<id>.name`, slot labels, l10n context entries.
- Placeholder pack: no dye sheets, so dyes draw nothing in-run there; the Armory still shows the swatch.

### Wallet and server

- `ARMORY_CATALOG` rows appended (append-only, `catalog.spec`'s order lock updated): `kind: "cosmetic"`, `slot`,
  `simLever: false`. A dye's slot names its character (`dye.knight`), so `applyEquip`'s fit rule is unchanged.
- **Looks:** `CosmeticLook` `{ dye?, outline?, trail?, spark? }` = the item ids equipped, read from the STORED wallet
  at run start (like `upgrades`), stored on the `RunSession` and sent as `PartyRunStart.looks[]` (member order).
  Unknown wallet: the default look. A lobby carries each member's look. Solo: the client's own
  `WalletStatus.equipped`.
- Never hashed, never recorded, never in `buildWorldSetup`, never validated.

### View

- `SpriteView` gains an optional dye label ("Dye", ZIndex above the frame) and `setDye(color | undefined)`; it draws
  only when the frame's sheet has a `dyeImage`, the dye sheet's content is ready (docs/STAGE_ASSETS.md's stand-in
  rule) and a colour is set. Its `ImageColor3` is dye x the view's tint (per channel), its transparency follows
  `setTransparency`, and `snapshot` copies it.
- ActorRenderController passes each player's look (index order) to their view; outline colour overrides
  `playerOutline`; MotionFx tints that player's ghosts; the spark systems take the owner's spark colour.
- Stage assets: a floor's manifest adds a character's dye sheets only when a member wears a dye of that character.
- Prismatic: a pure `prismaticColor(t)` in shared/view on the view's clock; reduced motion holds its first stop.

### Armory

- The Cosmetics tab groups items by slot. Each row: swatch, name, price, Buy / Equip / Equipped.
- **Live preview**: the slot's character drawn from its idle sheet, dye sheet and outline sheet as stacked UI
  ImageLabels (no viewport), turning through its facings, with the focused item **tried on** before it is bought.
- The purchase moment: `sfx.shop.buy`, a stamp on the row, the preview flashing to the new look.
- Gamepad (a focus scope like the other tabs), touch and portrait sizes as the Armory today.

## Tasks

- [ ] **CS0. Findings.** Code half while building; device half (GPU texture memory on the iPhone with 0 / 1 / 4 dyed
  players) open, decides CSD4.
- [ ] **CS1. Masks.** (Built 2026-11-17, "As built: pipeline"; the owner's sign-off by eye open.) The `dye` option on both sets; review every animation and facing on the dye contact sheets;
  `exclude` rects for the Archer's bow. **Verify:** owner sign-off by eye on the contact sheets.
- [x] **CS2. Pipeline output.** `<sheet>-dye.png`, `dyeFile`, `dyeMeanValue`, tests. **Verify:** `npm run test:art`.
- [x] **CS3. Theme.** `dyeImage`, `cosmetics.ts`, `cosmeticReport`, strings and l10n context. **Verify:**
  `npm run verify`. ("As built: theme (CS3)".)
- [x] **CS4. Wallet and server.** Catalogue rows, `CosmeticLook`, `RunSession.looks`, `PartyRunStart.looks`, lobby
  looks, `KV_FakeWallet` presets. **Verify:** wallet / lobby / run session specs. ("As built: wallet and server (CS4)".)
- [x] **CS5. View.** SpriteView dye label, look plumbing, outline / trail / spark overrides, readiness, stage
  manifest. **Verify:** headless specs for the pure parts; typecheck. ("As built: view (CS5)".)
- [x] **CS6. Armory and character screen.** Tab, preview, try-on, buy / equip. **Verify:** fit and focus specs.
  ("As built: Armory (CS6)".)
- [ ] **CS7. Lobby and co-op.** Teammates' looks. (Built 2026-11-17, "As built: lobby (CS7)".) **Verify:** Studio, two
  clients (open).
- [x] **CS8. Upload.** 15 dye sheets into `assetIds.ts` (2026-11-17; `contentIds.spec` expects every vale Knight / Archer
  frame to carry one).
- [ ] **CS9. Studio check and playtest.**
- [x] **CS10. Prismatic.** Data half built (stops, `prismaticColor`, rule 5: "As built: theme (CS3)"); the drawing is CS5
  ("As built: view (CS5)": the sprite clock in runs, Heartbeat in menus, held at the first stop under reduced motion).
- [ ] **CS11. Earned cosmetics** (not this pass).
- [ ] **CS12. Telemetry** (not this pass).

## As built: pipeline (CS1-CS2, 2026-11-17)

`art/atlases.json` `dye` on both sets, `scripts/art/build-atlases.js` (`dyeConfig`, `dyeMask`, `dyeSheet`,
`dyeContactSheets`; docs/ART.md "Dye sheets" has the option's exact semantics), specs in `scripts/art/dye.test.js`.
Built with `--only class.vanguard` and `--only class.ranger`.

**Final rules.** Both sets: `open` 3 x 3, `regrowPx` 1, `minAreaPx` 20, `normalizePercentile` 98, no `exclude` rects.

| | Knight (`class.vanguard`) | Archer (`class.ranger`) |
|---|---|---|
| Rule | alpha > 240, max RGB > 8, saturation < **0.10**, luminance >= 88 | alpha > 240, max RGB > 8, luminance <= 69, hue [0, 55) or [340, 360) |
| `unless` | luminance >= 130 and hue [180, 360): the baked swing smears | none |
| Dyed share of body pixels (alpha > 240, max RGB > 8) | **47.6 %** (206,085 of 432,552) | **63.8 %** (138,335 of 216,832) |
| Normaliser p (98th percentile luminance) | 183 | 60 |
| `dyeMeanValue` | **0.7342** | **0.5114** |
| Removed by the shape steps (of what the colour rules took) | 18.5 % | 19.8 % |

Changes from the prototype, found on the contact sheets:

- **The Archer's bow** is the tunic's exact browns (`#1e1106` on both), so no colour rule parts them. It is cut by
  shape: its limbs and string are 1-2 px strokes in every animation and facing, so the 3 x 3 opening drops them, the 1
  px regrowth returns the body's own edge (and at most 1 px of bow where it touches the body), and the 20 px area cut
  takes the odd 2 px-wide limb segment that survives the opening on its own (attack.2, facing 3). No exclusion rects
  were needed. Where the bow crosses in front of the tunic it is part of a thick region and dyes with it.
- **The Knight's sword** is the plate's own grey (the prototype's "untouched" was wrong: it was dyed in every facing),
  removed by the same opening. **The bare head** (skin, saturation 12-15 %, hue ~22) was caught by the prototype's
  satMax 0.18; the plate is 2-5 %, so satMax is 0.10 and the head stays skin (the art has no helm: the "helm" in the
  prototype's list was the head). **The attacks' swing smears** have an opaque core of plate lightness (luminance
  180-205) but pink-violet (hue 290-350); lit plate at luminance >= 130 is warm (hue < 60) in every sheet, 0 such
  pixels outside attack.1-3, hence the `unless` rule.
- The baked black shadows (alpha <= 239 / <= 207) never pass `alphaMin`; skin, the Archer's orange bracers and the
  Knight's sword, shield rim and straps stay undyed.

**Files.** 15 dye sheets in `art/build/` and `art/upload/` (none has an id yet, CS8): `vanguard-{idle, run, roll, hit,
death, attack1, attack2, attack3}-dye.png` (1024 x 1024) and `ranger-{idle, run, roll, hit, death, attack1,
attack2}-dye.png` (968 x 776). Contact sheets, one per animation: `art/build/contact/class.vanguard-dye-<animation>.png`
and `class.ranger-dye-<animation>.png` (rows = facings 0-7; the first, middle and last kept frame; body, mask in
magenta, scarlet / cobalt / teal / amethyst). The 30 body and outline sheets are byte-identical to the uploaded ones
(sha256), and layout.ts changed only by `dyeFile` and `dyeMeanValue`.

**For the owner to look at (CS1 sign-off).**

- The opening also leaves a few thin plate pixels undyed: the Knight's toe tips and some 1-2 px forearm edges keep their
  grey, and legs seen through a swing smear stay grey for those frames. Visible only zoomed in, by eye.
- The dye sheet's transparent pixels are (0, 0, 0, 0), not bled. If Studio shows a dark seam where a dyed region meets
  undyed body under `Default` filtering, bleeding the dye sheets' RGB (alpha unchanged, as the body sheets do) fixes it
  without touching the layout.
- `dyeMeanValue` is above the prototype's 0.71 / 0.48 (head, sword and bow out), so CS3's readability gate must use
  these values, not the table above.

## As built: theme (CS3, 2026-11-17)

**Dye sheets in the theme.** `SpriteSheetImage.dyeAssetId` (types.ts; validated like `outlineAssetId`: an uploaded id,
never the sheet's own or its outline's), `SpriteFrameRect.dyeAssetId` (core.ts, `spriteSheetDye`) and
`SpriteFrame.dyeImage` (pack.ts), same rect as the frame. The vale manifest sets a sheet's `dyeAssetId` only once
`ids[sheet.dyeFile]` exists (like the outline), so until CS8 every set draws exactly as before. **Preload:**
`ThemeCore.contentIds` skips every `dyeAssetId` (the knight is in `PRELOAD.core`: the 15 dye sheets must not load for
everyone); `ThemeCore.dyeContentIds(id)` / `ThemePack.dyeContentIds(id)` list a set's dye sheets in sheet order, for
the stage manifest to push only when a member wears a dye of that character (CS5). contentIds.spec: a set's content
stays exactly its sheets + outline sheets with dyes present.

**Data.** One item list, `shared/cosmetics` `COSMETIC_ITEMS` (id, slot, tier, `prismatic`); the wallet's catalogue rows
and the theme's colours are keyed by it (`theme/cosmetics.ts` `COSMETIC_COLORS` / `PRISMATIC_STOPS`, typed by the ids,
so a missing colour is a compile error; cosmetics.spec cross-checks at run time). `COSMETIC_DYE_SETS` (knight
`class.vanguard`, archer `class.ranger`), `valeDyeMeanValue(setId)` (packs/vale dyes.ts: the layout's `dyeMeanValue`).
**Prismatic** (CS10's data): `prismaticColor(stops, tSec, periodSec = PRISMATIC.periodSec 8)`: one segment per stop,
smoothstep eased (rate 0 at every stop, so the loop has no corner), wraps any real t; t = 0 is the first stop (the
reduced-motion hold). `cosmeticColor(itemId, tSec)` gives any item's 0..255 colour.

**The report.** `theme/cosmeticReport.ts` `cosmeticReport(manifest, dyeMeans, dyeSources?)` (its own module: it
imports validate.ts, and contract.ts imports cosmetics.ts for the strings): rule 1 `danger` (>= 40 CIE76 from
`enemyBullet`, `enemyBulletOutline`, `telegraph`, `enemyOutline`), rule 2 `pickup` (>= 30 from the four boosts and
`enemy.golden`), rule 3 `floor`, all on the dyed mean (colour x `dyeMeanValue`, per channel, rounded); outlines
through `playerOutlineReport` with the colour as `playerOutline` (floors and walls 3 : 1, 40 from threats and boosts);
trails rule 1; sparks through `nearMissReport` with the colour as `nearMiss.graze`; Prismatic every stop and 16 eased
samples per segment through 1-3. A character with no mean fails a `mean` entry per dye. Bars in `COSMETIC_RULES`.

**Rule 3, revised (orchestrator, 2026-11-17; flagged to the owner).** The dyed mean's contrast on each biome floor
must reach **min(3 : 1, the undyed region's own contrast on that floor)**: a dye may never make the body less readable
than the default look, capped at 3 : 1. The baseline is the art's: the pipeline now writes `dyeSourceMean` per dyed set
(the mean source RGB over every masked pixel, beside `dyeMeanValue`; `scripts/art/build-atlases.js`
`addDyeColorSum` / `dyeSourceMean`, `dye.test.js`, the layout type in the generator and layout.ts), read by
`valeDyeSourceMean(setId)`. Rebuilt with `--only class.vanguard` / `--only class.ranger`: the 30 body and outline
sheets and the 15 dye sheets byte-identical, layout.ts changed only by `dyeSourceMean` (Knight `#8b8583`, Archer
`#2f1b08`). The Knight's plate reads at >= 4.00 : 1 on every floor, so his bar stays 3 : 1; the Archer's dark leathers
read at <= 1.13 : 1, so hers is about 1.1 : 1 per floor. Without a baseline the report holds a dye to the full 3 : 1
(never a looser bar). cosmetics.spec runs it over both bundled packs on the layout's values and prints every item's
worst margin with its bar.

**The palette.** Draft candidates on the real means (vale; danger / pickup CIE76, floor ratio over the floor's bar,
worst of each):

| Candidate | Knight (x 0.7342, bar 3 : 1) | Archer (x 0.5114, bar ~1.1 : 1) |
|---|---|---|
| Scarlet `#c0182a` | 43.0 / 81.6 / **0.52x**: lightened to Rose `#f98686` | **39.0** / 81 / **0.97x**: brightened to `#e61d32` |
| Cobalt `#3c64dc` | 59.5 / 42.0 / **0.60x**: lightened to Azure `#59acff` | 42.1 / 52 / 1.09x: kept |
| Verdant `#3cb44b` | 77.1 / 51.4 / 1.03x: kept | 57.8 / 61 / 1.61x: kept |
| Amethyst `#9650d2` | 55.0 / 40.1 / **0.64x**: lightened to Lilac `#c294d1` | 42.8 / 50 / 1.13x: kept |
| Frost `#a0dcff` | 65.4 / 44.5 / 1.76x: kept | 46.6 / 52 / 2.48x: kept |
| Teal `#28b4aa` | 60.2 / 41.4 / 1.07x: kept | 44.5 / 58 / 1.65x: kept |
| Ivory `#f0ead6` | 64.6 / 51.2 / 2.13x: kept | 48.6 / 60 / 2.91x: kept |
| Bronze `#b4783c` | 46.1 / 58.4 / **0.79x**: lightened, `#cf9e3d` | **35.7** / 73 / 1.31x: brightened to `#d89048` |

Nothing dropped. The Archer's Scarlet and Bronze failed rule 1 against the enemy bullet's dark outline (`#1a0610`),
so they are 20 % brighter. The Knight's Verdant and Teal are back on the draft's hues (they passed on the real mean).

Shipped, worst margins on vale (placeholder within 0.05; floor = worst ratio, its bar in brackets):

| Item | Hex | Worst danger | Worst pickup | Worst floor |
|---|---|---|---|---|
| Frost Plate | `#a0dcff` | 65.4 | 44.5 aegis | 5.29 (3) |
| Ivory Plate | `#f0ead6` | 64.6 | 51.2 quickstep | 6.39 (3) |
| Teal Plate | `#28b4aa` | 60.3 | 41.4 quickstep | 3.22 (3) |
| Verdant Plate | `#3cb44b` | 77.1 | 51.4 quickstep | 3.09 (3) |
| Azure Plate | `#59acff` | 60.8 | 36.3 aegis | 3.41 (3) |
| Lilac Plate | `#c294d1` | 51.8 | 32.2 aegis | 3.32 (3) |
| Bronze Plate | `#cf9e3d` | 40.4 telegraph | 43.4 fury | 3.37 (3) |
| Rose Plate | `#f98686` | 47.1 telegraph | 60.3 | 3.42 (3) |
| Prismatic Plate | Azure, Teal, Verdant, Ivory, Rose, Frost | 47.1 | 36.3 aegis | 3.09 (3) |
| Frost Leathers | `#a0dcff` | 46.6 | 52.4 | 2.80 (1.13) |
| Ivory Leathers | `#f0ead6` | 48.6 | 59.9 | 3.29 (1.13) |
| Teal Leathers | `#28b4aa` | 44.5 | 57.7 | 1.87 (1.13) |
| Verdant Leathers | `#3cb44b` | 57.8 | 60.6 | 1.81 (1.13) |
| Cobalt Leathers | `#3c64dc` | 42.1 | 52.2 | 1.22 (1.13) |
| Amethyst Leathers | `#9650d2` | 42.9 | 49.9 | 1.28 (1.13) |
| Bronze Leathers | `#d89048` | 43.0 | 66.1 | 1.85 (1.13) |
| Scarlet Leathers | `#e61d32` | 47.0 | 81.5 | 1.28 (1.13) |
| Prismatic Leathers | Bronze, Verdant, Teal, Frost, Ivory | 41.9 | 52.4 | 1.73 (1.13) |

The Archer's danger margins sit at the enemy bullet's dark outline in every case. Her Prismatic is the best-margin loop
of five of her dyes: no loop of six, and no loop through Scarlet, Amethyst or Cobalt, passes, because the step between
red / violet / blue hues dims to within 40 of that outline (Amethyst -> Scarlet 33.0, Frost -> Cobalt 39.0).

The Knight's Lilac moved from `#c59fdf` (29.1 from Aegis on the real mean) to `#c294d1`. Outlines (floor / wall ratio, CIE76; all
pass): Azure `#33ccff` 6.28 / 45.2, Silver `#c0c8d0` 6.95 / 46.6, Jade `#33ff99` 8.90 / 42.2, Sand `#e8d8a8` 8.29 /
47.5, Rose `#ff99b3` 5.85 / 41.8, Moss `#85c270` 5.57 / 41.0, Violet `#b366ff` 3.50 / 41.7, Orchid `#cc33ff` 3.07 /
60.6. Rejected outlines: Lilac `#e0c8ff` (22 from Aegis), Mint `#9effc4` (23 from Quickstep), Cobalt `#3c64dc` (2.3 :
1), Teal (23 from Quickstep), Gold (5 from Fury), Pink `#ff66cc` (17 from the bullet). Trails (rule 1): Azure 86.6,
Ivory 67.1, Jade 113.1, Verdant `#3cb44b` 95.1, Cobalt `#4060ff` 80.7, Violet 57.4. Sparks (floor ratio / CIE76):
Azure 7.76 / 86.6, Jade 11.0 / 113, Violet 4.33 / 57.4, Rose 7.24 / 41.8, Orchid 3.80 / 60.6.

**Strings** (`COSMETIC_STRING_KEYS`, spread last in `REQUIRED_STRING_KEYS` after the Silver shop's; the pinned tails
in nine theme specs shifted): `cosmetic.equip` / `.equipped` / `.unequip` ("Take off") / `.tryOn` / `.none` ("Default")
/ `.animated`, `cosmetic.slot.<slot>` ("Knight dye", "Archer dye", "Outline", "Roll trail", "Sparks") and
`cosmetic.<id>.name` ("Frost Plate", "Prismatic Leathers", "Azure Trail", "Orchid Sparks"); l10n context entries.
`armory.cosmetics.later` was removed with the empty tab (CS6). No colour role, sound or setting;
contract.ts gained one import.

## As built: wallet and server (CS4, 2026-11-17)

- **Catalogue.** `ARMORY_CATALOG` appends `cosmeticArmoryItems()`: one row per `COSMETIC_ITEMS` entry (`kind`
  "cosmetic", one level, `simLever` false, `slot`), after catalogue v1 (catalog.spec's order lock lists all 42 rows, 37 of them cosmetics).
  Tiers: each character's dyes 2, 2, 3, 3, 4, 4, 5, 6 (Frost, Ivory, Teal, Verdant, then Azure / Cobalt, Lilac /
  Amethyst, Bronze, Rose / Scarlet); both Prismatic 8; outlines 2-5; trails 3-7; sparks 4-7 (37 items, 28,680 Silver
  in all). `applyEquip` unchanged (a dye's slot names its character).
- **Goals.** `nextGoals` skips cosmetics (a choice, not a step; tier 2 colours would otherwise always crowd out the
  next upgrade on the Armory marks and the run-over `to go` line). The main menu badge (`affordableKeys`) still
  counts them.
- **Looks.** `shared/cosmetics` `CosmeticLook { dye?, outline?, trail?, spark? }` (item ids; `dye` the played
  character's), `cosmeticLookOf(equipped, character)`, `equippedMapOf(WalletStatus.equipped)`, `readCosmeticLook`
  (a wire value: known items in their slot only), `sameCosmeticLook`, `isDefaultLook`, `NO_LOOK`.
  `shared/wallet` `walletEquipped(doc)` / `WalletBook.equipped(userId)`: owned cosmetics in their own slot.
- **Server.** `SilverAccess.equippedFor` (optional; `accessEquipped` checks it), wired by WalletService from the
  read copy. `StartContext.equipped`; the registry stores `RunSession.looks` (`sessionLooks`: member order, each for
  the character the setup gives them, the Knight where a world has none: every world, CSD12; unknown wallet `{}`);
  `StartRunReply.look` (the owner's), `PartyRunStart.looks`. `LobbyView.looks` (same index as `members`, for each
  member's pick; `lobbyViewOf`'s `lookOf`). `SilverAccessService.lookOf` / `lookChanged` / `onLookChanged`:
  WalletService calls `lookChanged` after a successful equip and after a wallet load; LobbyService re-sends that
  member's lobby. Never hashed, recorded, validated or in `buildWorldSetup` (looks.spec: same first hash dressed or
  not).
- **Studio.** `KV_FakeWallet`: an item ending in `*` is owned and equipped (`6000;outline.azure:1*`); `cosmetics`
  owns every cosmetic; `dressed` also equips `WALLET_FAKE_DRESSED` (both Prismatic dyes, Azure outline, Violet trail,
  Jade sparks).

## As built: view (CS5, 2026-11-17)

Presentation and client timing only: no sim, dungeon, lockstep, hash, replay, fixture, score, wallet or server change.

- **Looks on the client.** `RunContext.looks` (SimController, player index order): a co-op run's
  `PartyRunStart.looks` (each through `readCosmeticLook`), a ranked solo run's `StartRunReply.look`, any other solo
  run the wallet's equipped slots for the run's character (`cosmeticLookOf`; the Knight in a world without characters,
  CSD12; an unknown wallet the default look). Looks are per player, not per viewer: spectating changes nothing.
- **Pure core** `shared/view/cosmetics` (not in the shared/view barrel): `COSMETIC_VIEW`, `lookAt`, `cosmeticClockSec`
  (reduced motion: 0, the Prismatic dye's first stop), `cosmeticRgb8` (whole channels) and `rgb8Key` (a change key, so
  a Prismatic dye is rewritten only when a channel moves), `tintedDye`, `dyeCharacterOf` / `dyeSetOf`, `dyeForVisual`
  (only a dye of the drawn set: never one character in another's colour), `lookAnimated`, `stageDyeSets`. Specs:
  `view/cosmetics/cosmetics.spec.ts`.
- **SpriteView.** A "Dye" ImageLabel (`ACTOR_OUTLINE.spriteZIndex.dye` 3, above the frame, `spriteDyeLabelName`) built
  on the first `setDye(color)`; written in the frame's branch (`SpriteFrame.dyeImage`, the frame's rect); its
  ImageColor3 the dye x the tint per channel (`setTint` rewrites it); transparency follows `setTransparency`, Visible
  follows `setVisible`, and it draws only with a colour, a frame whose sheet has a dye, and that sheet's content ready
  (`setDyeReady(fn)`: ActorRenderController passes `ArtReadiness.status(contentId) === "ready"`; `refreshDye()` on a
  readiness epoch change). `reset()` clears the dye. A view never dyed builds nothing and writes nothing more per frame
  (one field holds the frame's dye image). `snapshot` carries the dye (`GhostSnapshot.dyeImage` / `dyeR/G/B`, the
  colour as drawn). Until CS8 no frame has a `dyeImage`, so nothing is drawn in runs.
- **ActorRenderController.** `applyLook` per player after `drawPlayer`: the dye (Prismatic on the cosmetic clock: the
  sum of the sprite clock's `animDtSec`, so pause and hitstop hold it), the rim (`setRimColor`: an outline item
  replaces `playerOutline`; still drawn on the watched player only; the placeholder capsule's one Highlight takes the
  watched player's colour) and the trail (`MotionFx.setTrailColor`); each written only when `rgb8Key` changes; a body
  swap (stand-in <-> art) rewrites them. The minimap self marker is unchanged (CSD9).
- **Trails.** `MotionFx` tints a player's ghosts with their trail colour (white: none) when each ghost is re-recorded;
  a dyed ghost draws its dye on a second label (dye x trail colour).
- **Sparks.** ParticleController appends one palette entry per spark cosmetic (`cosmeticItemsOf("spark")`, after the
  third endless set's bursts) and picks the owner's (`GrazeSpark.player` / `ParryBurst.player`) for graze and parry
  sparks; ParryFlashController's PARRY! text keeps its role.
- **Stage assets.** `StageAssetInput.dyed` (sprite set ids); `stageDyeGroup` adds `dye:<set>` entries
  (`STAGE_DYE_PREFIX`) to the characters group after the sets, only for a set a present player wears a dye of and the
  pack has dye sheets for; `stageContentRefs` resolves them through the optional `PreloadSource.dyeContentIds`;
  `stageIsLogicalId` keeps them (and `biome:`) out of the reveal's readiness log. StageController adds the run's dyes
  (`withDyes(stageInputOf(...), ctx.looks)`) to the floor's manifest and the next floor's prefetch, and on the menu
  queues the local player's equipped dye for the picked character on the next lane (`dyePrefetch`).

## As built: Armory (CS6, 2026-11-17)

- **Pure core** `shared/view/menu/cosmetics.ts`: `armoryCosmeticEntries` (a header per slot in `COSMETIC_SLOTS` order,
  then its items in catalogue order; each the Armory's own `armoryRow` with `owned`, `equipped`, `animated` and an
  `action`: buy when affordable, equip / take off once owned, none when poor or unavailable), `cosmeticDetail` (name,
  `{slot} · Tier n`, `Animated`, the price / Equipped / Owned / `to go`, the buy hold and its confirm from
  `CONFIRM_FROM_TIER`, the equip label), `cosmeticEquipArgs` (take off: `WALLET.noItem`), `cosmeticRowRight`,
  `cosmeticPreviewCharacter` (a dye's own character, else the picked one), `cosmeticPreviewLook` (the equipped look
  with the focused item tried on; another character's dye leaves it unchanged), `previewTurnFacing` (every facing in
  turn from the camera-facing one, `COSMETIC_VIEW.preview.facingSec` each; reduced motion holds it),
  `cosmeticFlashScale` / `cosmeticFlashTransparency`. Specs: `view/menu/cosmetics.spec.ts` (counts read from
  `COSMETIC_ITEMS`).
- **ArmoryScreen.** The Cosmetics tab draws the grouped list (`client/ui/menu/ArmoryCosmetics.tsx`: `CosmeticSwatch`,
  a Prismatic swatch drifting on Heartbeat; slot headers; rows with swatch, name, `Animated`, Equipped / Owned / price)
  and the detail's own lines: the live preview, name, slot and tier, `Try on` while not owned, the price row and the
  button (the Armory's buy hold and confirm, or Equip / Take off through `MenuActions.armoryEquip` ->
  `WalletController.equip` -> `walletEquip`; a refused equip plays `sfx.shop.deny`). The hold acts on the focused
  item of either kind (`target`). A bought cosmetic's row stamps (a `UIScale` eased from 1.15 and a silver flash fading
  over 0.6 s; `sfx.shop.buy` is WalletController's, as before). The tab keeps the Armory's sizes, focus scope
  (`memoryKey="armory"`, the first item is the default selection) and fit: the preview sits inside the detail panel,
  which scrolls (112 px box, 80 on a phone or upright), so the fit specs are unchanged.
- **Live preview** (`client/ui/menu/CharacterPreview.tsx`, moved out of CharacterScreen and shared by both screens):
  the idle animation as stacked ImageLabels, rim (outline sheet, the look's outline colour or `playerOutline`) under
  the body, dye over it from the frame's dye sheet tinted by the dye's colour, turning through its facings. The dye
  label shows only once its sheet's content is ready (`client/ui` `uiContentReady`, a content-id readiness that
  re-renders on its flip like `uiImage`) and the sheets are asked for on the front lane (`requestUiContent`: no preload
  tier holds them). Beside the preview, the focused item's swatch chip always shows (a trail / spark colour has no
  sprite; a dye whose sheet is not in is the chip, never a tint over the whole body).
- **CharacterScreen.** Each card's preview wears that character's equipped dye (drawn once its sheet is ready).
- **Strings.** None added; `armory.cosmetics.later` removed (ARMORY_KEYS, the placeholder pack, l10n context).

## As built: lobby (CS7, 2026-11-17)

- `RoomMember.dye` (shared/view/menu lobby.ts: `readCosmeticLook(LobbyView.looks[i]).dye`); LobbyRoom draws it as a
  still swatch chip (`COSMETIC_VIEW.lobbyChipShare` of the icon) on the character icon's bottom-right corner, taking no
  row width. Spec: character.spec.ts ("each member row carries the dye they wear").
- Party runs: every teammate's sprite is dyed through CS5 (`PartyRunStart.looks`), their trails and sparks too; the
  rim stays the watched player's only.
- **Open (Verify):** Studio with two clients (a dyed teammate, a lobby chip, a Prismatic dye in co-op).

## Preview actions (2026-11-17, owner)

The Armory's try-on preview acts a trail or spark item out instead of only showing its swatch. Presentation only.
Pure core `shared/view/menu` `cosmeticAction.ts` (spec `cosmeticAction.spec.ts`): `cosmeticPreviewAction(itemId)` (a
trail rolls, a spark attacks, anything else keeps the turning idle), `previewActionAnim` (`roll`; `attack.1`, the
Knight's swing and the Archer's quick shot, else `attack`; a spec checks both vale sets resolve them: the first build
looked for `attack1`, found nothing and silently kept the idle), `previewActionPhase` (a cycle is `COSMETIC_VIEW.preview.action.restSec` 0.7 s of idle, then the animation
once, its last frame held), the roll's slide (`previewRollOffset`: `rollSlideShare` 0.5 of the box, eased out,
ping-pong right / left so it never jumps back, facing screen 0 / 180) and its ghosts (`previewGhosts`: the in-run
FEEL_GHOST numbers: one every 4 sim ticks while rolling, 0.15 s life, 0.5 -> 1 transparency, at most 3; they fade
after the roll), and the attack's burst (`previewBurst` / `previewBurstOrigin`: the in-run parry burst,
NEAR_MISS_VIEW.parry: 6 sparks over the fan, speeds 5-11 tiles/s with drag 10, the ring 0.1 -> 0.55 tiles, opaque for
35 % of 0.25 s, from `sparkAtShare` 0.5 of the attack, `sparkReachTiles` 0.45 in front of the centre, facing
`attackAngleDeg` 315). Client: `CharacterPreview` takes `action` / `trailItem` / `sparkItem`: the ghosts are body
labels (plus their dye) tinted by the trail colour (dye x trail on the dye), the sparks small square frames and the
ring a rounded frame with a stroke, in the spark colour (`nearMiss.parry` without one). Reduced motion, or a set
without the animation, keeps the still idle. The swatch chip stays beside it. **Staged bigger (owner, 2026-11-17: the
in-run 1-2 art px sparks were invisible at menu size):** the preview's sparks are `sparkPx` 6 / 9 reference px, the
ring's stroke `ringStrokePx` 2, the spread x `spreadScale` 1.4 and the whole burst `burstSlowdown` 2.5 times slower
(0.625 s), running on into the rest after the attack (`previewBurstAt`); in runs the burst is unchanged.

## Review fixes (2026-11-17)

An independent review of the whole branch found no determinism, sim-isolation or server-trust defect. Fixed:
roll-ghost dye labels now take their ghost's transparency on every write and fade step (motionFx; they were fixed at
the value the label was built with); the Armory's "Bought ..." line names a cosmetic by `cosmetic.<id>.name`
(shared/view/silver `armoryItemName`; it read the raw `armory.item.<id>` key; a spec checks every catalogue item);
`ActorRenderController.applyLook` returns before any colour work for an unchanged, still look (no per-frame
allocation). Left as is: `cosmetic.none` ("Default") is a required string nothing shows yet (reserved for a per-slot
Default row).

## Robux-only animated cosmetics (2026-11-19, owner)

Every **animated** cosmetic (today the two Prismatic dyes) is sold for **Robux only**, through one Roblox **game pass**
per item; nothing animated can be bought with Silver (CSD13). Every other cosmetic stays a Silver item. No sim, dungeon,
lockstep, hash, replay, fixture, score or leaderboard change; `DAILY.ruleset` unchanged; the wallet doc stays `v: 1`.

**Why a game pass, not a developer product.** Roblox sells a pass once, so a player can never pay again for a dye
they own (a developer product can be bought repeatedly: we would have to block it and decide what a receipt for an
owned dye does), and Roblox remembers the ownership, so the join check gives it back after any wallet loss. The cost:
no receipt redelivery; a purchase the server misses (a crash between the prompt and the grant) lands at the buyer's
next join. Passes show on the experience's Store page unless taken off it there (SHD5's calm selling).

**Data.** shared/wallet `ArmoryItem.robux` (set by `cosmeticArmoryItems` for every `isPrismaticItem`, so a later
animated item is Robux-only by the same rule; `isRobuxItem`). Its `tiers` stay `[8]` (one level: `own`, the level
reads and the codec are unchanged, and a Prismatic dye **bought with Silver before the change stays owned**), but it
has no Silver price: `itemSilverPrice` / `itemPrice` are undefined, `applyBuy` refuses it (`robuxOnly`), `nextGoals`,
the badge (`affordableKeys`) and `dearestOwnedTier` skip it. `passes.ts`: `COSMETIC_PASSES` (per universe: item id ->
pass id; Roblox Dungeons: Prismatic Plate `2092456672`, Prismatic Leathers `2093746633`, both 2026-11-19), lookups,
`parseFakePasses`, `cosmeticPassStatusFields`. Transform `applyPassGrant` / op `passGrant` (own the item; owned
already: no write; never touches earned, spent, bought, eq or the day marks), `WalletBook.grantPass`.
`WalletStatus.robuxItems` (each item on sale here with its pass id, or Studio's fake price) and `passPurchase`
(`{ itemId, bought }`).

**Server.** `CosmeticPassService`: after each join load (`WalletService.onLoaded`) every pass of this universe whose
item the wallet does not own is checked with `UserOwnsGamePassAsync` and granted if owned (bought on the website, in
another server, a lost grant); `PromptGamePassPurchaseFinished` with `purchased` is confirmed with
`UserOwnsGamePassAsync` (`COSMETIC_PASS.verifyTries` 3, `verifySeconds` 2 apart; Studio trusts the signal, its test
purchases are not owned) and granted, then a `wallet` push with `passPurchase`. Nothing the client sends grants
anything, except Studio's `cosmeticPassFakeBuy(itemId)` while `KV_FakePasses` gives a fake price (Studio only, rate
limited `COSMETIC_PASS.fakeRate`).

**Client.** `CosmeticPassController`: Roblox's price per pass (`GetProductInfoAsync(pass, GamePass).PriceInRobux`,
once per item per session, never in code), `buy(itemId)` opens `PromptGamePassPurchase` (one at a time; a cancelled
prompt frees the button; no grant within `COSMETIC_VIEW.robux.pendingTimeoutSec` 30 s frees it too), a grant plays
sfx.shop.buy, stamps the row and toasts `{name} unlocked` (`COSMETIC_VIEW.robux.toastSec`). Store slice
`cosmeticPass`. View (shared/view/menu): row states `robux` / `offSale`, action `robux`; the row's right text
`{robux} Robux` (`Robux only` before the price is read) or `Not for sale`; the detail's sub `{slot} · Robux only`, the
price without the Silver coin, one press of `Buy for {robux} Robux` (`Buy with Robux` without a price): Roblox's prompt
is the confirm, so no hold. Menu action `armoryBuyRobux`. Six strings `cosmetic.robux.*` (`COSMETIC_KEYS`, l10n context
entries).

**Studio.** `KV_FakePasses` (Workspace, Studio only): `off` takes the dyes off sale; one whole price (`299`) puts every
Robux-only item on sale at it and a press grants it into the memory store. With real pass ids, Studio's test purchase
prompt works too.

**Owner steps.** Creator Hub > the experience > Monetization > Passes: create **Prismatic Plate** and **Prismatic
Leathers**, set their prices, put them on sale (and choose whether they show on the Store page), then paste their ids
into shared/wallet `passes.ts` `COSMETIC_PASSES` under `ROBLOX_DUNGEONS_GAME_ID` (done 2026-11-19:
Plate `2092456672`, Leathers `2093746633`). Pending: the Studio check
(a fake buy, a test purchase with real ids, a cancelled prompt, the join grant), telemetry (not built).

## Decisions (accepted as recommended, 2026-11-17)

| # | Question | Decision | Alternative kept for later |
|---|---|---|---|
| CSD1 | Runtime dye layer or baked palette swaps? | **Runtime dye layer** | Baked `recolor` prestige skins |
| CSD2 | Multiply's flattened highlights | **Accept for v1** | A highlight sheet over the dye |
| CSD3 | Dye regions per character | **One** (plate / leathers) | A second "trim" channel |
| CSD4 | Dye sheet layout | **Aligned to the body sheet** | Packed by bounding box, if CS0's memory numbers demand it |
| CSD5 | Dark dyes | **Not allowed** (floor-contrast rule) | Allowed with a forced teammate rim |
| CSD6 | Gold / red bodies | **No** (danger and Goldling rules) | A prestige "Gilded" ramp chosen to pass |
| CSD7 | Animated Prismatic dye | **Yes**, tier 8, validated stops, held under reduced motion | None |
| CSD8 | Earned, not-for-sale cosmetics | **Yes, a few** (CS11, later) | Purchase only |
| CSD9 | Outline colour on the minimap self marker | **No** | Matching |
| CSD10 | Dyes per character or shared | **Per character** | Shared |
| CSD11 | Bullet / arrow / swing colours | **Out of v1** | A validated swing-fan palette later |
| CSD12 | Cosmetics in the tutorial, the Daily, dev runs | **Everywhere** | Off in the tutorial |
| CSD13 | How animated cosmetics are sold (owner, 2026-11-19) | **Robux only, one game pass each**; Silver-bought ones stay owned | A developer product per item |

## Changes

Presentation, wallet catalogue, server session / lobby fields and one network field. No sim, dungeon, lockstep,
hash, replay, fixture, score or leaderboard change; `DAILY.ruleset` unchanged. New art: 15 dye sheets cut from the
existing body sheets (no new licence: the SmallScaleInt licences already cover modification for use in the game).
