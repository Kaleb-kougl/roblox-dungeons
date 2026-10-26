# Co-op spectating: plan

When a player dies in a co-op party run, they **watch a living teammate** and can **switch between the ones still
alive**, until the floor change brings them back (or the party is wiped). Work it task by task, like `PLAN.md` and
`docs/OUTLINE.md`; each task ends with a **Verify**.

It is **presentation only**: nothing touches `src/shared/sim/**`, `src/shared/dungeon/**`, the lockstep wire, the
server or a replay hash. Every client already steps the whole party sim (M4 lockstep), so every teammate's state is
already on this client. Spectating only changes **whose player the views follow**.

## Status (2026-10-26)

S0-S5 are **code-complete and verified headlessly only**: typecheck, lint, `check:assets`, `test:art` and the full
Lune suite (1814 / 1815 on x86; the one failure is the known x86-only `forge.spec` "EncounterRng seedToState
vectors"). Nothing under `src/shared/sim`, `dungeon`, `lockstep`, `src/server` or `fixtures` changed. **Nothing has
run in Studio.** Open: S6 (the Studio smoke test below, the playtest pass).

### As built (differs from the text below; the code is authoritative)

- **S0 findings.** Dead players' input does reach two hashed fields (`prevButtons` in `stepPlayer` / `stepWeapons`),
  so sending EMPTY_INPUT while dead changes the state hash; it cannot desync (every client and the server step the
  same merged log). A dead player can never have an open draft (drafts open on the floor-change tick, after the
  revive), so "the dead take nothing" never applies to a co-op death. There is no `{act:...}` token / `formatPrompt`
  system: hints come from `shared/play/bindings.ts` helpers. Decor fades, the torch sweep and room reveal are
  party-wide; `DecorFxController` reads the camera focus, so it follows the watched player by itself.
- **Tracker** `shared/view/spectate.ts` (`spectateCandidates`, `nearestCandidate`, `cycleCandidate`,
  `spectateCommand`, `SpectateTracker`); tunables `SPECTATE` live in `shared/view/spectateConfig.ts` (not config.ts):
  `holdOnDeathSec` 1.5, `maxHoldDtSec` 0.25 (a hitch counts at most this much of a hold), `glideTauSec` 0.3,
  `glideSettleSec` 0.9 (the glide ends on time, not distance: a damped follow of a moving target never gets within a
  fixed distance), `snapBeyondTiles` 12. `SpectateView` gained `holding`; `active` is false during the hold on your
  own corpse and true during the hold on a watched teammate's. `update` returns one reused object.
- **Snapshot**: `SnapshotExtras.vitalsIndex` (hearts, armor, flask, Embers, weapons, active set) and `spectate`
  (`spectating`, `spectateName`, `spectatePosition`, `spectateCount`); passed only while the run is not over, so the
  bar never shows beside the run-over panel.
- **SimController**: the tracker and `memberNames` (DisplayName at run start, fallback `#<userId>` as in the lobby)
  in `RunContext`; raw buttons are copied before `CoopMenuInputGate.apply`; the gate runs with `menuOpen || dead`, then
  the debug bits (K, J, N) are put back while dead outside a menu (KV_Debug only; InputController strips them
  otherwise), so a dead tester can still skip a floor. The switch is ignored while a menu owns the controls or while
  a mouse press began over a GUI (`InputController.mousePressOnGui()`, from InputBegan's `gameProcessedEvent`), so
  clicking the pause button does not switch. `getViewPlayerIndex()` / `getSpectateView()`.
- **Views** following the view index: camera (snap beyond `snapBeyondTiles` or under reduced motion, else a timed
  glide), weapon view, bullet transparency, the actor ring colour, audio. `AudioWatch.readLocal` takes a fresh
  baseline when the index changes, so a switch never plays a stale shot / full-charge cue.
- **HUD** `ui/hud/SpectateBar.tsx` (fades in; instant under reduced motion), helpers in `shared/view/hud/spectate.ts`,
  `spectateHint(bindings)` in `shared/play/bindings.ts`. Strings (placeholder manifest; vale inherits):
  `hud.spectate.watching`, `hud.spectate.watchingName` (no `pos / count`, during a hold or a wipe), `hud.spectate.hint`
  (hidden during a hold and with fewer than 2 candidates), `hud.spectate.back`.

## What the code gives us (checked against `main` @ `4834215`)

| Fact | Where | Consequence |
|---|---|---|
| A dead party member "stays dead (spectating) for the rest of the floor"; at the floor change every dead player who has not left comes back at the entrance; the run ends when everyone is dead at once (`isPartyWiped`) | `shared/sim/party.ts` header | A spectate session runs from your death to the next floor change or the wipe. No sim change is needed |
| Every client steps the full party sim from the server's merged frames (`LockstepClient`), and `playerAt(state, i)` reads any player | `SimController.coopFrame`, `shared/sim/party.ts` | Watching player *i* is reading `playerAt(state, i)` instead of the local index. No new data on the wire |
| A dead player's client must keep stepping and reporting hashes, or the server drops it as **stalled** | `shared/lockstep/config.ts`, `RunSessionService.stepLockstep` (`r.dropped`) | Spectating never stops or slows the lockstep client. It sits only in the views |
| `party.left[i]` = 1 once a member left (Leave run or left the server): dead and never revived | `party.ts` `hasLeft` | Left players are never watch targets |
| Dead players' inputs never act (`p.dead !== 0` returns early), and the dead never take a boon (an open draft is closed without a pick) | `shared/sim/step.ts` | Attack / Alt are free to drive the switch while dead. The spectator never has a draft to fight with |
| Every view that is "about me" reads `SimController.getLocalPlayerIndex()`: `CameraController`, `WeaponViewController`, `BulletRenderController` (large-party transparency), `ActorRenderController` (local ring colour), `AudioController` (the cue mapper's per-player split), and the HUD snapshot (`takeSnapshot` `playerIndex`) | grep of `getLocalPlayerIndex` / `localIndex` | One new "view index" replaces the local index in exactly these places. Everything that is *yours* (lockstep input, `collectRunEvents` toasts, draft, shrine hint, boons / relics / curses, the run-over panel) keeps the local index |
| `PartyRunStart.members` is the UserIds in player index order | `shared/network.ts` | Names for the bar come from it at run start |
| `CoopMenuInputGate` sends EMPTY_INPUT while a menu owns the controls and masks buttons held when it closes until they are released | `shared/lockstep/menuInput.ts` | Reused while spectating: the spectator sends neutral input, and the click that was held when you are revived does not fire on the first tick |
| HUD hints come from bindings through action tokens (`{act:fire}`), never hard-coded keys | menu-lobby plan L4b, `shared/play/bindings.ts` | The bar's hint follows the player's own Attack / Alt bindings and glyphs |

## Player experience

1. **You die.** Your character falls as now (death animation, sound, freeze-frame). After
   `SPECTATE.holdOnDeathSec` (1.5 s) the camera **glides to the living teammate nearest to your corpse**.
2. A **spectate bar** sits bottom centre:
   `Spectating <Name>  ·  2 / 3` and below it `<Attack> next · <Alt> previous` (your bindings, your device's glyphs)
   and `You're back on the next floor`.
3. **Switching**: Attack (left click / RT) moves to the next living teammate, Alt (right click / LT) to the previous
   one, in party order, wrapping around and skipping the dead and the left. With only one teammate alive the hint
   hides and presses do nothing.
4. **The HUD shows the watched player's vitals**: hearts, armor, flask, Embers and weapons. The watched player's
   ring takes the "local" ring colour, their weapon visuals (swing fans, guard, charge) are drawn, their bullets stay
   opaque in large parties, and their sounds play at full volume (the others at the teammate level, as for any
   teammate today). Your boons / relics / curses row, your toasts and the shrine hint stay yours.
5. **The teammate you watch dies.** You see it (the same hold), then the camera moves to the living teammate nearest
   to them.
6. **The floor ends.** At the floor change you are revived at the entrance with everyone; the camera snaps back to
   you and the bar goes away. Buttons held at that moment stay masked until released.
7. **The party is wiped.** The camera stays on the last player you watched; the run-over panel takes over as now.
8. **Menus while spectating**: the pause key still opens the party overlay (Leave run, Options, Leaderboards). While
   a menu owns the controls, clicks do not switch. Leave run while spectating works as today (back to the lobby).

Solo runs and the tutorial never spectate (no party state).

## Architecture

### 1. Pure tracker: `shared/view/spectate.ts` (headless-tested)

```ts
export interface SpectateView {
	/** The player index the views follow: the local index while alive, else the watched teammate. */
	readonly viewIndex: number;
	/** true while the local player is dead and watching someone else. */
	readonly active: boolean;
	/** 1-based position of viewIndex among the living candidates, and their count (for "2 / 3"). */
	readonly position: number;
	readonly count: number;
}

export type SpectateCommand = "next" | "previous" | undefined;

/** Living, present teammates (not the local player) in party index order. */
export function spectateCandidates(state: Readonly<SimState>, localIndex: number): number[];

/** The living candidate nearest (squared distance) to (x, z), ties to the lower index; undefined when none. */
export function nearestCandidate(state: Readonly<SimState>, localIndex: number, x: number, z: number): number | undefined;

export class SpectateTracker {
	constructor(localIndex: number);
	/** One rendered frame: `dt` in seconds (client clock is fine, nothing here reaches the sim), `cmd` the switch press. */
	update(state: Readonly<SimState>, dt: number, cmd: SpectateCommand): SpectateView;
	/** Floor change / run start: back to the local player, no hold. */
	reset(): void;
}
```

Rules, all in `update`:

- Solo (`partySize` 1) or the local player alive: `viewIndex` = local, `active` false. Coming back to life ends
  spectating at once.
- The local player just died: hold on the local corpse for `holdOnDeathSec`, then `nearestCandidate` to the corpse.
- The watched player dies or leaves: hold on them for `holdOnDeathSec`, then the nearest candidate to them.
- `next` / `previous`: the next / previous candidate after `viewIndex` in index order, wrapping. Ignored during a
  hold, with no candidates, or with one.
- Nobody alive (wipe): keep the last `viewIndex`.
- `SpectateCommand` comes from a pure `spectateCommand(prev: InputFrame, cur: InputFrame)`: a FIRE rising edge is
  `next`, an ALT rising edge `previous` (both at once: `next`).

Tunables in a `SPECTATE` block in `shared/view/config.ts`: `holdOnDeathSec` (1.5), `glideTauSec` (camera damping
while switching, shorter than `GAME_CAMERA.followTauSec`), `snapBeyondTiles` (a target farther than this is snapped
to, not glided to: no long pans across walls), `teammateVolume` if the audio split needs it (X4 already has a level).

### 2. Client wiring

| Piece | Change |
|---|---|
| `SimController` | `RunContext` gains `spectate: SpectateTracker` (co-op only) and `memberNames: string[]` (from `PartyRunStart.members` at `startCoop`: the player's `DisplayName`, fallback `Player <n>`). `coopFrame`: sample input, compute `spectateCommand` from the raw frame (ignored while a menu owns the controls), `tracker.update(...)` after the step, and gate the sent input with `coopMenuGate.apply(menuOpen \|\| view.active, ...)`. `onFloorChanged` / run start call `reset()`. New `getViewPlayerIndex()` (falls back to `getLocalPlayerIndex()`) and `getSpectateView()`. No new controller, so no dependency cycle (the views already depend on `SimController`) |
| `CameraController` | Follows `getViewPlayerIndex()`. On a change of view index: snap when farther than `snapBeyondTiles` or under reduced motion (`motionScale` 0), else glide with `glideTauSec` until it settles |
| `WeaponViewController`, `BulletRenderController`, `ActorRenderController` (ring colour) | `getLocalPlayerIndex()` -> `getViewPlayerIndex()` |
| `AudioController` / `shared/view/audio` cue mapper | The per-player split takes the view index (the watched player's sounds at full volume). The local player's own death cue still plays: the switch happens after the hold |
| `takeSnapshot` (`shared/play/snapshot.ts`) | New `SnapshotExtras.vitalsIndex` (default `playerIndex`): hearts, armor, flask, Embers, weapons and `activeSet` read it. Draft, boons / relics / curses, toasts and `atShrine` keep `playerIndex`. New snapshot fields `spectating`, `spectateName`, `spectatePosition`, `spectateCount` (and `snapshotsEqual`) |
| `ui/hud/SpectateBar.tsx` (new, mounted by `GameHud`) | Bottom centre while `spectating`: the name line, the hint (`formatPrompt` with `{act:fire}` / `{act:alt}`; hidden when count < 2), the "back on the next floor" line. Theme strings and roles only, `useHudScale`, `motionScale` for the fade |
| Theme strings (placeholder manifest and every pack that has strings) | `hud.spectate.watching` (`Spectating {name}  ·  {pos} / {count}`), `hud.spectate.hint` (`{next} next · {previous} previous`), `hud.spectate.back` (`You're back on the next floor`). `hud.spec.ts`'s token check covers them |

### 3. What does not change

The sim, the dungeon, the lockstep client / session / wire, `RunSessionService`, validation, leaderboards, fixtures
and hashes. A dead client sends EMPTY_INPUT instead of whatever it pressed; dead players' input never acts, and every
client steps the same merged log anyway, so this cannot desync. Leave run still goes to the lobby.

## Tasks

- [x] **S0. Confirm the assumptions.** Read `step.ts`'s per-player loop and `stepEndless`'s floor change for any
  read of a dead player's input (aim, draft selection) that EMPTY_INPUT would change; confirm the X4 audio split's
  teammate level; confirm a co-op death's draft handling matches the forfeit path. → Verify: every row of "What the
  code gives us" is confirmed or this plan is edited.
- [x] **S1. Tracker.** `shared/view/spectate.ts` (`spectateCandidates`, `nearestCandidate`, `spectateCommand`,
  `SpectateTracker`), the `SPECTATE` block, barrel export. → Verify: `spectate.spec.ts` on hand-built party states:
  solo never spectates; alive = local; death -> hold -> nearest to the corpse (ties to the lower index); next /
  previous wrap and skip the dead and the left; presses ignored during a hold and with one candidate; the watched
  player's death -> hold -> nearest to them; revive ends spectating at once; wipe keeps the last index; both edges in
  one frame = next; held buttons give one edge.
- [x] **S2. Snapshot.** `vitalsIndex` and the spectate fields in `takeSnapshot` / `snapshotsEqual`. → Verify:
  `snapshot.spec.ts`: vitals and weapons come from `vitalsIndex`, draft / items / shrine from `playerIndex`; omitting
  `vitalsIndex` gives today's snapshot exactly.
- [x] **S3. SimController + input gate.** Tracker in `RunContext`, member names, the command from the raw frame, the
  gated input, `getViewPlayerIndex()` / `getSpectateView()`, reset on floor change / run start. → Verify: `npm run
  verify` (no fixture or hash spec changes); `git diff --stat src/shared/sim src/shared/dungeon src/shared/lockstep
  src/server` is empty.
- [x] **S4. (code-complete; Studio check pending) Views.** Camera follow / glide / snap, weapon view, bullet transparency, ring colour, audio split. →
  Verify: Studio "Clients and Servers", 3 players, `KV_Debug` (K to take hits): die and watch the camera move to the
  nearest teammate after the hold; their swings, ring and sounds follow them.
- [x] **S5. (code-complete; Studio check pending) HUD.** `SpectateBar`, strings in every pack, snapshot fields wired through the store. → Verify:
  `hud.spec.ts` token check passes; in Studio, the bar shows the right name and `n / m`, the hint uses rebound keys
  (rebind Attack to another key and check), the vitals are the watched player's, your boon row is yours.
- [ ] **S6. Playtest pass** (the Studio smoke test below, plus gamepad only, reduced motion on, a 2-player run where
  the only teammate dies, a 4-player run cycling through everyone). Add a "Co-op spectating" section to
  `docs/CLIENT.md` (controls table row, HUD table row, smoke steps) and a decision-log line to `CLAUDE.md`.

Critical path: S0 -> S1 -> S3 -> S4. S2 and S5 can run beside S3 / S4.

## Studio smoke test (3 clients, "Clients and Servers", `KV_Debug` on)

1. Lobby with 3, Start. Player A takes hits (K) until dead: falls, 1.5 s hold, camera glides to the nearest of B / C;
   bar reads `Spectating B · 1 / 2` with A's own keys in the hint.
2. A clicks: watches C (`2 / 2`); right click: back to B. Hearts / weapons on A's HUD match B's.
3. B dies while A watches: hold on B, then C; the hint hides (one candidate left); clicks do nothing.
4. C clears the floor and takes the stairs: A and B revive at the entrance, the camera snaps to A, the bar goes,
   A's held mouse button does not swing until released.
5. A dies again and opens the party overlay: clicks on its buttons never switch; Leave run takes A to the lobby.
6. Everyone dies: the camera stays put, the run-over panel shows as today.
7. Solo run and the tutorial: dying shows no bar.

## Edge cases

- **Last teammate alive in a 2-player run**: watching them, no hint; their death is the wipe.
- **The watched player leaves the server or uses Leave run**: they are dead and `left`; treated like a death (hold,
  then the nearest).
- **You die during the boss fight**: same rules; the boss bar is not per-player, so it is unchanged.
- **You die while a teammate drafts** (co-op drafts freeze the world): you watch the frozen world; `draftWaiting`
  still counts teammates choosing, so the HUD's "Waiting for N teammates" line is right for you too.
- **The watched player is in another room**: the camera follows them; `snapBeyondTiles` avoids a long pan through
  walls. S0 also lists any other view keyed to the local player's position (decor fades, room reveal) so it follows
  the view index too.
- **The server ends the run while you spectate** (desync, expiry): the run-over panel shows as today.
- **Display names**: `DisplayName` from the `Player` at run start; a member already gone from the server is never
  watched, so the fallback `Player <n>` is only for safety.
- **A rebind of Attack / Alt mid-run**: the hint and the switch use the new keys once the Options screen closes.

## Decisions (2026-10-26, Kaleb)

- **Switch with Attack / Alt** (left / right click, RT / LT): reuses the player's bindings, no new rebind rows.
- **The HUD shows the watched player's vitals** (hearts, armor, flask, Embers, weapons) plus the spectate bar; boons,
  toasts, drafts and the shrine hint stay the local player's.
- **Leave run does not spectate**: it goes back to the lobby as today. A "Watch" button on the lobby's
  "Run in progress" is a possible later phase (the client would have to keep stepping view-only after leaving and the
  server keep sending it frames).

## Out of scope

- Spectating after Leave run, and joining a run in progress as a spectator.
- A free camera or an overview of the whole floor.
- A party strip with every teammate's hearts (could reuse `spectateCandidates` later).
- Reviving a downed teammate mid-floor (a sim change with its own hash group).
