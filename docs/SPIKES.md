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
| UA1: UI art | Do snapped 9-slice borders land on whole screen px, does the icon atlas bleed, does a CanvasGroup keep pixels crisp, does a stretched panel centre need `flat`? (docs/UI_ART.md UA1) | `src/client/controllers/spikes/UiArtSpikeController.tsx`, `src/client/ui/spikes/UiArtSpike.tsx` |
| PA0: sprite bullets | Can the bullets be drawn as pixel-art sprites (Decal, per-bullet SurfaceGui, or one canvas SurfaceGui) at bullet-hell counts, within 1.5x the neon parts' update? (docs/PROJECTILE_ART.md PA0) | `src/client/controllers/spikes/BulletSpikeController.ts` (spike A's controller, render modes) |
| L0: localization | Which fonts draw each script we may ship (tofu, fallback or correct), do Arabic shaping / right-to-left and CJK / Thai wrapping work, which locale id is the player's language, does `AutoLocalize = false` stop translated content, and what does the cloud table's CSV look like? (docs/LOCALIZATION.md L0) | `src/client/controllers/spikes/L10nSpikeController.ts`, `src/shared/spikes/l10nSpike.ts` |

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

Spike A is mode **N** of spike PA0 (below): the same controller, the neon spheres are its default mode, and its
numbers come from the PA0 session (fill both tables from mode N's rows).

## Spike PA0: sprite bullets (docs/PROJECTILE_ART.md)

Not a task 1 gate: it decides docs/PROJECTILE_ART.md PAD9 (which technique draws the bullet sprites, or the
fallback) before any production renderer is written. It extends spike A's controller (same flag, same rings and
spiral, same HUD panel) with a **render mode** switch. Client code only. It is **off by default**; every mode's pools
live in a child Janitor of spike A's, so a mode change tears the old mode's Parts / GUIs down before the next is
built, and turning the flag off removes everything (`Workspace.KV_SpikeBullets` folder and all).

### What it does

The emitter is where your character stood, or (the game spawns no character) the floor under the camera's focus
(a ray straight down from it; on a miss, y = 0), so starting the spike during a run puts the bullets around the
player in a real room. Bullets fly 2 studs above that floor (`BULLET_SPIKE.heightStuds`, the sim's `BULLET_Y`).

| Mode | Key | How each bullet is drawn | Moved by | Flipbook (3 frames, 10 fps, phase = slot mod 3) |
|---|---|---|---|---|
| **N** neon | 5 | spike A's neon sphere (the baseline, unchanged) | one `BulkMoveTo` per pool | none |
| **A** decal | 6 | a flat invisible Part (0.81 x 2.57 studs, a 6x19 px bolt at 29.6 px/tile) with a Top-face `Decal` | `BulkMoveTo`, the CFrame turned along the velocity | `Decal.Texture` swapped between 3 textures |
| **B** surface | 7 | the same flat Part as an anchor carrying a Top-face `SurfaceGui` (FixedSize 12x38, `LightInfluence` 0) + `ImageLabel` (`Pixelated`): FxSpriteController's construction | `BulkMoveTo`, turned along the velocity | `ImageRectOffset` |
| **C** canvas | 8 | ONE flat Part per pool over the whole area (128 x 128 studs, a 1024 px Top-face `SurfaceGui`), one `ImageLabel` per bullet | `Position` + `Rotation` writes (no Part moves) | `ImageRectOffset` |

A frame is written only when a slot's frame changes. With PAD8's phase (slot index mod 3) every bullet changes on
the same frames (every 0.1 s), so the flipbook cost comes in bursts: watch `worst`, not only the average.

**Key 0** (or the `+200` button) adds a second pool of 200 "player" bullets (yellow, faster rings) in the same mode:
production keeps the player and enemy pools apart, so modes N / A / B make a second `BulkMoveTo` and mode C a second
canvas. PA0's go rule is measured with it on.

**Art.** `ThemePack.bullet("bullet.player.basic")` when the active pack has it (after PA2 / PA8; HUD `art pack`):
its first 3 frames. Until then (HUD `art engine`) the engine's own particle textures, which ship in every Roblox
install (`shared/theme` `SPIKE_ENGINE_TEXTURES`): option A swaps `rbxasset://textures/particles/sparkles_main.dds`,
`fire_main.dds` and `smoke_main.dds`; options B and C read `sparkles_main.dds` as a 3-cell strip whose pixel size is
*assumed* (`BULLET_SPIKE.sprite.fallbackStripPx`, 128 x 128, so cells of 42 x 128): the rect logic runs exactly as with
an atlas, but the drawn cells are slices of a sparkle, not bolts. If B / C draw nothing or a cut-off sliver, set
`fallbackStripPx` to the texture's real size. Option A never uses the pack (a Decal cannot crop an atlas rect; PA2's
`upscale` would make one PNG per frame). The sprites are tinted (enemy rings in the four spike colours, player
yellow), as the theme would tint them.

