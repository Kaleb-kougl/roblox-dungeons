# art

Source art for the theme packs. **The raw packs are not in git** (`/art/vendor` and `/art/build` are gitignored): both
licences forbid redistributing the raw files. See `THIRD_PARTY_NOTICES.md` and `docs/ART.md`.

## Getting the packs

| Folder | Pack | Download |
|---|---|---|
| `art/vendor/smallscale-knight/` | HD 8-Directional Top-Down Character Pack 1, free edition (Knight). Keep the download's layout: `Spritesheets/With shadows/*.png` | https://smallscaleint.itch.io/hd-8-directional-top-down-character-pack-1 |
| `art/vendor/lords-of-pain-demo/` | Lords Of Pain - Old School Isometric Assets (DEMO). Unzip the contents (`enemy/`, `environment/`, ...) into the folder | https://trevor-pupkin.itch.io/lords-of-pain |

`art/vendor.lock.json` lists every source file the atlas pipeline reads, with its sha256; the pipeline refuses to
run when a file is missing or different.

## Building

`npm run art:build` (see `scripts/art/build-atlases.js`): reads `art/atlases.json`, writes `art/build/*.png` (to
upload) and `art/build/contact/*.png` (to check by eye), and regenerates the layout module in
`src/shared/theme/packs/vale/`.

## Uploading (the `vale` pack)

1. `npm run art:build`, then check `art/build/contact/*.png` by eye.
2. Upload every `art/build/*.png` (not `contact/`): in Studio via View > Asset Manager > Bulk Import, or with Asphalt
   (its generated ID file must live inside `src/shared/theme/`, the only folder allowed to hold asset IDs).
3. Paste each image's ID into `src/shared/theme/packs/vale/assetIds.ts`, keyed by file name
   (`"vanguard-run.png": "rbxassetid://<digits>"`). That is the only file to edit: `packs/vale/manifest.ts` turns a
   sprite set into art once every one of its sheets has an ID, and an image once its file has one; until then the
   entry stays a placeholder. Uploading the floor texture also switches the `biome.1` floor colour to its mean colour.
4. `npm run verify` (validator, contrast checks, `check-asset-ids`).

Re-upload a PNG and paste its new ID whenever `art:build` changes it (the layout module changes with it).
