# Task 1 spikes (go/no-go)

Two throwaway experiments that decide whether the port goes ahead (PLAN.md task 1), plus later ones for asset
preloading (P0, docs/PRELOAD.md) and Roblox invites and parties (I0, docs/INVITES.md). A, B and P0 are client code,
I0 is client + server; all are **off by default** and clean up everything they create (one Janitor each) when
turned off.

| Spike | Question | Code |
|---|---|---|
| A: bullets | Can Roblox move the web build's 1,000 enemy bullets as Parts at 60 fps, on PC and on a phone? | `src/client/controllers/spikes/BulletSpikeController.ts` |
| B: iso camera | Does a narrow-FOV perspective camera far away pass for the web build's orthographic iso view? | `src/client/controllers/spikes/CameraSpikeController.ts` |
| P0: preload | Does `PreloadAsync` fetch images and sounds from content id strings, or only through instances? Does a sheet's first draw hitch? (docs/PRELOAD.md D4 / D5) | `src/client/controllers/spikes/PreloadSpikeController.ts` |
| I0: invites | What do `PromptGameInvite`, LaunchData, `GameInvitePromptClosed`, `CanSendGameInviteAsync` and the Party API really do in a published place? (docs/INVITES.md "What the Roblox API gives us") | `src/server/services/spikes/InviteSpikeService.ts`, `src/client/controllers/spikes/InviteSpikeController.ts` |

Tunables for all of them: `src/shared/config/spikes.ts`. HUD: `src/client/ui/spikes/SpikeHud.tsx` (top left, with buttons
for touch devices).

## Setup (once)

1. `rokit install`, `npm install`, `npm run build`.
2. `rojo serve` (or `npm run dev`), open a **Baseplate** place in Studio, connect the Rojo plugin (7.7.x).
3. Lighting, for a fair camera test: in `Lighting`, delete or disable `Atmosphere` (its haze washes out a scene
   viewed from ~700 studs) and note `Lighting.Technology` (Future / ShadowMap / Voxel) in the results.

## Turning a spike on

Pick one:

- **Attribute (no code change, persists in the place):** Explorer -> `Workspace` -> Properties -> Attributes -> `+`,
  add a **Boolean** named `KV_SpikeBullets` and/or `KV_SpikeCamera`, tick it, then Play.
- **Command bar, while playing** (server context is fine, attributes replicate):
  `workspace:SetAttribute("KV_SpikeBullets", true)`. Set it to `false` to stop the spike and remove its Parts.
- **Code default:** set `SPIKE_DEFAULTS.bullets` / `.camera` to `true` in `src/shared/config/spikes.ts`.

## Spike A: 1,000 pooled bullet Parts

What it does: a pool of small neon spheres (Anchored; CanCollide, CanQuery, CanTouch and CastShadow off) in rings
or a spiral around the spot where your character stood when the spike started. Every frame one
`workspace:BulkMoveTo(parts, cframes, Enum.BulkMoveMode.FireCFrameChanged)` moves all of them.

Controls: keys **1 / 2 / 3 / 4** = 100 / 500 / 1,000 / 2,000 bullets, **P** = rings / spiral (or the HUD buttons).

HUD readout (averaged over 0.5 s):

- `fps`: frames per second.
- `update`: ms per frame spent in the spike's update, split into `compute` (position math + building CFrames) and
  `BulkMoveTo` (the engine call). `worst` is the slowest single frame in the window.
- The update is also labelled `KV BulletSpike` in the MicroProfiler (Ctrl+F6, or View -> MicroProfiler); render
  cost of the Parts shows up in the frame's render section, not in `update`.

Steps:

1. PC: Play (F5). For each count, both patterns, wait ~5 s and record fps, update, compute, BulkMoveTo, worst.
   Note your Studio frame-rate cap (Studio caps at 60 unless changed; File -> Studio Settings) and the GPU / CPU.