HUD readout (averaged over 0.5 s; the window restarts on any change of count, mode or the +200):

- line 1: `bullets <moved>/<count> +<player bullets>` and the pattern; line 2: the mode and the art source;
- `fps`, `update` (= compute + move + flip) and `worst` (slowest single update in the window);
- `compute`: the ring layout plus building the CFrames (N / A / B) or the UDim2 positions and rotations (C);
  `BulkMoveTo` (N / A / B) or `writes` (C: the Position / Rotation property writes); `flip`: the flipbook writes;
- MicroProfiler label `KV BulletSpike` as before. Render cost (draw calls, SurfaceGui layout) is **not** in `update`:
  read it in the MicroProfiler's render section and in the frame rate.

All tunables: `BULLET_SPIKE` in `src/shared/config/spikes.ts` (`modes`, `players`, `sprite`, `canvas`); the texture
paths (asset URLs may only live in shared/theme): `src/shared/theme/spikeTextures.ts`. If a sprite mode's bullets do
not point along their travel (the Top face's up direction is assumed to be the Part's -Z), set
`BULLET_SPIKE.sprite.artYawOffsetDeg` to 90 / 180 / 270 and note it.

### Turning it on

Same flag as spike A: `workspace:SetAttribute("KV_SpikeBullets", true)` from the command bar while playing (false
removes everything), the Workspace attribute before Play, or `SPIKE_DEFAULTS.bullets` (not for a published build).
It starts in mode N with 1,000 bullets, rings, no player bullets.

### Test script

Lighting as in Setup. Note the Studio frame-rate cap, CPU / GPU and `Lighting.Technology`.

