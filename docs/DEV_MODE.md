# Developer mode

Jump to any endless floor, restart instantly with R, and turn off damage. A local practice run that is never sent to
the server, shown only to players the server allows.

## Using it

1. Play in Studio (everyone is allowed there), or join the published game as an allowed player (below).
2. A small **DEV** chip sits on the left edge. Click / tap it or press **F2** to open the panel.
3. Pick a floor (-5 / - / type / + / +5, floors 1-50; boss floors are marked), optionally a seed (New rolls one), and
   god mode, then **Go to floor N**.
4. In the dev run: **R** (or Restart / Again) restarts the same seed and floor at once, keeping god mode as it is now.
   Outside a dev run R only acts once the run is over (the run-over panel's Again); mid-run, playing or paused, it does
   nothing (`shared/play` `driverKeyAction`, `RestartWindow`), so a stray press never forfeits a ranked run.
   **F3** (or the panel's button) flips god mode mid-run. Leave run returns to the menu (no forfeit).

The chip shows `DEV · F<n> · GOD` during a dev run. The run is not paused while the panel is open. Studio shortcuts:
`workspace:SetAttribute("KV_DevPanel", true)` opens the panel on join; `KV_Seed` sets the panel's first seed.

## Who gets it

`shared/config` `DEV_MODE` (server-decided by `DevModeService` via `shared/devmode` `devModeAllowed`):

| Setting | Meaning |
|---|---|
| `enabled` | Master switch. `false`: nobody, Studio included. Flip it off to ship without dev mode. |
| (Studio) | Every player in Studio is allowed. |
| `allowedUserIds` | UserIds allowed on live servers. Add yours here (your profile URL has it). |
| `allowPlaceCreator` | The place's creator is allowed on live servers when the game is user-owned (not a group). |

Allowed players get the player attribute `KV_DevAllowed = true` from the server; the client mounts the chip, panel and
keys only then. Nothing exists for anyone else (no GUI, no input listener).

**Why a forged attribute is harmless.** A client can set the attribute on itself (it does not replicate), but that only
unlocks a local practice run: the `dev` world is in `SERVER_REFUSED_WORLDS` (no run session can start in it), the client
never submits a dev run (`unsubmittedReason` -> `dev`), and a forged submission would be replayed by the server in its
own world (floor 1, no god mode, `DEV_GOD_BUTTON` flagged as a debug bit) and fail.

## How it works

- **World `dev`** (`shared/run` `dev.ts`, `buildDevRunConfig`): the endless run of the seed, plus
  `endless.startFloor` / `startDepth` and `dev: { invulnerable }`. Floor N of a dev run on seed S is floor N of the
  endless run on seed S. Depth is 1 + the boss floors below N (as if every boss was killed); no boons yet. Solo only.
- **Sim, opt-in** (`shared/sim`): `EndlessConfig.startFloor` / `startDepth` (absent: floor 1 / Depth 1, exactly as
  before); `SimConfig.dev` creates `state.dev` (`invulnerable`, `blockedHits`, `toggles`), hashed as the `dev` group
  appended after `affixes` (only `builds`, docs/BUILDS.md, comes after it). While `invulnerable` is 1, `damagePlayer`
  lands nothing (no armor, hearts, hit event, i-frames, on-hit hooks or death). A `DEV_GOD_BUTTON` (65536, a port bit
  in `PORT_BUTTONS`) press edge toggles it; the client pulses it for one stepped frame, so the toggle is recorded and
  F8's replay check still matches.
- **Client**: `SimController.startDev` / `toggleGodMode` / `isDevRun` / `getGodMode`; `RunContext.dev`;
  `DevModeController` + `client/ui/dev` `DevPanel`. Panel look and dev-only English text: `DEV_PANEL_VIEW` (not in the
  theme packs: only developers see it, and the theme contract sits at Luau's local limit).

No fixture, M1, tutorial, endless or co-op run changes: none of them sets `startFloor` or `dev`. `SIM_BUTTONS` grows by
the new bit (the codec accepts it; the co-op relay strips it and validation flags it, like the other debug bits).

## Notes

- F2 / F3 are not reserved keys: if you bind a game action to them, both fire (only for allowed players).
- Specs: `src/shared/run/dev.spec.ts` (world, start floor, Depth, god mode, hash group, access rule).