2. Optional, closer to players: publish to a private place and repeat in the Roblox Player (Shift+F5 shows stats).
3. Phone emulator: Test tab -> Device (device emulator), pick a phone (e.g. iPhone 14 or a mid Android), Play, use
   the HUD buttons, record the same numbers. The emulator only changes screen size and input, **not** CPU / GPU, so
   this checks layout and touch; real-phone fps is PLAN.md task 10. Write that caveat next to the numbers.
4. Graphics quality: repeat 1,000 bullets at quality level 1 and 10 (Studio: File -> Studio Settings -> Rendering ->
   Editor Quality Level, or the in-game menu in the Player).

Go if: **1,000 bullets hold 60 fps on PC** with `update` well under the frame budget (target < 2 ms). If not, the
plan's fallback is to cap enemy bullets per device class while the sim keeps the same number.

## Spike B: iso camera rig

What it does: `Camera.CameraType = Scriptable`, yaw 45 deg / pitch 55 deg (the web build's `CAMERA_YAW` /
`CAMERA_PITCH`), and a distance chosen so the screen shows 16.875 tiles top to bottom (the web build's 270 px /
16 px per tile) at every FOV. The camera follows a green placeholder block (1 x 1.5 x 1 tiles, 4 studs per tile) with
exponential damping (`followTauSec`), and can snap its position to a screen-aligned grid in render texels (1 texel =
the web build's pixel grid, 0.25 studs). A checker floor and pillars give depth and motion reference.

Controls: **WASD / arrows** walk the placeholder screen-relative (W = up the screen, as in the web build; the keys
are sunk so your Roblox character stays put), **V** cycles FOV 5 / 7 / 10 / 20 / 70, **G** cycles snap
off / 1 / 4 / 16 texels, **T** toggles a circular auto-walk (for the phone emulator). The HUD shows FOV, distance and
snap, with buttons.

Steps and what to record:

1. Walk around at each FOV. Does 5 to 10 read as orthographic (pillar sides barely visible near the screen edges,
   parallel floor lines stay parallel)? Which FOV is the smallest without artifacts?
2. At FOV 5 the camera is ~770 studs away. Look for depth fighting between the floor slabs and pillars, shadows
   fading or popping (shadow cascades depend on camera distance), fog / atmosphere haze, and level-of-detail popping.
   Repeat at graphics quality 1.
3. Snap off vs 1 texel vs 4 texels while walking and with auto-walk: shimmer on the checker edges, judder of the
   placeholder against the floor.
4. Damping: does `followTauSec` 0.12 feel like the web build? Try 0 and 0.25 in `spikes.ts` if needed.
5. Phone emulator: same checks with auto-walk.

Go if: one FOV in the 5 to 10 range looks acceptable (no visible perspective, no artifacts) on PC and in the
emulator.

## Spike P0: asset preloading (docs/PRELOAD.md)

Not a task 1 gate: it settles docs/PRELOAD.md decisions D4 (strings vs instances) and D5 (whether P6's warm draw is
needed). Turn it on **before Play** (Workspace attribute `KV_SpikePreload`), so PreloadController's own queue waits
for it (Output: `[Preload] KV_SpikePreload: the queue waits for the spike's batches`); otherwise its batches are cache
hits of the core tier.

What it does, once per enable, at join (Output lines start with `[PreloadSpike]`):

1. Four timed `ContentProvider:PreloadAsync` batches: (a) the knight's sheets (`class.vanguard`) as content id
   strings, (b) the same as never-parented ImageLabels, (c) up to five sfx content ids as strings, (d) as Sounds.
   Each callback prints `<batch> <content id> <status> +<ms> ms`, each batch `<batch>: <n> entries in <ms> ms`.
   **Cache caveat** (printed too): the second batch of each pair is usually a cache hit of the first. A second
   Boolean attribute, `KV_SpikePreloadInstancesFirst`, runs (b) before (a) and (d) before (c): play once each way.
2. The preload queue starts (`[Preload] spike done: the queue starts`).
3. First-draw probe: 30 frames timed (`baseline 30 frames: mean <ms> ms, worst <ms> ms`), then the first knight
   sheet in a 1x1 ImageLabel (above the loading screen) for 10 frames, each printed as `probe frame <n>: <ms> ms`.
   Keep the MicroProfiler (Ctrl+F6) open and look for an upload spike on probe frame 1 or 2. Tunables:
   `PRELOAD_SPIKE` in `src/shared/config/spikes.ts`.

Setting `KV_SpikePreload` false cancels a run in progress and removes the probe's ScreenGui.

Run it in Studio for the wiring, then on a **fresh device** (a phone that never joined the published place, or after
clearing the Roblox cache): Studio's local cache hides download time.

## Spike I0: Roblox invites and parties (docs/INVITES.md)

Not a task 1 gate: it confirms (or corrects) every row of docs/INVITES.md "What the Roblox API gives us" before I1-I9
are built on it. **Nothing here works in Studio** (invites, LaunchData and parties are platform features): Studio
only checks the wiring (the HUD appears, buttons log errors or `false`). The real run is a **published test place**
with two or three friend accounts.

### What it does

Server (`InviteSpikeService`, output lines `[InviteSpike] EVENT: ...`) and client (`InviteSpikeController`,
`[InviteSpike/client] EVENT: ...`) both read `KV_InviteSpike`. Every server line is also sent to every client and
shown on the spike HUD (`srv ...`; client lines are `cli ...`), last 12 lines, so a phone or console tester needs no
dev console. When a client's HUD starts listening it sends `hello` and the server replays that player's own arrival
lines (marked `(replay)`): PlayerAdded runs before the client has loaded.

- **Every PlayerAdded** (and players already there when the spike starts, marked "here before the spike started"):
  `PLAYER_ADDED` (players / MaxPlayers), `JOIN_DATA` (every key of `GetJoinData()` with its type), `REFERRED_BY`
  (whether that user is in this server), `LAUNCH_DATA` (polled every 1 s for 15 s: when it first reads non-empty,
  `+s` since PlayerAdded, or "still empty"), `LAUNCH_PARSED` (length; for a spike LaunchData `kvspike|s or c|<ISO
  time>|<inviter id>`: which side prompted, whether the inviter IS / is NOT in this server, seconds since the
  prompt), `PARTY_ID` / `PARTY_ID_ERR` (read inside pcall at PlayerAdded and on every `PartyId` change, `+s` since
  PlayerAdded), and for a non-empty id `PARTY_PLAYERS` (`GetPlayersByPartyId`) and `PARTY_ASYNC` (pcall'd
  `GetPartyAsync`, one line per entry with every key, whether that member is here).
- **`PROMPT_CLOSED`**: `SocialService.GameInvitePromptClosed` is connected on the server **and** the client; each line
  says `(server signal)` or `(client signal)` with the sender and the raw `recipientIds`.
- **Client start**: `CLIENT` (place, JobId: compare servers between accounts), the client's own `PARTY_ID` and
  `JOIN_DATA` attempts (both may refuse on the client: the error is the finding).
- **HUD buttons** (top left; tap / click; gamepad: Roblox's UI navigation):

| Button | Does |
|---|---|
| prompt (server) | Server `PromptGameInvite(player, options)`: `PromptMessage`, `LaunchData` = `kvspike\|s\|<ISO time>\|<your id>`, `InviteMessageId` if `KV_InviteSpikeMessageId` is set. `PROMPT_SERVER` (returned) or `PROMPT_SERVER_ERR` |
| prompt (client) | The same from the client (`kvspike\|c\|...`). `PROMPT_CLIENT` / `PROMPT_CLIENT_ERR` |
| prompt 1 (srv) | Server prompt with `InviteUser` = the recipient (below) |
| can send (srv) | Server `CanSendGameInviteAsync(player)` then `(player, recipient)`: result or error, and how long it yielded |
| can send (cli) | The same from the client |
| dump both | The client's PartyId / join data again, and the server's dump for you again |

Recipient of the with-recipient calls: Workspace attribute `KV_InviteSpikeRecipient` (a UserId number) if set, else
the first other player in the server. The server accepts at most one request per second per player
(`RATE_LIMITED`). The RemoteEvent is made at runtime (`ReplicatedStorage.KV_InviteSpike.Request`), not in
`shared/network.ts`. Tunables: `INVITE_SPIKE` in `src/shared/config/spikes.ts`.

### Turning it on

- **Studio (wiring only):** Workspace attribute `KV_InviteSpike` (Boolean) = true, Play (or "Clients and Servers"
  with 2 players to see the recipient checks), or from the server command bar
  `workspace:SetAttribute("KV_InviteSpike", true)`. Setting it false removes the remote, the folder, every watch and
  the options objects; the HUD panel goes.
- **Published test place (the real run):** `npm run build:place`, open `build/kaleb-vale.rbxl` in Studio, add the
  Workspace attribute `KV_InviteSpike` = true **before publishing** (PlayerAdded must be watched from the first
  join), then File -> Publish to Roblox As -> a **test experience** (never the live one). The test accounts must be
  able to join it (public, or play access for them). Optional: `KV_InviteSpikeMessageId` (String) = a Notification
  String id made for that experience (I8). The owner can also toggle it in a live server from the Developer Console
  (F9) -> Server command line with the same `SetAttribute` call, and read the full server output there.
- **Code default:** `SPIKE_DEFAULTS.invites = true` in `src/shared/config/spikes.ts` (do not commit it).

### Test script (published place)

Accounts: **A** (inviter; ideally the owner, so the dev console's Server log is readable), **B** and **C**, all three
friends with each other. Note every account's device and platform (PC / phone / console) and age group. Before each
step, every account leaves the experience unless the step says otherwise. Copy the HUD (screenshot) or the dev
console lines into the results table below.

1. **Eligibility.** A joins alone: `can send (srv)` and `can send (cli)`. B joins A (Join from A's profile): both
   buttons again on A (now with recipient B) and on B. Record results, errors and the yield time.
2. **Server prompt, inviter stays.** B and C out of the game. A taps `prompt (server)`: does the prompt open? Pick
   only B, send. Record `PROMPT_CLOSED`: which side(s) fired, `recipientIds` (B's id?). Open the prompt again and
   close it without picking anyone (empty list? fired at all?), then once picking B and C. B accepts the
   notification: compare B's `CLIENT` JobId with A's (same server?), B's `JOIN_DATA` keys, `LAUNCH_DATA` delay,
   `LAUNCH_PARSED` (server prompt, inviter IS here, seconds since the prompt), `REFERRED_BY`. Check the notification
   text (custom `InviteMessageId` vs Roblox's default).
3. **Client prompt.** As 2 with `prompt (client)` (B out of the game again): does a client-side prompt work at all,
   and does B's LaunchData say `c`?
4. **InviteUser.** A in the server, owner sets `workspace:SetAttribute("KV_InviteSpikeRecipient", <B's UserId>)` from
   the dev console, A taps `prompt 1 (srv)`: is the prompt preselected / single-friend? B accepts as in 2.
5. **Inviter has left.** C joins A's server first (keeps it alive). A invites B (`prompt (server)`), then A leaves
   the experience. B accepts: same server as C (compare JobIds) or another one? `LAUNCH_PARSED` must say the
   inviter is NOT here. Repeat with nobody left in A's server (A alone, invites, leaves; the server closes): where does
   B land, does LaunchData still arrive?
6. **Late accept.** A invites B while B is offline; B opens the notification 5+ minutes later. Record the seconds
   since the prompt in `LAUNCH_PARSED` and whether it still joins A's server. (Also shows how long a notification
   stays usable: docs/INVITES.md ID3's 15 min.)
7. **Full server (if feasible).** Set the test place's server size to 2 (Creator Dashboard -> the place -> Settings ->
   server size; it applies to new servers). A and C in one server; A invites B; B accepts. Join queue?
   Another server? An error? Restore the size afterwards.
8. **Roblox's own invite.** A opens the Roblox menu (Esc / the Roblox button) -> Invite friends -> B. Does
   `PROMPT_CLOSED` fire (which side, which ids)? B accepts: LaunchData (empty?), `REFERRED_BY`, same server?
9. **Roblox Party of 3.** In the Roblox app, A, B and C form a Party (A leads); A starts the experience with "join with
   party" (or the party's join button). Record for each: same server (JobIds), `PARTY_ID` at PlayerAdded (readable on
   the server? the error text if not), whether a `PartyId changed` line follows and after how many seconds, the
   client's own `PARTY_ID` attempt, `PARTY_PLAYERS` (how many, as each one arrives), `PARTY_ASYNC` (order = who
   accepted the party first? keys per entry: `UserId`, `PlaceId`, `JobId`, `PrivateServerId`,
   `ReservedServerAccessCode`?). Then one member leaves the party mid-session: `PartyId changed` to ""?
10. **Restricted account (if available).** An under-13 account and / or a console (Xbox / PlayStation) account: steps
    1 and 2 (eligibility, does the prompt open, does it receive invites).

### Results: the API table, row by row

Fill one row per fact of docs/INVITES.md "What the Roblox API gives us". "Confirmed" = as the plan says; otherwise
write what happened and edit the plan (I0's Verify).

| # | Fact (docs/INVITES.md) | Steps | Confirmed? | What happened (log lines, devices) | Plan change |
|---|---|---|---|---|---|
| 1 | `PromptGameInvite(player, ExperienceInviteOptions)` from the server opens the prompt; options `PromptMessage`, `InviteUser`, `InviteMessageId`, `LaunchData` (max 200) apply | 2, 3, 4 | | | |
| 2 | `CanSendGameInviteAsync(player, recipientId?)` yields, can fail, varies by platform / player; with vs without recipient | 1, 10 | | | |
| 3 | `GameInvitePromptClosed(player, recipientIds)`: which side fires, what `recipientIds` holds (none picked, several, Roblox menu invite) | 2, 8 | | | |
| 4 | Accepting bypasses matchmaking and joins the inviter's server; inviter left; full server shows a join queue | 2, 5, 7 | | | |
| 5 | `GetJoinData().LaunchData` carries the string, delay after PlayerAdded, late accept | 2, 3, 5, 6 | | | |
| 6 | Invites cannot target subplaces (one place today: note only) | - | | | |
| 7 | Notification String (`InviteMessageId`) replaces Roblox's default text | 2 (with `KV_InviteSpikeMessageId`) | | | |
| 8 | `Player.PartyId` readable on the server at PlayerAdded (and delay); `GetPlayersByPartyId`; `GetPartyAsync` order and keys; "join with party" lands everyone in one server | 9 | | | |
| 9 | None of it works in Studio (party, invites, launch data): what Studio does instead | Studio run | | | |
| 10 | @rbxts/types coverage (see below) | - | Checked 2026-10-27 | | |

Type coverage (@rbxts/types 1.0.957, checked 2026-10-27): `ExperienceInviteOptions` (creatable; `PromptMessage`,
`InviteUser: number`, `InviteMessageId`, `LaunchData`), `PromptGameInvite(player, options?: Instance)`,
`CanSendGameInviteAsync(player, recipientId?: number)`, `GameInvitePromptClosed(senderPlayer, recipientIds:
Array<number>)`, `Player.PartyId` (read-only string) and `GetJoinData().LaunchData?: string` are present and right; no
`User` parameters, so no `asUserParam` cast. `GetPlayersByPartyId` returned `Array<Instance>` and `GetPartyAsync`
`Array<unknown>`: `src/types/roblox-social.d.ts` overloads them to `Array<Player>` / `Array<SocialPartyMemberData>`
(keys from the reference; step 9 confirms them).

## Spike MB0: touch input (docs/MOBILE.md)

Not a task 1 gate: it answers the touch questions that MB2-MB9 (the mobile controls) are built on. Client code only
(`TouchSpikeController`, flag `KV_TouchSpike`). It is **off by default** and its overlay is one Janitor: turning the flag
off removes it. Run it on a **published place** (a phone, a tablet, and one low-end Android).

### Turning it on

- **Server console (replicates to every client):** `workspace:SetAttribute("KV_TouchSpike", true)`. Set it to `false` to
  stop the overlay.
- **Code default:** set `SPIKE_DEFAULTS.touch` to `true` in `src/shared/config/spikes.ts` (not for a published build).

The overlay sits top centre (the text) and bottom left (a 120 px probe square, `TOUCH_SPIKE.probeSize`). It refreshes
every `TOUCH_SPIKE.refreshSec`, so the fps is the frame count over that window.

### Test script

1. Read the flags on the overlay (`Touch`, `Mouse`, `Keyboard`, `Gamepad`, `GuiService.TouchControlsEnabled`,
   `Orientation`).
2. Put 1, 2, 3 fingers down and move them: do the finger numbers stay with their fingers? (A finger's number is fixed
   the first time `TouchStarted` sees its InputObject.)
3. Tap the probe square's top-left corner: read `probe same object` (does the probe get the same InputObject that
   `TouchStarted` gave that finger?) and `probe offset` (touch position minus the button's `AbsolutePosition`; the
   `GetGuiInset` value on the overlay is the top-bar inset, for comparison).
4. Hold a finger anywhere: does `Mouse1 down` read `yes`, and does `mouse` follow the finger?
5. Is the stock thumbstick / jump button visible before step MB9 lands? (Note what is on screen.)
6. fps and memory (`mem`, `texture`) on endless floor 1, on a Demon Lord floor (find a seed with
   `node scripts/find-boss-seed.js`) and with `KV_Stress` 600.

### Results: touch input (MB0)

| Question | Low-end Android | iPhone | Tablet |
|---|---|---|---|
| 1. Flags (Touch / Mouse / Keyboard / Gamepad, TouchControlsEnabled) | | | |
| 2. Finger numbers stay with their fingers (1 / 2 / 3 fingers) | | | |
| 3a. Probe same object (yes / no) | | | |
| 3b. Probe offset at the top-left corner (x, y) | | | |
| 4. `Mouse1 down` and `mouse` follow a held finger | | | |
| 5. Stock thumbstick / jump visible | | | |
| 6. fps and memory: endless floor 1 | | | |
| 6. fps and memory: Demon Lord floor | | | |
| 6. fps and memory: `KV_Stress` 600 | | | |

Notes (device model, OS, orientation, the GuiInset value, anything odd):

## Results

Fill these in; they decide the go/no-go gate in PLAN.md task 1.

### Spike A

| Device / context | Quality | Count | Pattern | fps | update ms | compute ms | BulkMoveTo ms | worst ms |
|---|---|---|---|---|---|---|---|---|
| | | 100 | rings | | | | | |
| | | 500 | rings | | | | | |
| | | 1000 | rings | | | | | |
| | | 1000 | spiral | | | | | |
| | | 2000 | rings | | | | | |

Notes (frame cap, hardware, emulator caveat):

### Spike B

| FOV | Distance (studs) | Reads as ortho? | Artifacts (depth, shadows, haze, LOD) | Snap verdict |
|---|---|---|---|---|
| 5 | | | | |
| 7 | | | | |
| 10 | | | | |
| 20 | | | | |

Chosen FOV, studs per tile, follow damping, snap:

### Spike P0

| Device / context | Order | Batch | Entries | Statuses | Wall ms |
|---|---|---|---|---|---|
| | strings first | images/strings | | | |
| | strings first | images/instances | | | |
| | strings first | sounds/strings | | | |
| | strings first | sounds/instances | | | |
| | instances first | images/instances | | | |
| | instances first | images/strings | | | |

First-draw probe (baseline mean / worst ms, probe frames 1-3 ms, MicroProfiler spike?):

D4 (strings or instances) and D5 (warm draw needed?):

### Spike I0

The fact table is in "Spike I0" above; record each run here.

| Date | Place version | Accounts (device, platform, age group) | Steps run | Notes |
|---|---|---|---|---|
| | | | | |

Plan edits made (docs/INVITES.md):

### Decision

Go / no-go, and anything the later tasks must change:
