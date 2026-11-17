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

## HD 8-Directional Top-Down Character Pack 1 (paid edition: Archer)

- Author: SmallScaleInt. Source: https://smallscaleint.itch.io/hd-8-directional-top-down-character-pack-1 (the paid
  edition, "2D HD Character pack 1 V1.2": all 9 characters, with-shadows and shadowless sheets, individual sprites;
  bought by the owner, docs/ARCHER.md owner answers 7 and 10)
- Used for: `class.ranger` sprites, the Archer (folder `2Archer`, the individual with-shadow sprites: idle, run, roll,
  hit, death, the bow's stream and charged shot; docs/ARCHER.md AR12), repacked into atlases with a 1 px outline sheet
  each by `scripts/art/build-atlases.js` (`--only class.ranger`), to be uploaded to Roblox
- Raw files: `art/vendor/smallscale-archer/` (gitignored, not redistributed)
- License: SmallScaleInt's "Standard Commercial License" (owner answer 10, 2026-11-09): use in unlimited commercial or
  personal game projects; no attribution or credit required; modify, recolor and re-export freely for your own
  project; cannot resell, redistribute or sublicense the raw asset files themselves; not for use on stock-asset or
  asset-pack resale platforms. The store asks for a rating and review.

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
- Used for: `enemy.bruiser` (Demon Beast 3, docs/DEMON_ART.md) and `boss.act1` (Mother Mayhem as Demon Elite 3,
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

## "Retro Coin 4" (Pixabay sound effect)

- Author: Driken Stan (driken5482). Source: Pixabay (https://pixabay.com/sound-effects/, id 236671; credited by the
  owner as "Sound Effect by Driken Stan from Pixabay"), downloaded by the owner as `driken5482-retro-coin-4-236671.mp3`
  (0.18 s, 44.1 kHz mono MP3).
- Used for: `sfx.boost.drop`, a boost landing on the floor (docs/BOOSTS.md): silence-trimmed, peak-normalised and
  encoded to OGG by `scripts/audio/build-audio.js`.
- Raw file: `art/vendor/pixabay/` (gitignored, not redistributed).
- License: Pixabay Content License (https://pixabay.com/service/license-summary/): free for commercial and
  non-commercial use, no attribution required, modification allowed; the content may not be sold or distributed on
  its own (unmodified, as a standalone file), which is why the raw file is kept out of the repo.

## "Pick up sfx" (Pixabay sound effect)

- Author: freesound_community. Source: Pixabay (https://pixabay.com/sound-effects/, id 38516; credited by the owner as
  "Sound Effect by freesound_community from Pixabay"), downloaded by the owner as
  `freesound_community-pick-up-sfx-38516.mp3` (3.21 s, 44.1 kHz mono MP3; kept as
  `freesound-community-pick-up-sfx-38516.mp3`).
- Used for: `sfx.boost.collect`, a boost picked up (docs/BOOSTS.md): silence-trimmed, peak-normalised and encoded to
  OGG by `scripts/audio/build-audio.js`.
- Raw file: `art/vendor/pixabay/` (gitignored, not redistributed).
- License: Pixabay Content License (https://pixabay.com/service/license-summary/): free for commercial and
  non-commercial use, no attribution required, modification allowed; the content may not be sold or distributed on
  its own (unmodified, as a standalone file), which is why the raw file is kept out of the repo.

## "Power down 02" (Pixabay sound effect)

- Author: freesound_community. Source: Pixabay (https://pixabay.com/sound-effects/, id 82200; credited by the owner as
  "Sound Effect by freesound_community from Pixabay"), downloaded by the owner as
  `freesound_community-power-down-02-82200.mp3` (3.98 s, 24 kHz stereo MP3; kept as
  `freesound-community-power-down-02-82200.mp3`).
- Used for: `sfx.boost.expire`, a boost running out (docs/BOOSTS.md): silence-trimmed, downmixed to mono,
  peak-normalised and encoded to OGG by `scripts/audio/build-audio.js`.
- Raw file: `art/vendor/pixabay/` (gitignored, not redistributed).
- License: Pixabay Content License (https://pixabay.com/service/license-summary/): free for commercial and
  non-commercial use, no attribution required, modification allowed; the content may not be sold or distributed on
  its own (unmodified, as a standalone file), which is why the raw file is kept out of the repo.

## "Plate Break 1" (Pixabay sound effect)

- Author: freesound_community. Source: Pixabay (https://pixabay.com/sound-effects/, id 36468; credited by the owner as
  "Sound Effect by freesound_community from Pixabay"), downloaded by the owner as
  `freesound_community-plate-break-1-36468.mp3` (2.26 s, 24 kHz stereo MP3; kept as
  `freesound-community-plate-break-1-36468.mp3`).
- Used for: `sfx.boost.aegisbreak`, the Aegis pip breaking (docs/BOOSTS.md): silence-trimmed, downmixed to mono,
  peak-normalised and encoded to OGG by `scripts/audio/build-audio.js`.
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

## 16Bit Bullets, missiles, Explosions & Misc Asset Pack ("Player Bullets")

- "16Bit Bullets, missiles, Explosions & Misc Asset Pack - Shooter/RPG/Any 2D Genre - Pixel Art" by **J i m** (itch.io
  `jinvorionstg`). Source: https://jinvorionstg.itch.io/bullet-asset-pack-top-down-or-shmup-classic-bullet-hell-style
  (published 2025-08-28). The page offers two downloads; the file used is `Player Bullets.rar` (6 kB, the free
  name-your-own-price download: 10 PNGs in `Player Bullets/`). The paid `BulletPack.rar` is not held.
- Used for: every flying projectile (`bullet.player.*`, `bullet.enemy.*`; docs/PROJECTILE_ART.md): the yellow / green
  bolts and the Hyper flame for the player's shots, the chevron, needle and teardrops for enemy bullets. Cut, cropped
  and packed into one atlas (`bullets.png`) by `scripts/art/build-atlases.js` and uploaded to Roblox. **Modified:** the
  enemy bullets are recoloured (a gradient map into the danger pink), and the Hyper flame and the plain yellow bolt
  are shifted slightly towards gold.
- Raw files: `art/vendor/player-bullets/` (gitignored, not redistributed: redistribution is not addressed).
- Terms: the page has no licence field. The author's only statement is a reply in the page's comments, posted about
  9 months before 2026-11-05 (read that day), to "what are the terms of your assets? for commercial use?": "You can
  use them however you want, even for commercial use." The page does not require credit; the pack is credited anyway
  (the main menu's Credits screen, shared/view/menu `CREDITS`). A screenshot of the comment kept beside the vendor
  files, or a written licence from the author (the contact address on the page), would be stronger evidence.

## Free Slimes Asset Pack ("Slime")

- "Free Slimes Asset Pack" by **heimlich3** (itch.io). Source: https://heimlich3.itch.io/slime.
- Used for: the Ooze's goo puddles (`bullet.enemy.goo`, docs/GOO_ART.md): two frames of the slime's strip, the
  flattened blob as the puddle landing and the spread splat as the puddle, cut and packed into `goo.png` by
  `scripts/art/build-atlases.js` and uploaded to Roblox. **Modified:** cropped and recoloured (a gradient map into the
  goo colour `enemyGoo`, the black outline kept).
- Raw files: `art/vendor/Free Slimes Asset Pack/` (gitignored, never committed or shared: redistribution is
  prohibited).
- Terms (the pack page, as written):
  "You can use this asset in any game project, personal and commercial. / Modification is allowed. / Redistribution,
  resell, NFTs and AI use are PROHIBITED. / Credits is not required but appreciated."
- The owner confirmed with the author that "AI use" means training AI on the art: the port's normal workflow (the
  atlas pipeline, the recolour, an assistant helping build it) is not AI use. Never put the pack's files into any AI
  training set. Credit is not required; the pack is credited anyway (the main menu's Credits screen, shared/view/menu
  `CREDITS`).

## Kenney Isometric Library and Isometric Dungeon (2D art, CC0)

- Author: Kenney (https://www.kenney.nl). Packs: "Isometric Library" and "Dungeon Pack" 2.3 ("Isometric Dungeon"),
  each with its `License.txt` (Creative Commons Zero, CC0 1.0: http://creativecommons.org/publicdomain/zero/1.0/).
- Used for: docs/KENNEY_DECOR.md. From the Isometric Library: the bookcase's alternative art set
  (`decor.delve.b<n>.bookcase.3` .. `.16`) and its wide cases (`bookcaseWide`), the study tables, display cases,
  lecterns, the toppled case, the library's carpet runner (`carpet.5` .. `.10`) and candle stands (`libraryCandle`).
  From the Isometric Dungeon: the floor patches (planks, dirt), the dining tables, the barrel stacks, crate stacks,
  lumber piles, lying barrels and the stockpile (its barrels under the wooden supports). The solid pieces and the runner
  share one sheet, `kenney-decor.png` (docs/KENNEY_DECOR.md KN9).
  **Changes made:** reprojected from Kenney's 30 degree camera to the game's 55 degree camera by
  `scripts/art/kenney/reproject.py` (per-face affine warps), baked shadows removed, scaled down, colour graded; packed
  by `scripts/art/build-atlases.js` and uploaded to Roblox.
- Raw files: `art/vendor/kenney-library/`, `art/vendor/kenney-dungeon/` (the packs' `Isometric/` folders and licences)
  and the renders in `art/vendor/kenney/` (all gitignored, like every pack, though CC0 would allow committing them).
- License: CC0, public domain: no restriction and no credit required. Credited anyway (the main menu's Credits screen,
  shared/view/menu `CREDITS`: "Isometric Library, Isometric Dungeon", "by Kenney (kenney.nl)", "CC0").

## Training Dummy 2D Pixel Art

- "Training Dummy 2D Pixel Art" (the download's folder name). **Author and store page: not in the download; to be
  confirmed by the owner** (an itch.io search on 2026-11-06 did not find this pack).
- Used for: the tutorial's training dummy (`enemy.dummy`, docs/DUMMY_ART.md): the idle frame, the 7-frame hit wobble
  and the 9-frame break, packed into `dummy.png` (+ its outline rim) by `scripts/art/build-atlases.js` and uploaded to
  Roblox. **Modified:** cropped, repacked into one column, and a generated 2 px outline rim added.
- Raw files: `art/vendor/training-dummy/` (gitignored, never committed or shared: redistribution as a game asset is
  prohibited).
- Terms (`License.txt`, as written): "You can use this asset in any game project, personal or commercial. / DO NOT
  resell or redistribute AS A GAME ASSET, it has to be part of a project. / Credit is not required but it is
  appreciated. / Modify to suit your needs. / You are NOT allowed to turn any of my assets to an NFT."
- Credit is not required; add it to the Credits screen (shared/view/menu `CREDITS`) once the author is known.

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

## Music Jingles (audio, CC0)

- Author: Kenney (kenney.nl). Source: https://kenney.nl/assets/music-jingles; downloaded 2026-11-12 from Kenney's own
  OpenGameArt upload, https://opengameart.org/node/22000 ("85 Short music jingles", `jingleSounds_Kenney.zip`).
- Used for: the floor modifier stings `sfx.floor.modifier.hoard` / `.plunder` (docs/FLOOR_MODIFIERS.md FM10), built by
  `scripts/audio/build-audio.js`.
- Raw files: `art/vendor/kenney-music-jingles/` (gitignored, like the other packs).
- License: Creative Commons Zero (CC0 1.0), per the pack's `license.txt`: "Credit (Kenney or www.kenney.nl) would be
  nice but is not mandatory." Listed on the Credits screen anyway.

## Level up, power up, Coin get (13 Sounds) (audio, CC0)

- Author: wobbleboxx (WobbleBoxx Workshop). Source: https://opengameart.org/content/level-up-power-up-coin-get-13-sounds
  (`SoundPack01.zip`, downloaded 2026-11-12).
- Used for: the floor modifier stings `sfx.floor.modifier.gilded` / `.feast` (docs/FLOOR_MODIFIERS.md FM10).
- Raw files: `art/vendor/wobbleboxx-soundpack01/` (the zip's 13 `.aif` files; gitignored).
- License: CC0 (public domain), per the page: credit not required ("WobbleBoxx Workshop" suggested). Listed on the
  Credits screen anyway.

## Horror Stinger Sound Effects (audio) by DHSFX - ATTRIBUTION REQUIRED

- Author: DHSFX (Dafydd Harvey). Source: https://dhsfx.itch.io/horror-stinger-sound-effects (free, name your own
  price; downloaded 2026-11-12: `Low Bell.wav`, `Very Low Bell.wav`, `Trombone Low Note.wav`).
- Used for: the floor modifier sting `sfx.floor.modifier.bloodmoon` (docs/FLOOR_MODIFIERS.md FM10), cut to 2.2 s with a
  fade by `scripts/audio/build-audio.js` (modified).
- Raw files: `art/vendor/dhsfx-horror-stingers/` (gitignored, never redistributed).
- License: NOT Creative Commons. The author's terms (the store page and the "License?" thread,
  https://itch.io/t/1600351/license, read 2026-11-12): free to use in your own game, integrated in the game and heard
  only when it runs; never redistribute or repost the raw files (keep the uploaded Roblox audio private, never on the
  Creator Store); credit the author with a reference to their SoundCloud profile, https://soundcloud.com/dhsfx, in the
  published game: the Credits screen does (`CREDITS`, shared/view/menu credits.ts).

## "Fire Loop" (OpenGameArt sound effect, CC-BY 3.0) - ATTRIBUTION REQUIRED

- "Fire Loop" by qubodup. Source: https://opengameart.org/content/fire-loop (`qubodupFireLoop.ogg`).
- Used for: the molten biome's ambience bed `amb.b2`. **Changes made:** downmixed, loudness-normalised (EBU R128) and
  re-encoded to OGG by `scripts/audio/build-audio.js`; only the built OGG is uploaded to Roblox as an audio asset.
- Raw file: `art/vendor/oga-fire-loop/` (gitignored).
- License: Creative Commons Attribution 3.0 Unported (https://creativecommons.org/licenses/by/3.0/).
  **Attribution is required where players can see it**: the main menu's Credits screen (shared/view/menu `CREDITS`)
  shows the title, "by qubodup (OpenGameArt)", "CC BY 3.0 - creativecommons.org/licenses/by/3.0" and the change note.

## Kenney Impact Sounds (audio, CC0)

- Author: Kenney (https://www.kenney.nl). Pack: "Impact Sounds" 1.0, with its `License.txt` (Creative Commons Zero,
  CC0 1.0: http://creativecommons.org/publicdomain/zero/1.0/).
- Used for: `sfx.build.execute`, `sfx.build.pin`, `sfx.build.slam` (three variants), `sfx.build.smash`,
  `sfx.treasure.crack`; the candidate for `sfx.enemy.healcut` (`impactGlass_light_001`, docs/NEW_ENEMIES_3.md NT10, to be
  confirmed at the audition). The clips are silence-trimmed where they are effects, downmixed to mono, loudness-normalised and encoded to OGG by
  `scripts/audio/build-audio.js`; only the built OGGs are uploaded to Roblox as audio assets (docs/FX_AUDIO.md "Sourcing the
  remaining silent IDs").
- Raw files: `art/vendor/kenney-impact-sounds/` (gitignored).
- License: CC0, public domain: no restriction and no credit required. Credited anyway (Credits screen: "Impact
  Sounds", "by Kenney (kenney.nl)", "CC0").

## Kenney Interface Sounds (audio, CC0)

- Author: Kenney (https://www.kenney.nl). Pack: "Interface Sounds" 1.0 (https://kenney.nl/assets/interface-sounds), taken
  from Hugo Locurcio's lossless WAV repackaging (https://github.com/Calinou/kenney-interface-sounds @ `4596a49`, the
  pack's own LICENSE.txt included).
- Used for: the Silver sounds `sfx.silver.gain` (`pluck_001`), `sfx.shop.buy` (`maximize_007`) and `sfx.shop.deny`
  (`error_008`) (docs/SILVER.md; sourced and picked at the audition 2026-11-14), and the candidate for `sfx.enemy.lob`
  (`pluck_002`, docs/NEW_ENEMIES_3.md NT10, to be confirmed at the audition). The clips are silence-trimmed,
  downmixed to mono, loudness-normalised and encoded to OGG by `scripts/audio/build-audio.js`; only the built OGGs are
  uploaded to Roblox as audio assets.
- Raw files: `art/vendor/kenney-interface-sounds/` (gitignored).
- License: CC0, public domain: no credit required. Credited anyway (Credits screen: "Interface Sounds", "by Kenney
  (kenney.nl)", "CC0").

## "Their Coming (generic horn sound)" (OpenGameArt sound effect, CC0)

- Author: StumpyStrust. Source: https://opengameart.org/content/their-coming-generic-horn-sound (`theircoming3.ogg`).
- Used for: `sfx.horde.horn`. The clip is silence-trimmed where they are effects, downmixed to mono, loudness-normalised and encoded to OGG by
  `scripts/audio/build-audio.js`; only the built OGGs are uploaded to Roblox as audio assets (docs/FX_AUDIO.md "Sourcing the
  remaining silent IDs").
- Raw file: `art/vendor/oga-horn/` (gitignored).
- License: CC0, public domain: no credit required. Credited anyway (Credits screen).

## "open chest SFX" (OpenGameArt sound effect, CC0)

- Author: Oiboo. Source: https://opengameart.org/content/open-chest-sfx (`open chest.wav`, kept as `open-chest.wav`).
- Used for: `sfx.treasure.open`. The clip is silence-trimmed where they are effects, downmixed to mono, loudness-normalised and encoded to OGG by
  `scripts/audio/build-audio.js`; only the built OGGs are uploaded to Roblox as audio assets (docs/FX_AUDIO.md "Sourcing the
  remaining silent IDs").
- Raw file: `art/vendor/oga-open-chest/` (gitignored).
- License: CC0, public domain: no credit required. Credited anyway (Credits screen).

## "Breaking Rock" (OpenGameArt sound effect, CC0)

- Author: themightyglider. Source: https://opengameart.org/node/109952 (`rock_break.ogg`), itself derived from "stone
  falls and breaks low pitch.aiff" by SoundCollectah, Freesound, CC0 (https://freesound.org/s/109360).
- Used for: the candidate for `sfx.secret.open` (docs/SECRET_ROOMS.md SR14; owner's source pick 2026-11-13, to be
  confirmed at the audition). Once picked, the clip is silence-trimmed, downmixed to mono, loudness-normalised and
  encoded to OGG by `scripts/audio/build-audio.js`; only the built OGG is uploaded to Roblox as an audio asset.
- Raw file: `art/vendor/oga-breaking-rock/` (gitignored).
- License: CC0, public domain: no credit required. Credited anyway (Credits screen).

## "Chain winch sounds" (OpenGameArt sound effect, CC0)

- Author: bart (Bart Kelsey). Source: https://opengameart.org/content/chain-winch-sounds (`winch.zip`, 9 WAVs).
- Used for: the candidates for `sfx.enemy.hooklatch` and an alternate for `sfx.enemy.hook` (docs/NEW_ENEMIES_2.md NX10;
  owner's source pick 2026-11-14, to be confirmed at the audition). **Changes made:** a short slice trimmed and faded,
  downmixed to mono, loudness-normalised and encoded to OGG by `scripts/audio/build-audio.js`; only the built OGG is
  uploaded to Roblox as an audio asset.
- Raw files: `art/vendor/oga-chain-winch/` (gitignored).
- License: CC0, public domain: no credit required ("Credit appreciated"). Credited (Credits screen).

## "80 CC0 creature SFX" (OpenGameArt sound effects, CC0)

- Author: rubberduck. Source: https://opengameart.org/content/80-cc0-creature-sfx (`80-CC0-creature-SFX.zip`, 80 OGGs).
- Used for: the candidates for `sfx.enemy.snatch` (the `eat_*` clips) and `sfx.enemy.swallow` (`burble_*` / `burp_*`)
  (docs/NEW_ENEMIES_2.md NX10; owner's source pick 2026-11-14, to be confirmed at the audition), and for
  `sfx.enemy.lunge` (`roar_01`) with alternates for it and for `sfx.enemy.spooked` (`troll_01`, `monster_03`,
  `grunt_03`; `hurt_02`, `hurt_04`, `cute_03`) (docs/NEW_ENEMIES_3.md NT10, to be confirmed at the audition). The clips are
  silence-trimmed, downmixed to mono, loudness-normalised and encoded to OGG by `scripts/audio/build-audio.js`; only the
  built OGGs are uploaded to Roblox as audio assets.
- Raw files: `art/vendor/oga-creature-sfx/` (gitignored).
- License: CC0, public domain: no credit required. Credited anyway (Credits screen).

## 8-Bit Sound Effects Library (audio) by Little Robot Sound Factory (CC-BY 3.0) - ATTRIBUTION REQUIRED

- Author: Little Robot Sound Factory (www.littlerobotsoundfactory.com). Source:
  https://opengameart.org/content/8-bit-sound-effects-library (`8-Bit Sound Library.zip`, 40 sounds in WAV and MP3;
  the WAVs kept).
- Used for: the candidates for the secret-room discovery jingle `sfx.jingle.secret` (docs/SECRET_ROOMS.md SR14;
  owner's source pick 2026-11-13: `Jingle_Achievement_00` / `_01`, `Jingle_Win_00` / `_01`, one picked at the
  audition), and the Silver crate clink `sfx.silver.crate` (`Collect_Point_02`, docs/SILVER.md, picked at the audition
  2026-11-14). **Changes made:** silence-trimmed, downmixed to mono, loudness-normalised (EBU R128) and re-encoded to OGG
  by `scripts/audio/build-audio.js`; only the built OGG is uploaded to Roblox as an audio asset.
- Raw files: `art/vendor/lrsf-8bit/Wav/` (gitignored).
- License: Creative Commons Attribution 3.0 Unported (https://creativecommons.org/licenses/by/3.0/). The author's
  notice: "Attribute Little Robot Sound Factory, and provide this link where possible: www.littlerobotsoundfactory.com".
  **Attribution is required where players can see it**: the main menu's Credits screen (shared/view/menu `CREDITS`)
  shows the title, "by Little Robot Sound Factory (www.littlerobotsoundfactory.com)", "CC BY 3.0 -
  creativecommons.org/licenses/by/3.0" and the change note.

## Robux icon (Roblox Corporation)

- Owner: Roblox Corporation. "Robux" and the Robux icon are Roblox's trademarks.
- Used for: the Robux icon beside the prices on the Get Silver panel (`ui.icon.robux`, docs/SILVER_SHOP.md "Robux
  icon"), where Roblox expects experiences to show Robux prices. Taken from Roblox's own client content
  (`content/textures/ui/common/robux@3x.png` in the Roblox Studio install), resized to a 14 x 14 white glyph by
  `scripts/art/roblox/prep_robux_icon.py` and uploaded to Roblox as a ui image; never redrawn or altered beyond the
  resize.
- Raw file: `art/vendor/roblox/` (gitignored: not redistributed here).
