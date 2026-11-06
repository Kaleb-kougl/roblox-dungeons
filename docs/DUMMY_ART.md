# Training dummy art

`enemy.dummy` (the tutorial's training dummy, docs/TUTORIAL.md T3: combat A's two targets) is still the placeholder
post. This plan draws it with the **Training Dummy 2D Pixel Art** pack: a wooden post with a target on its chest that
rocks when struck and bursts apart when broken. Work it task by task, like `docs/ART.md`; each task ends with a
**Verify**. **Presentation only:** nothing touches `src/shared/sim/**`, `src/shared/dungeon/**`, a replay hash, a
fixture or the tutorial's timings. The dummy keeps its 8 hp, r 0.35 body and default corpse time.

## Status (2026-11-06, branch `dummy-art`)

DA1-DA6 done: both sheets uploaded 2026-11-06 12:09 PM (`assetIds.ts`), so the bundled vale pack draws the dummy.
**Open:** DA7 (the Studio check) and the Credits row (author to confirm).

## The art (measured 2026-11-06)

`art/vendor/training-dummy/` (gitignored): `Sprites/IDLE.png` 80x48, `HIT.png` 560x48, `BREAKING.png` 720x48,
`preview.gif`, `License.txt`. One row per strip of **80x48 cells**, one facing (a front view), hard alpha (0 / 255),
no baked shadow; mostly browns (`#8a4836`, `#bf6f4a`, `#5d2c28`) with the red / white target.

| Strip | Frames | What it shows |
|---|---|---|
| IDLE | 1 | standing, arms out |
| HIT | 7 | 0 a white silhouette (the flash), 1-3 it rocks with yellow sparks, 4-6 it settles |
| BREAKING | 9 | 0 white, 1-5 the top half bursts off, 6-8 the pieces lie on the floor beside the standing base |

The pack's preview plays at 100 ms a frame, so the hit is a **0.7 s** wobble.

## Licence (License.txt, as written)

"You can use this asset in any game project, personal or commercial. DO NOT resell or redistribute AS A GAME ASSET,
it has to be part of a project. Credit is not required but it is appreciated. Modify to suit your needs. You are NOT
allowed to turn any of my assets to an NFT."

So the raw files stay in gitignored `art/vendor/training-dummy/` and are never committed; the built `dummy.png` goes
to Roblox only as part of the game. **The author and store page are not in the download** (an itch.io search on
2026-11-06 found other dummy packs, none with these files): the owner to confirm them, then add the Credits row (DA6).

## What the code gives us

| Fact | Where | Consequence |
|---|---|---|
| The dummy never moves, turns or attacks; contact damage 0; 8 hp; default corpse 30 ticks (0.5 s) | `archetypes/dummy.ts` | One facing is enough; move / attack are idle stand-ins; the break plays over 0.5 s |
| A multi-frame `hit` plays stretched over the sim's hit flash, `HIT_FLASH_TICKS` = 6 (0.1 s) | `sprites.ts` `chooseActorAnim` | 7 frames in 0.1 s would flick past: the view needs its own hit timer (DD1) |
| `HitReactSlots` already tracks every hit per slot on the view clock (`hitNow`, paused with the game) | `shared/view/fx/hitReact.ts` | It can time the wobble: `hitAge` |
| `SPRITE_FACING_COUNTS` includes 1; `facingIndex` returns 0 for one facing; `resample` `Pixelated` exists | `contract.ts`, `sprites.ts` | No contract change |
| Every enemy set carries the 2 px `enemyOutline` rim | `docs/OUTLINE.md`, `vale.spec` | `outline: { widthPx: 2 }`, pad 3 |

## Decisions

