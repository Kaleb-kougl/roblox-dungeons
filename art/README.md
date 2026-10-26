# art

Source art for the theme packs. **The raw packs are not in git** (`/art/vendor` and `/art/build` are gitignored): both
licences forbid redistributing the raw files. See `THIRD_PARTY_NOTICES.md` and `docs/ART.md`.

## Getting the packs

| Folder | Pack | Download |
|---|---|---|
| `art/vendor/smallscale-knight/` | HD 8-Directional Top-Down Character Pack 1, free edition (Knight). Keep the download's layout: `Spritesheets/With shadows/*.png` | https://smallscaleint.itch.io/hd-8-directional-top-down-character-pack-1 |
| `art/vendor/lords-of-pain-demo/` | Lords Of Pain - Old School Isometric Assets (DEMO). Unzip the contents (`enemy/`, `environment/`, ...) into the folder. Still read for the skeleton, the floor texture and the user-interface images | https://trevor-pupkin.itch.io/lords-of-pain |
| `art/vendor/lords-of-pain/` | Lords Of Pain - Old School Isometric Assets, the full (paid) pack. Unzip so that `prop/`, `vfx/`, `environment/` and `Asset Index.txt` sit directly in the folder. Read for the decor props, effects and breakables (docs/DECOR.md R5) | https://trevor-pupkin.itch.io/lords-of-pain |
| `art/vendor/ninja-adventure/` | Ninja Adventure Asset Pack (CC0): only its `FX/` and `Audio/` folders, with their original layout and casing (`FX/Attack/...`, `Audio/Sounds/...`, `Audio/Musics/...`, `Audio/Jingles/...`) | https://pixel-boy.itch.io/ninja-adventure-asset-pack |

`art/vendor.lock.json` lists every source file the atlas pipeline reads, with its sha256; the pipeline refuses to
run when a file is missing or different.

## Building

`npm run art:build` (see `scripts/art/build-atlases.js`): reads `art/atlases.json`, writes `art/build/*.png` (the
atlases), `art/build/contact/*.png` (to check by eye; `decor.<piece>.png` for the world art, with its outline in cyan
and glow point in yellow) and `art/upload/*.png` (exactly the PNGs to upload, in one flat folder; `audio:build` adds its `.ogg` files there), regenerates the
layout module in `src/shared/theme/packs/vale/`, and ends by listing the files `assetIds.ts` has no ID for yet. Same
inputs, byte-identical outputs; files no longer built are removed from all three folders.

## Uploading (the `vale` pack)

1. `npm run art:build`, then check `art/build/contact/*.png` by eye.
2. Upload the files `art:build` listed as still needing an ID (or simply all of `art/upload/`, which holds every PNG
   to upload and nothing else): in Studio via View > Asset Manager > Bulk Import (select the whole `art/upload/`
   folder), or with Asphalt (its generated ID file must live inside `src/shared/theme/`, the only folder allowed to
   hold asset IDs). Files already in `assetIds.ts` are byte-identical to what was uploaded and need no new upload.
3. Paste each new image's ID into `src/shared/theme/packs/vale/assetIds.ts`, keyed by file name
   (`"decor-atlas.png": "rbxassetid://<digits>"`). That is the only file to edit: `packs/vale/manifest.ts` turns a
   sprite set into art once every one of its sheets has an ID, and an image once its file has one; until then the
   entry stays a placeholder (decor: not drawn). Uploading the floor texture also switches the `biome.1` floor colour
   to its mean colour; `decor-atlas.png` switches every decor piece, decor effect and breakable at once,
   `decor-mote.png` the biomes' ambient particles.
4. `npm run verify` (validator, contrast checks, `check-asset-ids`).

Re-upload a PNG and paste its new ID whenever `art:build` changes it (the layout module changes with it).

Sprite effects and ambient particle textures (docs/FX_AUDIO.md F2, F6; `fx` and `ambient` in `art/atlases.json`):
every `fx.*` effect lives in the one atlas `fx-effects.png` and switches on once that file has an ID; each
`fx-ambient-b<n>.png` is its own ParticleEmitter texture (a square flipbook grid) and switches on with its own ID. Their
layout is the generated `packs/vale/fxLayout.ts`; contact sheets are `contact/fx.*.png` and
`contact/decor.fx.ambient.*.png` (frames numbered).

## Audio

The sounds come from the Ninja Adventure pack's `Audio/` folder (`art/vendor/ninja-adventure/Audio/`, CC0).
`art/audio.json` maps every logical sound ID (`sfx.*`, `music.*`, `amb.*`) to its source clip(s), variants, volume,
pitch jitter, minimum interval, gain and trim; `"silent": true` leaves an ID silent. `art/audio.lock.json` lists every
clip it builds, with its sha256 (a separate lock from `vendor.lock.json`, so neither pipeline rewrites the other's).
ffmpeg and ffprobe must be on the PATH (`brew install ffmpeg`).

1. `npm run audio:audition` writes `art/audio-audition.html`: open it from `art/` and listen to each ID's pick(s) next
   to the plan's alternates (docs/FX_AUDIO.md), with each raw clip's length and loudness. Change the picks in
   `art/audio.json` and set `"confirmed": true` on each one you have settled.
2. `npm run audio:lock` after changing which clips `art/audio.json` reads (the build refuses sources that are missing
   or differ from the lock).
3. `npm run audio:build`: trims silence (sound effects and jingles), normalises loudness per category (peak for sound
   effects and jingles, two-pass LUFS for music and ambience), downmixes sound effects to mono, and writes
   `art/build/audio/*.ogg` plus `src/shared/theme/packs/vale/audioLayout.ts`. It fails if a file breaks a Roblox
   limit (20 MB, 7 minutes, 48 kHz) and ends with a loudness summary per category.

### Uploading audio

1. `npm run audio:build` also copies every `.ogg` into `art/upload/`, next to `art:build`'s PNGs, and ends by listing
   the files `assetIds.ts` has no ID for yet. So after both builds, `art/upload/` is one flat folder holding every
   image and sound to upload: select it all in one Bulk Import. Upload **as the experience's owner** (the user or
   group that owns the place), in Studio's Asset Manager (Bulk Import) or the Creator Hub. Audio uploads are **private**: only the uploader's
   experiences can play them, so uploading as someone else means granting the experience permission to each asset
   (Creator Hub > the asset > Permissions). Then wait for moderation.
2. Mind the limit: 100 audio uploads per 30 days on an unverified account, 2,000 with a verified ID. One build is
   about 55 files, so settle the picks (step 1 above) before uploading, and upload in one session.
3. Paste each ID into `src/shared/theme/packs/vale/assetIds.ts`, keyed by built file name
   (`"sfx-player-hurt.ogg": "rbxassetid://<digits>"`). A sound ID switches on only once every one of its files
   (all its variants) has an ID; until then it stays silent.
4. `npm run verify`, then check in a published test place (not just Studio) that every ID plays.

Re-upload a file and paste its new ID whenever `audio:build` changes it.
