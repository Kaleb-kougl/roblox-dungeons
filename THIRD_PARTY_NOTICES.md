# Third-party notices

## Dungeon Forge

- Source: https://github.com/majidmanzarpour/threejs-procedural-dungeon
- Used in: `src/shared/dungeon/forge/` (roblox-ts port of the generator, via project-kaleb-vale's TypeScript port)
- License: MIT

MIT License

Copyright (c) 2026 Majid Manzarpour

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## @k9kbdev/r3f-projectiles 0.6.0

- Source: https://github.com/Kaleb-Kougl/r3f-projectiles (author: Kaleb Kougl, the owner of this project)
- Used in: `src/shared/sim/combat/bullets.ts`, `src/shared/sim/combat/projectilePatterns.ts` (ported portions)
- License: **unresolved.** The package's `package.json` and README declare MIT, but the LICENSE file shipped in the
  0.6.0 package contains the GNU GPL v3 text. The author needs to reconcile this upstream; update this entry with
  the full text of whichever license applies.

## HD 8-Directional Top-Down Character Pack 1 (free edition: Knight)

- Author: SmallScaleInt. Source: https://smallscaleint.itch.io/hd-8-directional-top-down-character-pack-1
- Used for: `class.vanguard` sprites (repacked atlases built by `scripts/art/build-atlases.js`, uploaded to Roblox)
- Raw files: `art/vendor/smallscale-knight/` (gitignored, not redistributed)
- License: "Standard Commercial License" (store page, read 2026-10-25): use in unlimited commercial or personal game
  projects; no attribution or credit required; modify, recolor and re-export freely for your own project; cannot
  resell, redistribute or sublicense the raw asset files themselves; not for use on stock-asset or asset-pack resale
  platforms. The author confirms in the page comments that shipping the art in a compiled game is allowed.

## Lords Of Pain - Old School Isometric Assets (full pack, and its DEMO)

- Author: Pupkin Assets (Trevor Pupkin). Source: https://trevor-pupkin.itch.io/lords-of-pain
- Used for: the decor props, decor effects and breakables (`decor.*`, `breakable.*`: columns, wall segments, the
  brazier and its lit loop, the wall torch, rubble, bones, mushrooms, gemstones, the flame / fire / glow / glint / zone
  effects, barrels and crates with their break loops; docs/DECOR.md R5), plus `enemy.swarmer` (skeleton),
  `enemy.sniper` (the subservient, docs/SNIPER_ART.md; the tutorial's `turret.sniper` draws it too), `enemy.slime` (the slime, docs/ENEMY_VARIANTS.md EV10; `slime.small` draws it smaller), the biome 1
  floor texture, the player ring and the relic pedestal beam. All of it is repacked into atlases by
  `scripts/art/build-atlases.js` (cropped, recombined, the ambient particle texture downscaled and recoloured) and
  uploaded to Roblox.
- Raw files: `art/vendor/lords-of-pain/` (the full pack, bought 2026-10-25; its `prop/`, `vfx/`, `environment/`
  `none-playable character/subservient/` and `enemy/slime/` folders) and `art/vendor/lords-of-pain-demo/` (the free demo, still read
  for the skeleton, the floor texture and the user-interface images: this copy of the full pack has no `enemy/` or
  `user interface/` folder). Both gitignored, not redistributed.
- License (`Licence.txt` in both packs, the same text): "This asset pack can be used in both free and commercial
  projects. You can modify it to suit your own needs. You may not redistribute or resell it." The store page adds
  "even if modified".

## Ninja Adventure Asset Pack (FX and Audio folders)

- Authors: Pixel-boy (art) and AAA (audio). Source: https://pixel-boy.itch.io/ninja-adventure-asset-pack
- Used for: sprite effects (`fx.*`, decor ambient particle textures) and audio (`sfx.*`, `music.*`, `amb.*`), built
  by `scripts/art/build-atlases.js` and `scripts/audio/build-audio.js`, uploaded to Roblox (docs/FX_AUDIO.md)
- Raw files: `art/vendor/ninja-adventure/FX/` and `art/vendor/ninja-adventure/Audio/` (gitignored, like the other
  packs; the licence would allow committing them, but they are 96 MB)
- License: Creative Commons Zero (CC0 1.0, public domain dedication), per the store page (read 2026-10-26).
  Attribution is not required but appreciated: "Ninja Adventure by Pixel-boy and AAA". The copy in this repo came
  without a licence file and holds 41 music tracks where the store page lists 25 (a newer version): confirm the
  download it came from before release (docs/FX_AUDIO.md X0).

## 2D Demons - TopDown asset pack v1.1 ("Top-down Demons", 2D Demons - 8-Directional Character Sprite Pack)

- Author: SmallScaleInt. Source: https://smallscaleint.itch.io/top-down-demons (paid pack; download
  `2D Demons - TopDown assetpack v1.1.zip`). 34 characters (13 Demon Spawns, 10 Imps, 6 Demon Elites, 5 Demon
  Beasts), 8 directions, 128x128 cells, separate shadow and effect sheets.
- Used for: `enemy.bruiser` (Demon Beast 3, docs/DEMON_ART.md) and `boss.act1` (Mother Bramble as Demon Elite 3,
  docs/BRAMBLE_ART.md): the body sheets over their `Shadows/` sheets (`Effects/` not used), cropped and repacked into
  atlases with a baked outline by `scripts/art/build-atlases.js`, and uploaded to Roblox (2026-10-26, ids in
  `src/shared/theme/packs/vale/assetIds.ts`). Also `enemy.sprayer` (Demon Spawn 8) and `enemy.caster` (Demon Spawn 11,
  docs/DEMON_ART.md Phase 2), built the same way (their baked staff glow cut out); uploaded 2026-10-30.
- Raw files: `art/vendor/demons-topdown/` (gitignored, not redistributed).
- License (store page, "Standard Commercial License", recorded 2026-10-26): "Use in unlimited commercial or personal
  game projects"; "No attribution or credit required"; "Modify, recolor, and re-export freely for your own project";
  "Cannot resell, redistribute, or sublicense the raw asset files themselves"; "Not for use in stock-asset or
  asset-pack resale platforms". The downloaded copy has no licence file of its own.

## "Glass breaking" (Pixabay sound effect)

- Author: DRAGON-STUDIO. Source: Pixabay (https://pixabay.com/sound-effects/, search "glass breaking dragon-studio";
  id 504033), downloaded by the owner as `dragon-studio-glass-breaking-504033.mp3` (3.12 s, 48 kHz stereo MP3).
- Used for: `sfx.combo.break`, the combo's break during a fight (docs/COMBO.md CD12): trimmed to its first 1.2 s,
  silence-trimmed, downmixed to mono, peak-normalised and encoded to OGG by `scripts/audio/build-audio.js`; only that
  built OGG is uploaded to Roblox as an audio asset.
- Raw file: `art/vendor/pixabay/` (gitignored, not redistributed).
- License: Pixabay Content License (https://pixabay.com/service/license-summary/): free for commercial and
  non-commercial use, no attribution required, modification allowed; the content may not be sold or distributed on
  its own (unmodified, as a standalone file), which is why the raw file is kept out of the repo.

## "Lightning strike" (Pixabay sound effect)

- Author: DRAGON-STUDIO. Source: Pixabay (https://pixabay.com/sound-effects/, id 386161; credited by the owner as
  "Sound Effect by DRAGON-STUDIO from Pixabay"), downloaded by the owner as
  `dragon-studio-lightning-strike-386161.mp3` (1.10 s, 44.1 kHz stereo MP3).
- Used for: `sfx.enemy.strike`, the Stormcaller's lightning strike (docs/NEW_ENEMIES.md NE10): silence-trimmed,
  downmixed to mono, peak-normalised and encoded to OGG by `scripts/audio/build-audio.js`; only that built OGG is
  uploaded to Roblox as an audio asset.
- Raw file: `art/vendor/pixabay/` (gitignored, not redistributed).
- License: Pixabay Content License (https://pixabay.com/service/license-summary/): free for commercial and
  non-commercial use, no attribution required, modification allowed; the content may not be sold or distributed on
  its own (unmodified, as a standalone file), which is why the raw file is kept out of the repo.

## "Chomp" (Pixabay sound effect)

- Author: Barnaby (cryptologymedia). Source: Pixabay (https://pixabay.com/sound-effects/, id 155392; credited by the
  owner as "Sound Effect by Barnaby from Pixabay"), downloaded by the owner as `cryptologymedia-chomp-155392.mp3`
  (0.99 s, 44.1 kHz mono MP3).
- Used for: `sfx.pellet.eat`, a pellet eaten (docs/PELLETS.md PL7): the first bite trimmed out, peak-normalised and
  encoded to OGG by `scripts/audio/build-audio.js`.
- Raw file: `art/vendor/pixabay/` (gitignored, not redistributed).
- License: Pixabay Content License (https://pixabay.com/service/license-summary/): free for commercial and
  non-commercial use, no attribution required, modification allowed; the content may not be sold or distributed on
  its own (unmodified, as a standalone file), which is why the raw file is kept out of the repo.

## "Swish swoosh woosh SFX 27" (Pixabay sound effect)

- Author: Stereogenic Studio. Source: Pixabay (https://pixabay.com/sound-effects/, id 357164; credited by the owner as
  "Sound Effect by Stereogenic Studio from Pixabay"), downloaded by the owner as
  `stereogenicstudio-swish-swoosh-woosh-sfx-27-357164.mp3` (5.33 s, 48 kHz stereo MP3).
- Used for: `sfx.pellet.sweep`, a room swept (docs/PELLETS.md PL7): trimmed to its first 1.2 s, silence-trimmed,
  downmixed to mono, peak-normalised and encoded to OGG by `scripts/audio/build-audio.js`.
- Raw file: `art/vendor/pixabay/` (gitignored, not redistributed).
- License: Pixabay Content License (https://pixabay.com/service/license-summary/): free for commercial and
  non-commercial use, no attribution required, modification allowed; the content may not be sold or distributed on
  its own (unmodified, as a standalone file), which is why the raw file is kept out of the repo.

## "Power up 01a" (Pixabay sound effect)

- Author: EdR. Source: Pixabay (https://pixabay.com/sound-effects/, id 484722; credited by the owner as "Sound Effect
  by EdR from Pixabay"), downloaded by the owner as `edr-power-up-01a-484722.mp3` (1.04 s, 44.1 kHz mono MP3).
- Used for: `sfx.pellet.power`, the power pellet taken (docs/PELLETS.md PL7): silence-trimmed, peak-normalised and
  encoded to OGG by `scripts/audio/build-audio.js`.
- Raw file: `art/vendor/pixabay/` (gitignored, not redistributed).
- License: Pixabay Content License (https://pixabay.com/service/license-summary/): free for commercial and
  non-commercial use, no attribution required, modification allowed; the content may not be sold or distributed on
  its own (unmodified, as a standalone file), which is why the raw file is kept out of the repo.

## UI User Interface Pack - Horror

- Author: ToffeeCraft. Source: https://toffeecraft.itch.io/ui-user-interface-pack-horror ("a 32x32 pixel horror UI
  pack": panels, buttons, skulls, candles, bones, eyes, potions, icons, a pixel font; name your own price). Two
  downloads: `FreeHorrorUi.png.zip` (free) and `UiHorror.png.zip` ($1.80 or more); the build reads the paid file, the
  one sheet `UiHorror.png` (1024x607 RGBA). The owner holds the paid tier (2026-10-30).
- Used for: the boon draft cards (docs/DRAFT_REVEAL.md DR3): the card back (`ui.draft.back` and its eye-socket mask
  `ui.draft.back.eyes`), the common and rare faces (`ui.draft.card.common` / `.rare`) and the legendary face's two
  red-eyed skulls (`ui.draft.skull.left` / `.right`), cut from the sheet (cropped, the panel fill flattened, the
  skulls cut out of the menu panel, the mask derived) by `scripts/art/build-atlases.js`; only those built images are
  uploaded to Roblox. The three `boon.*` colour roles take the sheet's colours.
- Raw file: `art/vendor/toffeecraft-horror-ui/UiHorror.png` (gitignored, not redistributed).
- License (store page, recorded 2026-10-30): **Free License** "For personal use. - It can be used and edit freely. -
  Not redistribute or resell this assets. - It can be used for game development and other productions."; **Paid
  License** "For commercial or personal use." with the same other terms. No attribution required. A published Roblox
  experience is not personal use, so the build uses the paid file under the Paid License.

## Dungeon Essential Kit (3D models, CC-BY 4.0) - ATTRIBUTION REQUIRED

- Author: Rakshaan (https://sketchfab.com/rakshaan). Source:
  https://sketchfab.com/3d-models/dungeon-essential-kit-b22fc89609b44d21961f1212286e1867 (`dungeon_essential_kit.glb`,
  glTF from Sketchfab; author, licence and source as recorded in the file's `asset.extras`).
- Used for: the trial 3D kit decor (docs/DECOR.md "3D kits"): the floor cage (`decor.void.b<n>.cage.1` / `.2`) and the
  chains (`decor.void.b<n>.chains.1` / `.2`, and `decor.delve.b<n>.bones.4`), the candle chandelier lying fallen in
  rooms (`decor.delve.b<n>.chandelier`, its chain removed), and the bookcase (`decor.delve.b<n>.bookcase.1` / `.2`,
docs/BOOKSHELVES.md). **Changes made:** rendered to 2D sprites
  from the game camera by `scripts/art/kit/render_kit.py` (Blender), scaled down, colour graded, the chains flattened
  to lie on the floor; the renders are packed by `scripts/art/build-atlases.js` and uploaded to Roblox.
- Raw files: `art/vendor/dungeon-essential-kit/` (gitignored; the .glb and its renders).
- License: Creative Commons Attribution 4.0 International (https://creativecommons.org/licenses/by/4.0/). Commercial
  use and changes are allowed. **Attribution is required where players can see it**: the main menu's Credits screen
  (shared/view/menu `CREDITS`) shows the title, "by Rakshaan (Sketchfab)", "CC BY 4.0 -
  creativecommons.org/licenses/by/4.0" and the change note. Every work in this file is listed there; keep both in step.

## Dungeon Modular Set V2 (3D models, CC-BY 4.0) - ATTRIBUTION REQUIRED

- Author: C. Anastasiadis (https://sketchfab.com/bagatir). Source:
  https://sketchfab.com/3d-models/dungeon-modular-set-v2-174d66bb2ba6434b91da333aa055dc77
  (`dungeon_modular_set_v2.glb`, glTF from Sketchfab; author, licence and source as recorded in its `asset.extras`).
- Used for: the second trial 3D kit (docs/DECOR.md "3D kits"): the sarcophagus (`decor.delve.b<n>.sarco`), the candle
  stand with its candles (`decor.delve.b<n>.candle` and the solid `decor.delve.b<n>.candelabrum`), the wall banner
  (`decor.delve.b<n>.banner`) and the sarcophagus again as the solid tomb (`decor.delve.b<n>.tomb.1` / `.2`). **Changes
  made:** rendered to 2D sprites from the game camera by `scripts/art/kit/render_kit.py` (Blender), scaled down and
  colour graded; packed by `scripts/art/build-atlases.js` and uploaded to Roblox.
- Raw files: `art/vendor/dungeon-modular-set-v2/` (gitignored; the .glb and its renders).
- License: Creative Commons Attribution 4.0 International (https://creativecommons.org/licenses/by/4.0/).
  **Attribution is required where players can see it**: the main menu's Credits screen (shared/view/menu `CREDITS`)
  shows the title, "by C. Anastasiadis (Sketchfab)", "CC BY 4.0 - creativecommons.org/licenses/by/4.0" and the change
  note.

## Dungeon Assets Pack (3D models) by zver.3d

- Author: zver.3d (ArtStation https://www.artstation.com/zver; Telegram https://t.me/zver3d; Instagram @zver.3d).
  Source: "Dungeon Assets Pack by zver.3d" v1.0.0 (FBX models and 4k TGA textures, downloaded as
  `Models+++Textures+(FBX+++TGA+4k)`; the pack names ArtStation and Telegram as the author's channels, the exact
  download page was not recorded).
- Used for: the reading area of library rooms: the table (`kit-table-x` / `-z`, along X / Z, on a 2 x 1 footprint)
  and the chair (`kit-chair-px` / `-pz` / `-nx` / `-nz`, facing +X / +Z / -X / -Z), the table dressed with the
  pack's fabric stack (as a pile of pages) and round candlestick. **Changes made:** converted to one .glb by
  `scripts/art/kit/zver_to_glb.py` (Blender: materials built from the pack's textures, reduced to 1024 px, the fabric
  stack decimated and halved in size), then rendered to 2D sprites from the game camera by
  `scripts/art/kit/render_kit.py` (`scripts/art/kit/zver-dungeon-assets.json`: props moved onto the table, scaled
  down, colour graded); packed by `scripts/art/build-atlases.js` and uploaded to Roblox.
- Raw files: `art/vendor/zver-dungeon-assets/` (gitignored; the .glb, its renders and `SOURCE.txt`; the FBX / TGA pack
  itself is not kept in the repo).
- Terms (the pack's "TERMS OF USE", as written): "This package can be used in video games and other projects. A big
  request to indicate the authorship of the assets "zver.3d". You also don't have to do this, but please let me know
  if you are using my kit in a commercial project." Credited on the main menu's Credits screen (shared/view/menu
  `CREDITS`: "Dungeon Assets Pack", "by zver.3d", the terms line and the change note).

## Old Chest (3D model, CC-BY 4.0) - ATTRIBUTION REQUIRED

- "Old Chest" (https://skfb.ly/6CWsK) by SebastianSosnowski (https://sketchfab.com/SebastianSosnowski). Source:
  https://sketchfab.com/3d-models/old-chest-d280b6c1a64d4fd2a1872e232ea1581a (`old_chest.glb`, glTF from Sketchfab;
  author, licence and source as recorded in its `asset.extras`).
- Used for: the vault chest (docs/TREASURE.md TR9): `treasure.chest` (closed) and `treasure.chestopen` (open), four
  facings each. **Changes made:** rendered to 2D sprites from the game camera by `scripts/art/kit/render_kit.py`
  (Blender), scaled, colour graded, and for the open chest cut at the lid line with the lid turned open on its back edge
  and the box hollowed (`scripts/art/kit/old-chest.json`); packed by `scripts/art/build-atlases.js` and uploaded to Roblox.
- Raw files: `art/vendor/old-chest/` (gitignored; the .glb and its renders).
- License: Creative Commons Attribution 4.0 International (https://creativecommons.org/licenses/by/4.0/).
  **Attribution is required where players can see it**: the main menu's Credits screen (shared/view/menu `CREDITS`)
  shows the title, "by SebastianSosnowski (Sketchfab)", "CC BY 4.0 - creativecommons.org/licenses/by/4.0" and the
  change note.