- **DD1. Full wobble on the view clock (owner, 2026-11-06).** `HitReactSlots.hitAge(slot, id, now)` gives the seconds
  since the last hit (every hit, not limited by the rim flash's `minSec`). For archetypes in
  `VIEW_HIT_CLIP_SEC` (only `dummy`, `DUMMY_SPRITE_VIEW.hitSec` 0.7) the renderer passes
  `ActorSpriteInput.hitClip = { elapsed, total }`, and `chooseActorAnim` stretches `hit` over it instead of over the
  flash; outside the clip no hit plays even while the flash runs. Each new hit restarts it from the white frame, so a
  bow stream (every 0.2 s) shows flash-and-jolt repeatedly. Death still beats it.
- **DD2. One facing, every frame kept.** 1 + 7 + 9 = 17 cells; move and attack reuse idle's cell.
- **DD3. Size: bodyTiles 1.4.** The 39 px idle body at 27.9 px/tile: a little under the knight's 1.5 tiles; the plank
  base (21 px) is 0.75 tiles, about the r 0.35 hitbox; the arms 1.15 tiles.
- **DD4. Pixelated resample, the pack's own colours.** Hard-edged pixel art; the rim carries the contrast on dark
  floors, as for every enemy.
- **DD5. The death is the break, over the corpse time.** `deathCorpseFraction` 1: the 9 frames over 0.5 s while the
  corpse fades; the fade may hide the last (lying) frames. If Studio shows that, a view-side `corpseFadeFrom` for the
  dummy (as the Demon Lord's) is the next step; the sim's corpse time stays.

## Architecture (as built)

1. **Atlas.** `art/atlases.json` `spriteSets["enemy.dummy"]`: grid source `training-dummy/Sprites` 80x48,
   `facingCount` 1, `rowForFacing` [0], noise 0, pad 3, pivot measured on idle (bodyAlpha 0, bodyMinRgb 0, footBand 2),
   2 px rim, bodyTiles 1.4, `Pixelated`; one sheet `dummy` (idle, hit, death). Output: cells 62x50, pivot (39, 47),
   27.9 px/tile, `dummy.png` 62x850 (one column of 17 cells) + `dummy-outline.png`; `packs/vale/layout.ts` gains only
   the `enemy.dummy` entry (every other entry byte-identical).
2. **Sprite input.** `shared/view/dummy/sprite.ts` `dummySpriteInput` (never attacks, speed 0), registered in
   `ACTOR_SPRITE_INPUTS` by file (sprites.luau sits near Luau's 200 top-level locals), like the Goldling.
3. **Hit clip.** `shared/view/dummy/config.ts` (`DUMMY_SPRITE_VIEW`, `VIEW_HIT_CLIP_SEC`), `HitReactSlots.hitAt` /
   `hitAge`, `ActorSpriteInput.hitClip`, the `chooseActorAnim` rule; `ActorRenderController` stores `hitClipSec` per
   sprite view at acquire and adds the clip before choosing the animation.
4. **The vale pack.** Nothing to hand-write: `VALE_SPRITE_LAYOUTS` drives `manifest.ts`; the set switches on once
   `dummy.png` has an id.

## Tasks

- [x] **DA1. Lock the files.** The pack in `art/vendor/training-dummy/`; its three strips in `art/vendor.lock.json`;
  `THIRD_PARTY_NOTICES.md` entry. → Verify: `git status` shows no PNGs.
- [x] **DA2. The `enemy.dummy` set** (Architecture 1). → Verify: `layout.ts` gains exactly the entry; the contact sheet
  (`art/build/contact/enemy.dummy.png`) shows every frame upright, rimmed, the pivot on the base.
- [x] **DA3. Sprite input** (Architecture 2). → Verify: `shared/view/dummy/dummy.spec.ts`.
- [x] **DA4. View-side hit clip** (Architecture 3). → Verify: `dummy.spec.ts` (the white frame at 0, frame 3 at half,
  idle at the end and outside the clip with the flash on, death first, no flinch / 1-frame hit skip it, the flash rule
  unchanged without a clip) and `hitReact.spec.ts` (`hitAge`: every hit, capped counts, kills don't, other ids and new
  actors never hit).
- [x] **DA5. Upload.** (uploaded 2026-11-06 12:09 PM, ids in `assetIds.ts`.) `dummy.png` and `dummy-outline.png` (`art/upload/`); paste both ids into `assetIds.ts` with the
  upload note. → Verify: `npm run verify` (the `vale enemy.dummy` "as bundled" case then expects `sprites`).
- [x] **DA6. Docs.** This file, `docs/ART.md` (slice table), `CLAUDE.md` document table, `THIRD_PARTY_NOTICES.md`.
  **Open:** the Credits row (`shared/view/menu/credits.ts`) once the author is known.
- [ ] **DA7. Studio check** (after DA5). The tutorial's combat A, PC and the phone emulator:
  - size and feet against the hitbox (hitbox debug view); the post stands on the floor without a shadow;
  - a sword combo: the wobble plays whole after each swing and restarts on the next; the 40 ms hit hold (FEEL J4)
    shows the pre-hit frame first; a bow stream reads (white flash + jolt) rather than strobes;
  - the finisher: the white frame, the burst, the pieces; does the 0.5 s fade hide the end (DD5)?
  - the rim on the darkest tutorial floor; pixel edges crisp (Pixelated).
  → Verify: the owner signs off DD1 and DD5.

## Verify as run (2026-11-06)

The full `npm run art:build` could not run: the shared `art/vendor/player-bullets/*.png` were re-saved on 2026-11-06
01:33 (C2PA metadata and re-encoded pixels), so they no longer match the lock, and the build needs ~3 GB the VM did not
have. The set was built through a scratch driver that runs the pipeline's own `buildSpriteSet` / `buildImages` /
`buildWorldPieces` / `layoutModule` one set at a time; `layout.ts` came out identical except the new entry, which
shows nothing else moved. The rest ran in a clean x86 checkout of the branch (the VM was also out of memory for
`rbxtsc`): typecheck, lint, `check:assets`, `check:autolocalize`, `test:art`, `test:checks`, `test:l10n` and the
`rbxtsc` build all pass; Lune: every suite under `shared/view` (135 suites, 1930 tests) and under `shared/theme`,
`shared/play`, `shared/tutorial`, `shared/run`, `shared/onboarding`, `shared/lockstep`, `shared/l10n` and
`shared/sim/pacts` (111 suites, 1361 tests) pass. The `shared/sim` / `shared/dungeon` suites were not all run (nothing
there changed; the first 18 dungeon suites passed but the known x86 `forge.spec.ts` seedToState vector).