1. **PC, quality 10** (File -> Studio Settings -> Rendering -> Editor Quality Level; or the Player's menu). Start a
   solo endless run (developer mode's god mode, docs/DEV_MODE.md, keeps you alive; stand in a cleared room so the
   game's own bullets do not count), then turn the spike on. For **each mode N, A, B, C** (keys 5-8 or buttons):
   1. counts 100 / 500 / 1,000 / 2,000 (keys 1-4), rings; then 1,000 spiral (P); wait ~5 s each and record fps,
      update, compute, move (BulkMoveTo / writes), flip, worst;
   2. 1,000 rings **+200** (key 0) and 1,000 spiral +200: the go rule's rows;
   3. open the MicroProfiler (Ctrl+F6) at 1,000 + 200 and note what the render section shows next to N (more draw
      calls? SurfaceGui / GUI layout time?).
2. **PC, quality 1**: repeat 1,000 rings and 1,000 + 200 rings for every mode.
3. **Phone emulator** (Test -> Device, e.g. iPhone 14 or a mid Android): the same as step 2 with the HUD buttons.
   The emulator changes only screen size and input, not CPU / GPU: write that caveat next to the numbers (real phones
   are docs/MOBILE.md's device pass).
4. **Look** at each sprite mode next to N (screenshots at 200 %), at quality 10 and 1:
   - **blur**: are the sprite pixels crisp (B / C are `Pixelated`; A's Decal filters bilinearly, so expect soft
     edges: that is the case for PA2's `upscale`)? Any shimmer while they turn?
   - **lighting**: is a sprite as bright on a dark biome as on a light one, and in shadow (B / C are `LightInfluence`
     0; a Decal has no unlit switch, so A may darken: PAD10)? Compare with N's neon glow;
   - **draw order**: walk to a room edge so rings cross walls and void: are sprites hidden **under walls** and pillars
     (depth tested, like the neon), drawn **over the floor**, floor decals and markings (telegraph rings, the aim
     line, room edges), never z-fighting with the floor? Do A / B sprites flicker against each other where they
     overlap? Does C's canvas hide anything (it is one big surface: check the floor and pellets under it, and the
     player / enemy sprites standing on it);
   - **turning**: do the bolts point along their travel in rings and in the spiral (else `artYawOffsetDeg`)?
   - **flicker**: does the 3-frame flicker read, and is it in step across a ring (PAD8's phase)?
5. Turn the spike off: the `KV_SpikeBullets` folder is gone from Workspace and the HUD panel disappears. Switch modes
   back and forth a few times first: the folder holds only the current mode's folder each time.

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

## Spike UA1: UI art primitives (docs/UI_ART.md)

Not a task 1 gate: it answers the four pixel questions the UI skin (docs/UI_ART.md UA6-UA13) is built on. Client code only
(`UiArtSpikeController`, flag `KV_UiArtSpike`, tunables `UI_ART_SPIKE` in `src/shared/config/spikes.ts`). It is **off by
default**; its ScreenGui (`KV_UiArtSpike`, display order 60, the HUD's UIScale from `useHudScale`) is one Janitor:
turning the flag off unmounts and removes it. Run it after the draft reveal's DR9 Studio check, with the UI art uploaded
(the sliced PNGs and `ui-icons.png` ids pasted into `packs/vale/assetIds.ts`, UA4); until then it shows the scales line
and a red line naming what is not uploaded.

### Turning it on

- **Command bar, while playing:** `workspace:SetAttribute("KV_UiArtSpike", true)`; `false` removes it.
- **Code default:** set `SPIKE_DEFAULTS.uiArt` to `true` in `src/shared/config/spikes.ts` (not for a published build).

### What it shows (top to bottom, scrolls)

1. The scales line: the current UIScale, then for the menus (`UI_ART.refPerArt` 2) and the HUD (`UI_ART.hudRefPerArt` 1)
   `artPixelScale` (whole screen px per art px) and the snapped `SliceScale` (`snappedSliceScale`).
2. (a) `ui.panel.menu` 9-sliced at 200 x 120 and 420 x 300 reference px, each with SliceScale snapped and fixed (2).
3. (b) the same four panels inside a `CanvasGroup` at `GroupTransparency` 0.5 (the corner panels' occlusion fade).
4. (c) a row of icon-atlas `ArtImage`s (hearts, flasks, candle, chips, the focus bracket, the glyphs), each fitted into
   its `UI_ART.iconBox` (fitArt), and a `ui.button` at 260 x 40 with `FocusCorners` (four `ui.focus.corner` brackets,
   tinted `uiAccent`).

### Test script

Window sizes 720 p, 1080 p, 1440 p (Studio's device emulator or a resized window), each at HUD scale 70 %, 100 % and
125 % (Options > Display), so UIScale covers 0.6-1.75; zoom a screenshot to 400 % to count pixels.

1. **(a) Snapped borders on whole screen px:** in the snapped panels every art pixel of the border is the same number of
   screen px (`artPixelScale` on the scales line); compare the fixed ones at a fractional UIScale (uneven rows expected).
2. **(b) Icon atlas bleed:** no neighbouring piece's pixels or a gutter line at the edges of any icon in (c), at the
   smallest window (1 screen px per art px) and the largest.
3. **(c) CanvasGroup crispness:** the panels in (b) are as crisp as in (a) (no blur, no resampling seam), only fainter.
4. **(d) Stretched centre:** the 420 x 300 panel's centre: does the noise smear into visible blocks? If so, the panel
   crops need `centre: "flat"` (UAD4).

### Results: UI art (UA1)

| Question | 720 p | 1080 p | 1440 p | HUD scale 70 % / 125 % |
|---|---|---|---|---|
| (a) Snapped borders on whole screen px | | | | |
| (b) No gutter bleed from the icon atlas | | | | |
| (c) A CanvasGroup keeps pixels crisp | | | | |
| (d) A large stretched noise centre needs `flat` | | | | |

Results pending (the art is not uploaded yet). Notes (UIScale values seen, anything odd):

## Spike L0: localization (docs/LOCALIZATION.md)

Not a task 1 gate: it decides the fonts per script, the Roblox locale codes and which scripts can ship
(docs/LOCALIZATION.md L0, LD8, LD12). Client code only (`L10nSpikeController`, flag `KV_L10nSpike`, tunables
`L10N_SPIKE` in `src/shared/config/spikes.ts`; the font candidates and sample strings are data in
`src/shared/spikes/l10nSpike.ts`, checked by `l10nSpike.spec.ts`). It is **off by default**; its two ScreenGuis
(`KV_L10nSpike`, display order 70, and the probe `KV_L10nSpikeAuto`, the only GUI we ever create with AutoLocalize on)
are one Janitor: turning the flag off removes both. Run it in Studio for (a)-(c), and in a **published place** for
(d)-(f) (the account language, the cloud table and auto-translation only exist there; Studio's Test > Player Emulator
locale picker is a useful second look, note what it changes).

### Turning it on

- **Command bar, while playing:** `workspace:SetAttribute("KV_L10nSpike", true)`; `false` removes it.
- **Server console in a published place (replicates):** the same line.
- **Code default:** set `SPIKE_DEFAULTS.l10n` to `true` in `src/shared/config/spikes.ts` (not for a published build).

### What it shows (one sheet, scrolls both ways)

1. **(c) The top lines** (also printed as `[L10nSpike] locale ids`, and again whenever `LocaleId` or `RobloxLocaleId`
   changes): `LocalizationService.RobloxLocaleId`, `LocalizationService.SystemLocaleId`, `Players.LocalPlayer.LocaleId`,
   the `AutoLocalize` default of a freshly created ScreenGui and TextLabel, and whether a TextLabel has a `TextDirection`
   property (read through pcall).
2. **(a) The glyph sheet:** one row per font candidate (`Arcade`, `Code`, `BuilderSans`, `SourceSans`, `GothamMedium`,
   `Ubuntu`, `Roboto`; a font the engine lacks shows `(missing)` in red) and one column per sample: the nine Latin
   locales (es, pt, fr, de, it, pl, tr, id, vi, each with its accents), ru (Cyrillic), ja (kana + kanji), ko, zh-hans,
   zh-hant, th, hi (Devanagari), ar (with the number 12450 and the Latin name Kaleb inside) and pseudo (`⟦ ⟧` and
   no-break spaces). Each cell is 240 x 26 px at text size 18, clipped; under it `fits yes|no WxH` is its `TextFits`
   and `TextBounds`. One second after it opens, the spike prints one `[L10nSpike] <font>: ...` line per font with every
   cell's metrics (copy them into the results).
3. **(b) Wrapped text:** a 220 px `TextWrapped` box per script (a long German word, vi, ru, ja, ko, zh-hans, zh-hant,
   th, hi, ar, pseudo), in `Arcade` and in `BuilderSans`; then the Arabic paragraph right-aligned with `TextDirection`
   set to `Auto`, `LeftToRight` and `RightToLeft` (a caption says when setting it failed).
4. **(d) The AutoLocalize probe:** three labels whose text is exactly `Localization spike probe: start the run`
   (`L10N_SPIKE_PROBE_SOURCE`): label 3 in the sheet (root off, label on), labels 1 (root on, label on) and 2 (root on,
   label off) bottom right. The spike prints all three texts after one second.

### Test script

1. **(a) Glyphs**, Studio: for every font x column, is it correct, a silent fallback (drawn, but in a visibly different
   face from the rest of the row), tofu (boxes / blanks), or clipped (`fits no`)? Zoom a screenshot to 200 %. Pay most
   attention to `Arcade` on the Latin columns (LD8: Latin keeps the pixel look only if Arcade draws them all) and to
   the pseudo brackets.
2. **(b) Arabic**, Studio: are the letters joined (shaped), not isolated forms? Do the words run right to left, with
   `Kaleb` and `12450` each reading left to right inside? Which `TextDirection` (if the property exists) reads right?
3. **(c) Line breaking**, Studio: do the CJK boxes break between characters and stay inside their width? Does Thai
   break between words, cut a word mid-cluster, or overflow? Does the long German word overflow or break?
4. **(d) Locale ids**, published place: an account whose Roblox language is Español on a device whose system language is
   French. Read the top lines on the client; on the server console run
   `for _, p in game.Players:GetPlayers() do print(p.Name, p.LocaleId) end` and
   `print(game:GetService("LocalizationService").RobloxLocaleId)`. Which id follows the account language (the
   in-experience language)? Switch the account language through every language we may ship and record each code (the
   downloaded CSV header in step 6 lists the table's codes too).
5. **(e) AutoLocalize**, published place, with the Creator Hub setup below: the defaults come from the top lines.
   With the account language Español: label 1 should show the Spanish entry, label 2 English. Label 3 tells whether a
   root's `AutoLocalize = false` keeps a descendant's `true` from translating (expected: English). Also look at the
   rest of the game's UI: nothing of ours may change language.
6. **(f) Cloud upload and auto-translate**, Creator Hub (steps below): does auto-translate fill both uploaded rows, does
   it keep `{name}` intact in every language, and what is the exact header line of the downloaded CSV?

### Creator Hub setup for (e) and (f)

Record the menu paths you actually used in the notes (the docs we read named Creator Hub → Localization → Settings /
Table Management, and Studio's Localization Tools).

1. Publish the place. Creator Hub → Creations → the experience → **Localization** → **Settings**: source language
   English; **Automatic Text Capture off**; **Use Translated Content on** for in-experience content; add Spanish and
   French as supported languages.
2. **(e) The probe entry:** in the localization table add one entry whose **Source** is exactly
   `Localization spike probe: start the run` (no Key or Context needed), and give it a hand-written Spanish
   translation that cannot be mistaken for a machine one, e.g. `[es] SONDA OK`.
3. **(f) The CSV:** save these two rows as `l10n-spike.csv` (UTF-8) and upload it through Table Management:

   ```csv
   Key,Source,Context,Example
   spike.l10n.plain,Start the run,L0 spike (f): a menu button that starts a run,
   spike.l10n.named,"Welcome back, {name}!","L0 spike (f): a greeting; {name} is a player's display name","Welcome back, Kaleb!"
   ```

4. Turn **automatic translation on** for the supported languages (per-language toggles), wait until the entries show
   translations (note how long it took), then **download** the table as CSV.
5. Copy the downloaded CSV's **first line (the header)** verbatim into the results, and check each language's
   `spike.l10n.named` for `{name}` (untouched, translated, re-cased or dropped?). Note whether auto-translate replaced
   the hand-written `[es] SONDA OK`.
6. Afterwards delete the three spike entries from the table, and turn Use Translated Content back to what
   docs/LOCALIZATION.md design 4 says.

### Results: localization (L0)

Checklist (one line of result each):

- [ ] (a) Glyph sheet per script and font (table below). Result:
- [ ] (b) Arabic shaping and right-to-left order; `TextDirection` exists / which value works. Result:
- [ ] (c) CJK and Thai line breaking with `TextWrapped`. Result:
- [ ] (d) `Player.LocaleId` vs `RobloxLocaleId` (client and server) for Español account + French device; full code list. Result:
- [ ] (e) `AutoLocalize` defaults (ScreenGui / TextLabel); root false stops translated content for descendants. Result:
- [ ] (f) Auto-translate fills uploaded entries; `{name}` kept; exact CSV header. Result:

Glyph sheet (correct / fallback / tofu / clipped):

| Column | Arcade | Code | BuilderSans | SourceSans | GothamMedium | Ubuntu | Roboto |
|---|---|---|---|---|---|---|---|
| es | | | | | | | |
| pt | | | | | | | |
| fr | | | | | | | |
| de | | | | | | | |
| it | | | | | | | |
| pl | | | | | | | |
| tr | | | | | | | |
| id | | | | | | | |
| vi | | | | | | | |
| ru (Cyrillic) | | | | | | | |
| ja | | | | | | | |
| ko | | | | | | | |
| zh-hans | | | | | | | |
| zh-hant | | | | | | | |
| th | | | | | | | |
| hi (Devanagari) | | | | | | | |
| ar | | | | | | | |
| pseudo `⟦ ⟧` + NBSP | | | | | | | |

| Question | Studio | Published place |
|---|---|---|
| `RobloxLocaleId` / `SystemLocaleId` / `Player.LocaleId` (client) | | |
| `Player.LocaleId` / `RobloxLocaleId` (server) | | |
| AutoLocalize default: ScreenGui / TextLabel | | |
| `TextDirection` property, best value for Arabic | | |
| Probe labels 1 / 2 / 3 (translated or English) | | |
| Auto-translate filled the uploaded rows (which languages, how long) | | |
| `{name}` kept in every language | | |

Downloaded CSV header (verbatim):

Roblox locale codes seen (language: code):

Notes (Studio version, Player Emulator behaviour, anything odd):

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

### Spike PA0

Go rule (docs/PROJECTILE_ART.md PA0): **go if the best sprite mode holds 60 fps on PC with 1,000 enemy + 200 player
bullets and its update is <= 1.5x mode N's update at the same count, pattern and quality.** That mode is PAD9's pick.
No go: PAD9's fallback (sprites for player bullets only; if even that fails, the plan stops at PA4). Record the
device / context (PC model or emulated phone), the quality level and the art source (`pack` / `engine`) per session.

One table per mode. "+200" = the player pool on. Move = BulkMoveTo (N / A / B) or the property writes (C).

#### Mode N: neon parts (the baseline; spike A's table above takes the same numbers)

| Device / context | Quality | Count | Pattern | +200 | fps | update ms | compute ms | move ms | flip ms | worst ms |
|---|---|---|---|---|---|---|---|---|---|---|
| | 10 | 100 | rings | | | | | | - | |
| | 10 | 500 | rings | | | | | | - | |
| | 10 | 1000 | rings | | | | | | - | |
| | 10 | 1000 | spiral | | | | | | - | |
| | 10 | 2000 | rings | | | | | | - | |
| | 10 | 1000 | rings | yes | | | | | - | |
| | 10 | 1000 | spiral | yes | | | | | - | |
| | 1 | 1000 | rings | | | | | | - | |
| | 1 | 1000 | rings | yes | | | | | - | |
| emulator | 1 | 1000 | rings | yes | | | | | - | |

#### Mode A: Decal per bullet

| Device / context | Quality | Count | Pattern | +200 | fps | update ms | compute ms | move ms | flip ms | worst ms |
|---|---|---|---|---|---|---|---|---|---|---|
| | 10 | 100 | rings | | | | | | | |
| | 10 | 500 | rings | | | | | | | |
| | 10 | 1000 | rings | | | | | | | |
| | 10 | 1000 | spiral | | | | | | | |
| | 10 | 2000 | rings | | | | | | | |
| | 10 | 1000 | rings | yes | | | | | | |
| | 10 | 1000 | spiral | yes | | | | | | |
| | 1 | 1000 | rings | | | | | | | |
| | 1 | 1000 | rings | yes | | | | | | |
| emulator | 1 | 1000 | rings | yes | | | | | | |

#### Mode B: SurfaceGui + ImageLabel per bullet

| Device / context | Quality | Count | Pattern | +200 | fps | update ms | compute ms | move ms | flip ms | worst ms |
|---|---|---|---|---|---|---|---|---|---|---|
| | 10 | 100 | rings | | | | | | | |
| | 10 | 500 | rings | | | | | | | |
| | 10 | 1000 | rings | | | | | | | |
| | 10 | 1000 | spiral | | | | | | | |
| | 10 | 2000 | rings | | | | | | | |
| | 10 | 1000 | rings | yes | | | | | | |
| | 10 | 1000 | spiral | yes | | | | | | |
| | 1 | 1000 | rings | | | | | | | |
| | 1 | 1000 | rings | yes | | | | | | |
| emulator | 1 | 1000 | rings | yes | | | | | | |

#### Mode C: one canvas SurfaceGui per pool

| Device / context | Quality | Count | Pattern | +200 | fps | update ms | compute ms | move ms | flip ms | worst ms |
|---|---|---|---|---|---|---|---|---|---|---|
| | 10 | 100 | rings | | | | | | | |
| | 10 | 500 | rings | | | | | | | |
| | 10 | 1000 | rings | | | | | | | |
| | 10 | 1000 | spiral | | | | | | | |
| | 10 | 2000 | rings | | | | | | | |
| | 10 | 1000 | rings | yes | | | | | | |
| | 10 | 1000 | spiral | yes | | | | | | |
| | 1 | 1000 | rings | | | | | | | |
| | 1 | 1000 | rings | yes | | | | | | |
| emulator | 1 | 1000 | rings | yes | | | | | | |

#### Looks (step 4)

| Mode | Blur (quality 10 / 1) | Lighting (dark biome, shadow) | Under walls / pillars | Over floor, decals, markings | Turning | Flicker |
|---|---|---|---|---|---|---|
| A decal | | | | | | |
| B surface | | | | | | |
| C canvas | | | | | | |

MicroProfiler render section at 1,000 + 200 (per mode, against N):

Verdict: best mode, its update at 1,000 + 200 on PC / N's (ratio), 60 fps held (yes / no), go / no go, PAD9's pick:

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
