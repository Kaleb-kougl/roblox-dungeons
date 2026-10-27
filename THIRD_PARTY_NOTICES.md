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
  `enemy.sniper` (the subservient, docs/SNIPER_ART.md; the tutorial's `turret.sniper` draws it too), the biome 1
  floor texture, the player ring and the relic pedestal beam. All of it is repacked into atlases by
  `scripts/art/build-atlases.js` (cropped, recombined, the ambient particle texture downscaled and recoloured) and
  uploaded to Roblox.
- Raw files: `art/vendor/lords-of-pain/` (the full pack, bought 2026-10-25; its `prop/`, `vfx/`, `environment/`
  and `none-playable character/subservient/` folders) and `art/vendor/lords-of-pain-demo/` (the free demo, still read
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
  `src/shared/theme/packs/vale/assetIds.ts`).
- Raw files: `art/vendor/demons-topdown/` (gitignored, not redistributed).
- License (store page, "Standard Commercial License", recorded 2026-10-26): "Use in unlimited commercial or personal
  game projects"; "No attribution or credit required"; "Modify, recolor, and re-export freely for your own project";
  "Cannot resell, redistribute, or sublicense the raw asset files themselves"; "Not for use in stock-asset or
  asset-pack resale platforms". The downloaded copy has no licence file of its own.
