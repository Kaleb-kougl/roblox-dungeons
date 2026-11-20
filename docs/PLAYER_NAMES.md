# Co-op name tags

In a party run it is hard to tell which knight is whom. This adds each teammate's display name just above their
character, with an Options toggle. It is **presentation only**: nothing touches `src/shared/sim/**`, the dungeon,
lockstep, a replay, a hash or the score.

## Status (2026-11-19)

PN1-PN3 are code-complete and verified headlessly (typecheck, lint, the settings / HUD / view specs under Lune).
**Nothing has run in Studio.** Open: PN4 (the Studio check, two clients).

## Decisions

- **PND1. On the floor, not a billboard.** A BillboardGui over the head draws in front of everything behind the player
  on screen (bullets, telegraph rings), because the head is nearer the camera than the floor there. The tag is instead
  a floor text on the combo shout's layer (`fxHelpers floorTextTopStuds`, the PARRY! / SYNC! construction): under every
  bullet, telegraph, marking, effect and body, so it loses every overlap and can never hide a threat. Laid
  screen-up of the feet by the body's height / sin(pitch), it reads as sitting just above the head.
- **PND2. Who.** Party runs only (solo and the tutorial never draw one). Every living teammate except the watched
  player: never yourself, and while spectating not the teammate you watch (the spectate bar already names them). A
  dead or departed teammate has none.
- **PND3. A wall in the way.** A far wall or the void between the feet and the tag would stand in front of it (its
  face rises up the screen). While any cell of that strip, across the tag's width, is not open floor (FLOOR or POOL),
  the tag moves below the feet instead (`nameTagAboveClear`); the wanted side must hold 0.3 s before it moves, so it
  never flickers along a wall's end.
- **PND4. Quiet look.** `uiText` on the dark `background` stroke, at most 60 % opaque, 30 % within 3 tiles of the
  watched player (you know who is next to you), easing to 12 % while an enemy bullet is in its box grown by 0.75 tile
  (the floor shouts' duck rule). One fixed letter height (about a third of a tile), the name font, truncated with
  an ellipsis at the 4-tile box, so a long name never grows.
- **PND5. Default On.** Options > Display > Player names (`DisplaySettings.playerNames`, only Off stored, settings
  doc stays v2; the Display Reset drops it).

## As built

- **PN1. Rules** (`shared/view/nameTags.ts`, tunables `NAME_TAGS` in `nameTagsConfig.ts`): `nameTagShown`,
  `nameTagOffsetTiles` / `nameTagCentre`, `nameTagAboveClear`, `nameTagDucked`, `nameTagNear`, `nameTagCanvasSize` /
  `nameTagTextSize`, and `NameTagLook` (side hold and fade). Spec `nameTags.spec.ts`.
- **PN2. Setting.** `DEFAULT_PLAYER_NAMES` (`shared/settings/config.ts`), `DisplaySettings.playerNames`, the Options
  row (order 7 on the Display tab, after Player outline), string `options.display.playerNames` ("Player names", with
  its `l10n/context.json` entry).
- **PN3. Renderer** (`client/controllers/fx/NameTagController.ts`, an FxTracker frame handler). One tag per player
  index, built on first use under Workspace `KV_NameTags`: a thin invisible Part turned by `FLOOR_CANVAS_YAW` with a
  Top-face SurfaceGui (FixedSize canvas, LightInfluence 0) and one TextLabel. Names are `RunContext.memberNames` (the
  Player's DisplayName). Hidden under the stage cover, after run over, on a run start / exit, with no run and in solo.
  The setting is read through a store subscription, never per frame.

## Tasks

- [x] **PN1. Rules.** → Verify: `nameTags.spec.ts`.
- [x] **PN2. Setting and string.** → Verify: `settings.spec.ts`, `hud.spec.ts`, `npm run l10n:check`.
- [x] **PN3. Renderer.** → Verify: typecheck, lint.
- [ ] **PN4. Studio check (two clients).** The tag reads just above each teammate's head (Knight and Archer), not over
  your own character; it sits under bullets and telegraphs; it moves below the feet against a far wall and back
  without flicker; it dims near you and under enemy fire; it goes on death, on spectating that teammate, under the
  stage cover and at run over; Options > Display > Player names Off removes it at once; a 20-character name truncates
  inside the box; the Display tab still fits on a small laptop screen (it gained a row).
