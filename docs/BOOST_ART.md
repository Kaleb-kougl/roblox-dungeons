# Boost drop art (Lords of Pain props): plan

The four boost drops (docs/BOOSTS.md) are drawn with the **Lords of Pain** props instead of the placeholder diamond:
gold coins for Fury and the blue / green / white gemstone clusters for Quickstep / Frenzy / Aegis, each standing in a
role-tinted glow with a short loot-indicator beam and the pack's glint sparkle. This replaces the art half of
docs/BOOSTS.md **B8** (which had planned the Ninja Adventure Items folder). Work it task by task; each task ends with
a **Verify**.

**Presentation only.** No sim, dungeon, lockstep, server, hash or replay change. The drop's position, timers, pickup
and every rule stay as built; only what `boost.<kind>` (plus the optional beam image `ui.marker.boost` and the reused
decor effects `decor.fx.glow` / `decor.fx.glint`) resolve to in the vale pack changes.

## Status (2026-10-26)

BA1-BA3 are done headlessly (atlas entries, theme, validator, vale pack, gems out of decor; the renderer's halo, beam,
glint and pickup flash in `BoostDropRenderController`, pure half in `shared/view/boosts/art.ts`; see "As built" and §3).
BA4 done (the five PNGs uploaded 2026-10-26, IDs in `assetIds.ts`: the vale pack now draws the drops' art). Open: BA5 (Studio), BA6. Owner decisions are under "Decisions"; the
rest are recommended defaults (BA-P1..P6). See "As built (BA1, BA2)" for what differs from the plan text.

## As built (BA1, BA2)

- **No new atlas, no re-upload of the decor atlas.** The five pieces are standalone `images` entries in
  `art/atlases.json` (`boost.fury` / `.quickstep` / `.frenzy` / `.aegis`, `ui.marker.boost`), so `art:build` writes five
  new files: `boost-fury.png` (27x21), `boost-quickstep.png` / `boost-frenzy.png` (13x11), `boost-aegis.png` (13x10),
  `ui-marker-boost.png` (8x103, pivot (4, 100), like the pedestal's). The decor `gems-*` world art entries were NOT
  removed: that would repack and re-upload `decor-atlas.png`. They carry a `$comment` (unused since decision 2) and
  `VALE_RETIRED_WORLD_ART` in `packs/vale/manifest.ts` names them; drop both at the next decor atlas rebuild.
- **Halo and glint reuse the decor effects** (`decor.fx.glow`, `decor.fx.glint`, already in the uploaded decor atlas),
  not new `fx.boost.halo` / glint IDs: `BOOST_HALO_FX` = `"glow"`, `BOOST_GLINT_FX` = `"glint"` (contract.ts). No new
  halo or glint upload is needed. `BOOST_BEAM_IMAGE_ID` = `"ui.marker.boost"`, a free-form optional ui image (ui IDs are
  not listed in the contract; `ui.marker.pedestal` is the same).
- **pixelsPerTile.** The boost slot's image art needs `pixelsPerTile`, which standalone images had no way to carry, so
  BA1's commit broke vale.spec (8 failures: with fake IDs every `boost.<kind>` became an image without it). The
  pipeline's `images` entries take `pixelsPerTileFrom` (a sprite set id, like the sprite sets' and `worldArt`'s; here
  `enemy.swarmer`, so 29.6 exactly), `ValeImageLayout` gained `pixelsPerTile?`, and the manifest copies it. `layout.ts`
  was updated by hand to the generator's exact output (`layoutModule`), since `art/vendor/` was not on the build machine;
  the PNGs are unchanged by it.
- **Vale manifest.** `boost.<kind>` and `ui.marker.boost` follow the `ui.marker.pedestal` pattern (image once the file
  has an ID in `assetIds.ts`, else the placeholder, which for a boost is the placeholder gem). The colour role stays
  `boost.<kind>` (`ThemePack.boost(kind).color`, `.core.role`).
- **Validator (BA-P2).** A pack whose `boost.<kind>` is `image` / `sprites` art must have `decor.fx.glow` art; the
  error is on `assets["boost.<kind>"]`, one per boost with art. The glint and the beam stay optional.
- **Gems out of decor (decision 2).** The four `gems` entries left `VALE_DECOR_PIECES`, and the `gems` kind left the
  contract (`DECOR_KIND_LAYERS` / `DECOR_KINDS`), so no pack can map a decor gem. No floor changed: no plan source ever
  placed `gems` (it is not a Forge `PropKind`; the treasure glint sits on the pedestal), so the decor plan, its census
  and the budget specs are untouched.

### Theme API for the renderer (BA3)

| Layer | Call | Returns |
|---|---|---|
| the drop (coins / gems) | `pack.boost(kind)` (`ThemePack`) | `Boost`: `.art: WorldVisual \| undefined` (`{ kind: "image", image, offset, size, pivot, pixelsPerTile }`; undefined = draw `.placeholder`), `.color: Color3` (the role) |
| the beam | `pack.image(BOOST_BEAM_IMAGE_ID)` | `ImageRef \| undefined` (`assetId`, `w`, `h`, `pivot`: the beam's foot) |
| the halo | `pack.decor(decorFxId(BOOST_HALO_FX))` | `DecorPiece \| undefined` (vale: `.art.kind === "image"`, the 72 px soft disc in the decor atlas), tinted with `pack.boost(kind).color` |
| the glint | `pack.decor(decorFxId(BOOST_GLINT_FX))` | `DecorPiece \| undefined` (vale: `.art` = `{ kind: "sprites", set: SpriteSet }`, the 8-frame loop) |

## What the art and the code give us (checked against `main` @ `d4e4dd7`)

| Fact | Where | Consequence |
|---|---|---|
| Lords of Pain (full pack) props `gemstones_red` / `_blue` / `_green` / `_white` and `gold_drop`: 16 facings x 8 frames, one **256x256** cell each, baked shadow. The 8 frames per facing are **arrangement variants**, not an animation | `art/vendor/lords-of-pain/prop/` | Each drop is a still image. Variants can vary drops at no cost (BA-P3) |
| Visible boxes: a gem cluster ~**15x12 px**, the coin scatter ~**27x22 px**. Lords of Pain props render at **29.6 px per tile** in vale (`layout.ts`) | contact sheet; `packs/vale/layout.ts` `gems-*` | Native size: gems 0.5 x 0.4 tiles, coins 0.9 x 0.75 tiles. `BOOST_VIEW.maxHeightTiles` (5/8) scales the coins down to the cap, so all four read at about the same size |
| Mean colour of the lit pixels and contrast on the biome-1 floor (`#1a1618`): red gems `#7b1139` 1.69:1, blue `#163f75` 1.71:1, green `#156d49` 2.83:1, white `#7b6a74` 3.55:1, coins `#5c3e17` 1.84:1. CIE76 vs `enemyBullet` (`#ff3fa4`): red **48**, blue 82, green 116, white 71, coins 85 | measured | The art alone **fails** the boosts' >= 3:1 floor rule and red sits near the bullet magenta. A role-tinted halo and beam (the roles already pass: >= 5.86:1, >= 59 Delta E) must always be drawn with the art; red gems are not used |
| The same four gem clusters are vale **floor decor** (`decor.delve.b<n>.gems.<1-4>`, `layer: "flat"`, the decor atlas) | `packs/vale/manifest.ts`, `art/atlases.json` `gems-*` | A drop would look like decor. Decision: gems leave the decor list |
| `user interface/loot-indicator/loot_indicator_<red|blue|green|white|yellow>`: a 2 x 97 px vertical beam. Yellow is already the relic pedestal's beam (`ui.marker.pedestal`, `PROGRESSION_VIEW.pedestalBeamHeightTiles`) | `art/atlases.json` | Drops use the **white** beam tinted by the boost's role (exact role colours, never the pedestal's yellow), and a shorter one |
| `vfx/glow.png` (72 x 72 soft disc) and `vfx/glint` (8-frame sparkle, 12 fps) are already built (`glow`, `glint` in `art/atlases.json`) | `art/atlases.json` | Reused for the halo and the sparkle: no new vendor files for them |
| `user interface/highlight/highlight_<colour>`: the soft ring under co-op players (`highlight_yellow`) | ART.md | Optional: `fx.boost.aura.<kind>` as a tinted `highlight_white` ring instead of today's Neon discs (BA-P5) |
| The `BOOST` slot takes `image` / `sprites` / `placeholder`; `BoostDropRenderController` already draws an image as an upright billboard (anchor Part + BillboardGui), bobbing, popping and blinking like the placeholder | `shared/theme/contract.ts`, `client/controllers/render/BoostDropRenderController.ts` | The gem / coin art needs no new body kind. The halo and beam are new layers of that body |
| Licence: Lords of Pain (full pack and DEMO): commercial use, may modify, **may not redistribute the raw files**; compiled into the game is fine | `THIRD_PARTY_NOTICES.md` | The atlas pipeline (gitignored `art/vendor/`, built atlases uploaded) already follows it; nothing new to record |

## Look

| Boost | Prop (facing / frame) | Beam (white, tinted) | Halo (glow, tinted) | Role |
|---|---|---|---|---|
| Fury | `gold_drop` S, frame 0 | `boost.fury` | `boost.fury` | `#ffc83d` |
| Quickstep | `gemstones_blue` S, frame 0 | `boost.quickstep` | `boost.quickstep` | `#3ff0d8` |
| Frenzy | `gemstones_green` S, frame 0 | `boost.frenzy` | `boost.frenzy` | `#a8f03c` |
| Aegis | `gemstones_white` S, frame 0 | `boost.aegis` | `boost.aegis` | `#c3a6ff` |

On the floor, bottom to top: the halo, flat on the floor under the drop (`BOOST_VIEW.haloTiles` ~1.2 tiles across,
additive look via `ImageTransparency`, pulsing gently with the bob); the prop billboard (bob, landing pop, fade blink
as now); the beam rising from the drop (`BOOST_VIEW.beamHeightTiles` ~1.5, under half the pedestal's, so a relic still
reads as the bigger prize); the glint looping over the prop at a per-slot phase. The whole stack blinks together in the
last 2 s and goes on pickup / expiry. Reduced motion: no bob, no halo pulse, glint frozen on one frame.

Pickup / expiry: `fx.boost.collect` becomes the glint played once at 2x scale with a halo flash (Lords of Pain art
only, BA-P4); the particle burst stays as the fallback.

## Architecture

### 1. Atlas (`art/atlases.json`, `npm run art:build`)

- A `boost-atlas` image group (or rows added to the decor atlas if it has room; it is 1024 x 609): `boost-fury`
  (`lords-of-pain/prop/gold_drop/S/gold_drop_S_270.0_0.png`), `boost-quickstep` / `-frenzy` / `-aegis` (the
  `gemstones_<colour>/S/..._270.0_0.png` frames), all `crop: "alpha"`, `pivot: "center"`, `clearRgbBelow` as the decor
  gems use, `pixelsPerTile` = the props' 29.6.
- `boost-beam`: `loot_indicator_white.png`, cropped like `ui.marker.pedestal`, pivot bottom.
- Halo and sparkle reuse the built `glow` and `glint` entries (no new files).
- The decor `gems-*` entries go (decision 2); the atlas is rebuilt and re-uploaded either way, so their space is freed.
  **As built:** standalone images (no boost atlas); the `gems-*` entries stay until the next decor atlas rebuild, so
  the decor atlas is not re-uploaded (see "As built").

### 2. Theme (`shared/theme`, `packs/vale`)

| Piece | Change |
|---|---|
| Contract | `BOOST` slot unchanged (image art). The beam is the optional free-form ui image `ui.marker.boost` (`BOOST_BEAM_IMAGE_ID`). The halo and the sparkle REUSE the decor effects `decor.fx.glow` / `decor.fx.glint` (`BOOST_HALO_FX` / `BOOST_GLINT_FX`), already in the uploaded decor atlas: no `fx.boost.halo`, no new upload. Validator: when a pack gives `boost.<kind>` art, it must also give `decor.fx.glow` art (the art fails the floor contrast alone; the halo carries the role). `gems` leaves the decor kinds |
| Vale manifest | `boost.<kind>` = the four images (`layout.ts` entries from art:build, with `pixelsPerTile`), `ui.marker.boost`; the halo / glint come from the decor fx it already maps; `assetIds.ts` gets the five file ids after upload. Remove the four `gems` decor entries |
| Specs | vale.spec: every boost kind resolves to art once the atlas has an id, and to the placeholder before; the halo rule; the decor list has no `gems` kind |

### 3. Client

| Piece | Change |
|---|---|
| `BoostDropRenderController` | For an image body: add the halo (a flat floor `SurfaceGui` / decal on the anchor, tinted by the kind's role, `BOOST_VIEW.haloTiles`) and the beam (a second BillboardGui above the anchor, tinted, `beamHeightTiles`) when the pack has them, and the glint SpriteView looping over the prop. Pooled with the body, parked with it, blinked with it |
| `BOOST_VIEW` | `haloTiles`, `haloTransparency`, `haloPulse`, `beamHeightTiles`, `beamTransparency`, `glintScale`, `glintFps` (or the set's) |
| `BoostAuraController` (optional, BA-P5) | `fx.boost.aura.<kind>` as a tinted `highlight_white` ring when the pack has it; Neon discs otherwise |
| `BoostRow` (optional, BA-P6) | the kind's prop image as the HUD icon instead of the FRY / QST / FRZ / AEG label, when the pack has art |

**As built (BA3, 2026-10-26; code-complete, Studio pending).** Owner call for BA3: the halo reuses the existing
`decor.fx.glow` and the sparkle reuses `decor.fx.glint` (both already in the vale decor atlas), so `fx.boost.halo` is
not needed by the renderer; the beam is `ui.marker.boost`. Accessors: `ThemePack.decor(decorFxId("glow"))`,
`ThemePack.decor(decorFxId(BOOST_GLINT_FX))`, `ThemePack.image(BOOST_BEAM_IMAGE_ID)` (= `"ui.marker.boost"`, the
RunMarkerController pedestal-beam path), `ThemePack.boost(kind).color` for every tint, `ThemePack.fx(BOOST_COLLECT_FX_ID)`
to decide the pickup effect. Only a kind with art (`boost.<kind>` image or sprites) gets layers; the placeholder gem is
unchanged.

| Layer | As built |
|---|---|
| Prop size | `boostImageLayout`: image art at the art's own `pixelsPerTile` (vale: 29.6 via `pixelsPerTileFrom: "enemy.swarmer"`; `BOOST_VIEW.artPixelsPerTile` = 29.6 is the fallback), and at `frameH / maxHeightTiles` when that would be taller than `maxHeightTiles` (5/8) in all. Gems 13 x 11 px (1 px pad: the review found the 3 px pad shrank the visible prop) -> 0.44 x 0.37 tiles; coins 27 x 21 px -> 0.80 x 0.625 tiles. Stricter than `breakableArtLayout` (which caps only the part above the pivot; a centred pivot would have let the coins draw 0.84 tall). Sprite sets keep `breakableArtLayout` |
| Halo | `decor.fx.glow` via decorParts `buildFloorArt` (top-face SurfaceGui on a thin Part, LightInfluence 0, built at the origin so its frame there is its offset from the floor point), tinted by the role, `haloTiles` 1.2 across, `haloTransparency` 0.35 + `haloPulse` 0.2 x `dropBobPhase` (dimmest at the bob's top; none under reduced motion). Top at `haloLiftStuds` 0.08 (`haloThicknessStuds` 0.02): over decor flats and floor effects, under markings and bullets (spec). No glow art: a Neon Cylinder disc (`haloMaterial`), `haloFallbackTransparency` 0.55. Does not bob or pop |
| Beam | `ui.marker.boost` on its own anchor at the drop's base, `uprightImageBillboard` (its pivot, else bottom centre), tinted, `beamHeightTiles` **1.4** (not the plan's 1.5: the spec asserts strictly under half the pedestal's 3), `beamTransparency` 0.3. Not bobbing. No image -> no beam |
| Glint | `decor.fx.glint` as a second BillboardGui on the prop's anchor (bobs with it), centred on the prop's centre, `glintScale` 0.7 x its own size, `glintDepthStuds` 0.1 in front, scaled with the pop (image props); frame `boostGlintFrame` = `decorLoopFrame(age, fps, frames, slot x glintSlotPhaseFrames 3)`; `glintStillFrame` 2 under reduced motion. Untinted |
| Blink | `boostLayerTransparency(base, blink)`: opacities multiply, so halo, prop, beam and glint blink / dim together |
| Pickup (BA-P4) | No `fx.boost.collect` and the kind has art: a pooled flash at the pickup point, on sim time: halo in the role from `pickupHaloFromTransparency` 0.1 to gone over `pickupFlashSeconds` 0.35, growing to `pickupHaloGrow` 1.8x (x motionScale), and the glint once from frame 0 at `pickupGlintScale` 2x (reduced motion: still frame fading with the halo); lasts `boostPickupSeconds` (8 frames at 12 fps: 0.67 s). Otherwise unchanged (`fx.boost.collect`, or the particle burst for placeholder kinds) |
| Pool | Layers are built with the body, enabled / disabled on acquire / release, parked with it (one BulkMoveTo); flashes park on run start, floor change and exit; everything lives under `KV_Drops` (the controller's Janitor) |

Studio-only checks (BA5): readability on each biome floor, the glint still frame and phase step look right, the halo's
draw order against decor flats and floor effects, the beam's tint and height next to the pedestal, phone size, fps with
four drops in 4-player co-op. The smoke list is in docs/CLIENT.md "Boost drop art".

### 4. Decor

The decor plan (`shared/view/decor`, `packs/vale/manifest.ts`) loses the `gems` kind: its four variants are removed
from the vale list. The plan's densities are per kind, so the other kinds keep their counts; check the decor budget
spec and the treasure-room glint rule (it may have used gems as treasure dressing: keep the glint, swap the prop for
`bones` / `rocks` or nothing). **As built:** nothing placed gems (not a Forge prop kind; the glint is on the pedestal),
so nothing was swapped; the kind left the contract too.

## Tasks

- [ ] **BA0. Confirm.** Every row of the facts table: the frame indices chosen per kind look right in game scale
  (contact sheet at 29.6 px/tile on the five biome floors), the decor's use of gems (density, treasure dressing), that
  the image body path takes extra layers without breaking the pool. → Verify: each row confirmed or this plan edited.
- [x] **BA1. Atlas.** The `boost-*` and `boost-beam` entries, decor `gems-*` removed, `art:build`, `test:art`,
  `art:lock`. → Verify: `npm run test:art`; the built atlas and `layout.ts` show the five new entries and no `gems-*`.
  **Done** as five standalone images; `gems-*` kept (no decor atlas repack). BA2 added `pixelsPerTileFrom` on images.
- [x] **BA2. Theme.** Contract ids (`ui.marker.boost`; the halo is the reused `decor.fx.glow`), the halo rule, vale
  manifest entries, decor `gems` removed. → Verify: theme / vale / decor specs; the vale pack validates with and
  without the file ids. **Done** (see "As built").
- [x] **BA3. Renderer.** (code-complete 2026-10-26; Studio check in BA5; as built in §3) Halo, beam and glint layers in `BoostDropRenderController`, `BOOST_VIEW` tunables, reduced
  motion. Pure helpers (halo pulse, beam alpha, glint phase per slot) in `shared/view/boosts` with specs.
  → Verify: `npm run verify`; `test:only -- view`.
- [x] **BA4. Upload.** Upload the five new PNGs (`boost-fury.png`, `boost-quickstep.png`, `boost-frenzy.png`,
  `boost-aegis.png`, `ui-marker-boost.png`; the decor atlas is unchanged and its halo / glint are already uploaded),
  paste the ids into `packs/vale/assetIds.ts`.
  → Verify: `check:assets`; vale.spec sees every boost kind with art. **Done** 2026-10-26: `theme/boosts.spec.ts` now expects vale to draw `image` art for each kind whose file has an ID.
- [ ] **BA5. Studio check.** `KV_Debug`, M four times on each biome floor (1-5): each drop reads at a glance next to
  bullets, decor and the pedestal; the stack blinks and fades together; pickup glint; reduced motion still; phone
  emulator size; 4-player co-op with four drops at once (fps, no overlap mess).
- [ ] **BA6. Optional extras.** BA-P5 aura rings, BA-P6 HUD icons.
- [ ] **BA7. Docs.** docs/BOOSTS.md (B8 art part done, pointer here), docs/ART.md (slice table row, `gems` no longer
  decor), docs/DECOR.md (gems removed), docs/CLIENT.md (the drop's layers), CLAUDE.md docs-table row.

Critical path: BA0 -> BA1 -> BA2 -> BA3 -> BA4 -> BA5. BA6 any time after BA3.

## Decisions (2026-10-26, Kaleb)

1. **Fury is the gold coin scatter** (`gold_drop`), not red gems: it matches Fury's gold role and is used nowhere
   else; red gems sit near the enemy-bullet magenta (Delta E 48).
2. **Gems leave the floor decor.** A gem cluster on the floor always means a pickup.

## Recommended defaults (confirm or change before the task in brackets)

- **BA-P1. Beam: the white loot indicator tinted by the role**, ~1.5 tiles tall (under half the pedestal's) [BA1].
- **BA-P2. A halo is mandatory with art** (validator rule), because the props alone are 1.7-3.6:1 on the floor [BA2].
  Built: the halo is `decor.fx.glow` (reused, not a new `fx.boost.halo`).
- **BA-P3. One fixed frame per kind** (S facing, frame 0). Variety (frame = slot or landing tick mod 8) is a later
  option; it is presentation only [BA1].
- **BA-P4. Pickup FX: the glint once at 2x plus a halo flash**; the particle burst stays the fallback [BA3]. The glint
  and the halo are `decor.fx.glint` / `decor.fx.glow` (BOOST_GLINT_FX / BOOST_HALO_FX), played by the renderer; no new
  `fx.boost.collect` art is needed for it.
- **BA-P5. Aura rings from `highlight_white`**: optional, after the drops are done [BA6].
- **BA-P6. HUD icons from the prop images**: optional; the three-letter labels stay the fallback [BA6].

## Risks

- **Readability**: the props are small (15 px) and dark. The halo and beam carry the colour; BA5 checks every biome,
  and `haloTiles` / `beamHeightTiles` are the knobs.
- **Gold reads as currency**: there is no gold in the game, so players may expect a counter. The toast
  (`Fury: +50% damage for 30 s`) and the gold aura say what it is; revisit in the B11 playtest.
- **Draw count**: four layers per drop (halo, prop, beam, glint), at most `DROPS.maxOnGround` = 4 drops: 16 small
  instances. Negligible, but BA5 records fps with four drops in co-op.
- **Re-upload**: ~~removing decor gems and adding boost art changes the decor atlas~~. Avoided: the boost art is five
  standalone PNGs and the `gems-*` pieces stay in the decor atlas until its next rebuild.

## Out of scope

- Sound (the four `sfx.boost.*` stay silent until the audio half of B8, Ninja Adventure Audio).
- New art from outside the Lords of Pain pack; animated drops (the props have no animation).
- Any change to drop rules, sizes in the sim, or pickup radius.
