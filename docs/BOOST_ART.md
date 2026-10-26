# Boost drop art (Lords of Pain props): plan

The four boost drops (docs/BOOSTS.md) are drawn with the **Lords of Pain** props instead of the placeholder diamond:
gold coins for Fury and the blue / green / white gemstone clusters for Quickstep / Frenzy / Aegis, each standing in a
role-tinted glow with a short loot-indicator beam and the pack's glint sparkle. This replaces the art half of
docs/BOOSTS.md **B8** (which had planned the Ninja Adventure Items folder). Work it task by task; each task ends with
a **Verify**.

**Presentation only.** No sim, dungeon, lockstep, server, hash or replay change. The drop's position, timers, pickup
and every rule stay as built; only what `boost.<kind>` (and three optional FX ids) resolve to in the vale pack changes.

## Status (2026-10-26)

Plan only. Nothing is built. Owner decisions are under "Decisions"; the rest are recommended defaults (BA-P1..P6).

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

### 2. Theme (`shared/theme`, `packs/vale`)

| Piece | Change |
|---|---|
| Contract | `BOOST` slot unchanged (image art). Three optional ids under the existing `fx.*` / `ui.*` rules: `ui.marker.boost` (the beam image), `fx.boost.halo` (image), and the existing `fx.boost.collect` (sprite, `play`). Validator: when a pack gives `boost.<kind>` art, it must also give `fx.boost.halo` (the art fails the floor contrast alone; the halo carries the role) |
| Vale manifest | `boost.<kind>` = the four images (`layout.ts` entries from art:build), `ui.marker.boost`, `fx.boost.halo` (the `glow` image), `fx.boost.collect` (the `glint` set, played once); `assetIds.ts` gets the atlas id after upload. Remove the four `gems` decor entries |
| Specs | vale.spec: every boost kind resolves to art once the atlas has an id, and to the placeholder before; the halo rule; the decor list has no `gems` kind |

### 3. Client

| Piece | Change |
|---|---|
| `BoostDropRenderController` | For an image body: add the halo (a flat floor `SurfaceGui` / decal on the anchor, tinted by the kind's role, `BOOST_VIEW.haloTiles`) and the beam (a second BillboardGui above the anchor, tinted, `beamHeightTiles`) when the pack has them, and the glint SpriteView looping over the prop. Pooled with the body, parked with it, blinked with it |
| `BOOST_VIEW` | `haloTiles`, `haloTransparency`, `haloPulse`, `beamHeightTiles`, `beamTransparency`, `glintScale`, `glintFps` (or the set's) |
| `BoostAuraController` (optional, BA-P5) | `fx.boost.aura.<kind>` as a tinted `highlight_white` ring when the pack has it; Neon discs otherwise |
| `BoostRow` (optional, BA-P6) | the kind's prop image as the HUD icon instead of the FRY / QST / FRZ / AEG label, when the pack has art |

### 4. Decor

The decor plan (`shared/view/decor`, `packs/vale/manifest.ts`) loses the `gems` kind: its four variants are removed
from the vale list. The plan's densities are per kind, so the other kinds keep their counts; check the decor budget
spec and the treasure-room glint rule (it may have used gems as treasure dressing: keep the glint, swap the prop for
`bones` / `rocks` or nothing).

## Tasks

- [ ] **BA0. Confirm.** Every row of the facts table: the frame indices chosen per kind look right in game scale
  (contact sheet at 29.6 px/tile on the five biome floors), the decor's use of gems (density, treasure dressing), that
  the image body path takes extra layers without breaking the pool. → Verify: each row confirmed or this plan edited.
- [ ] **BA1. Atlas.** The `boost-*` and `boost-beam` entries, decor `gems-*` removed, `art:build`, `test:art`,
  `art:lock`. → Verify: `npm run test:art`; the built atlas and `layout.ts` show the five new entries and no `gems-*`.
- [ ] **BA2. Theme.** Contract ids (`ui.marker.boost`, `fx.boost.halo`), the halo rule, vale manifest entries, decor
  `gems` removed. → Verify: theme / vale / decor specs; the vale pack validates with and without the atlas id.
- [ ] **BA3. Renderer.** Halo, beam and glint layers in `BoostDropRenderController`, `BOOST_VIEW` tunables, reduced
  motion. Pure helpers (halo pulse, beam alpha, glint phase per slot) in `shared/view/boosts` with specs.
  → Verify: `npm run verify`; `test:only -- view`.
- [ ] **BA4. Upload.** Upload the rebuilt atlas(es), paste the ids into `packs/vale/assetIds.ts`.
  → Verify: `check:assets`; vale.spec sees every boost kind with art.
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
- **BA-P3. One fixed frame per kind** (S facing, frame 0). Variety (frame = slot or landing tick mod 8) is a later
  option; it is presentation only [BA1].
- **BA-P4. Pickup FX: the glint once at 2x plus a halo flash**; the particle burst stays the fallback [BA3].
- **BA-P5. Aura rings from `highlight_white`**: optional, after the drops are done [BA6].
- **BA-P6. HUD icons from the prop images**: optional; the three-letter labels stay the fallback [BA6].

## Risks

- **Readability**: the props are small (15 px) and dark. The halo and beam carry the colour; BA5 checks every biome,
  and `haloTiles` / `beamHeightTiles` are the knobs.
- **Gold reads as currency**: there is no gold in the game, so players may expect a counter. The toast
  (`Fury: +50% damage for 10 s`) and the gold aura say what it is; revisit in the B11 playtest.
- **Draw count**: four layers per drop (halo, prop, beam, glint), at most `DROPS.maxOnGround` = 4 drops: 16 small
  instances. Negligible, but BA5 records fps with four drops in co-op.
- **Re-upload**: removing decor gems and adding boost art changes the decor atlas; its asset id changes
  (`assetIds.ts`), as for the skeleton outline re-upload.

## Out of scope

- Sound (the four `sfx.boost.*` stay silent until the audio half of B8, Ninja Adventure Audio).
- New art from outside the Lords of Pain pack; animated drops (the props have no animation).
- Any change to drop rules, sizes in the sim, or pickup radius.
