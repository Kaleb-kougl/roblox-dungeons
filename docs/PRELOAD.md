# Asset preloading: plan

The game downloads its art and sound **before** the player sees them, so the first knight, the first swarmer and the
first swing sound never pop in or play late. Two parts (Kaleb, 2026-10-27: "Both"):

1. **A loading screen on join** that holds until the **core** tier is in: everything the main menu, the tutorial and
   floor 1 can show or play. It has a progress bar, a Skip button after a few seconds and a hard timeout.
2. **A background queue** for the **later** tier once the screen lifts: boss art, biome 2-5 music, ambience and the
   boss track. Run starts and floor changes push their own needs to the front of that queue.

Work it task by task, like `PLAN.md`; each task ends with a **Verify**.

It is **presentation only**: nothing touches `src/shared/sim/**`, `src/shared/dungeon/**`, the lockstep wire, the
server, a fixture or a replay hash. No new asset ids.

## Status (2026-10-27)

**P0 (spike code), P1-P5 and P7 built; not run in Studio yet.** Decisions D1-D6 signed off as recommended (D1 with the
music order below). P0's Studio / fresh-device run is still to do; it settles D4 (the build uses instances) and D5
(P6, the warm draw, is not built: `PRELOAD.warmCoreImages` exists but nothing reads it). Headless suite: 2333 specs
green (theme 327, view 664, sim 642, dungeon 188, the rest 512).

## As built (differences from the sketch below)

- **Theme walk** (`ThemeCore` / `ThemePack` `contentIds`, `assetIdList`, `biomeKeys`, `biomeContentIds`;
  `ContentRef { contentId, media }` in `shared/theme/types.ts`). Sorted keys, arrays in order, deduped, cached; never
  warns. A biome's `tiles` hold logical ids (`tile.biome.1.floor`), so `biomeContentIds` also adds those ids' content.
  Biome keys are `biome.1`..`biome.5`, so tier entries read `biome:biome.1`; a bare `biome:` (end of `later`) matches
  every biome.
- **Core order** (`PRELOAD.core`): `ui.`, `class.`, `sfx.ui.`, `music.menu`, `enemy.`, `sfx.`, `breakable.`, `boost.`,
  `fx.`, `decor.`, `biome:biome.1`, then `music.lobby`, `music.biome.1`, `music.tutorial` LAST (long files, after the
  art inside the timeout budget). Ids matching nothing go to the end of `later`, sorted.
- **Pure queue and gate** in `shared/view/preload.ts`: `PreloadQueue` (front / back FIFO lanes, an id once per
  session, a front push MOVES an id still waiting in the back lane) and `JoinGate<T>` (dispatches once, whichever of
  decide / release comes last). Both specced.
- **PreloadController** (`client/controllers/game`, loadOrder 1): one worker, `PreloadAsync` in a `pcall` per chunk,
  never-parented ImageLabel / Sound entries destroyed after their chunk; any status but `Success` warns once and counts
  as done; an entry the callback never named counts as ok when its chunk returns. Releases on core done, Skip,
  `timeoutSec` from `onInit`, `KV_SkipLoading` (`RUN_ATTRIBUTES.skipLoading`) or an empty core (placeholder pack).
  Boss push on `onRunStarted` / `onFloorChanged` from `ctx.endlessFloor(floor).layout.bossKind`.
- **AudioController**: run start / floor change send sfx, the floor's music and ambience (and the tutorial track) to
  the FRONT lane, `music.boss` to the BACK lane (review: it must not jump unfinished core art after a Skip).
- **Loading screen**: `client/store/loading.ts`, `client/ui/loading/LoadingScreen.tsx`, mounted by
  `client/controllers/ui/LoadingController.tsx` (loadOrder 2). `LOADING_VIEW.displayOrder` 30 (HUD 10, pause button 12,
  menu 15, pause / settings 20; spikes HUD 100). **The cursor (docs/CURSOR.md) must sit above 30.** Skip: click,
  Enter / KeypadEnter (not while typing), pad A (Skip takes `GuiService.SelectedObject`); `HudController`'s
  `selectMenuOpen` is also true while the screen is up, so InputController lets pad A through. No shimmer, so reduced
  motion only drops the fade. Strings (`LOADING_STRINGS`, required in the contract): `loading.title` "Project
  Kaleb-Vale", `loading.progress` "Loading {done} / {total}", `loading.skip` "Skip".
- **Join gate**: `TutorialController` feeds its `FirstRunGate` decision into a `JoinGate`; the release comes from
  `PreloadController.whenReleased`. Logs `[Tutorial] first run: X waits for the loading screen` /
  `... (dispatched as the loading screen released)`.
- **P0 spike** `client/controllers/spikes/PreloadSpikeController.ts`: `KV_SpikePreload` (holds the real queue until its
  batches finish) and `KV_SpikePreloadInstancesFirst`; tunables `PRELOAD_SPIKE` in `shared/config/spikes.ts`; how to
  run it and the results table are in `docs/SPIKES.md`.
- **Known gaps (review, low):** one chunk whose `PreloadAsync` never returns would stall the single worker (the screen
  still lifts at the timeout, but later requests wait; no watchdog); failure counts rely on the callback naming each
  entry. Both to check in P0.

## What the code and the engine give us (checked against `main` @ `d627bf4`)

| Fact | Where | Consequence |
|---|---|---|
| The only preload today: `AudioController.preload` runs `ContentProvider.PreloadAsync(ids)` with **content id strings**, fire-and-forget (`task.spawn`), on every run start (every sfx, the floor's music and ambience, the boss track) and floor change | `client/controllers/audio/AudioController.ts` (~line 335) | Nothing waits for it, and the first run starts while it downloads. It moves onto the shared queue (P3) |
| **No image is preloaded.** `SpriteView` sets `ImageLabel.Image` the first time an actor is built, so each atlas downloads on first sight | `client/controllers/render/SpriteView.ts` | This is the pop-in: the knight on the first frame of a run, each enemy kind on its first spawn, Mother Mayhem on her intro |
| `vale` holds **84 ids**: 46 images and 38 sounds (`VALE_ASSET_IDS`). On disk: `art/build/*.png` = **15.3 MB**, `art/build/audio` = **11 MB** (54 files, 38 uploaded) | `packs/vale/assetIds.ts`, `art/build/` | A full preload is about 26 MB of download. Too much to hold the screen for on a slow phone; hence two tiers |
| Uncompressed, every image is **~108 MB** of RGBA8 (eight 1024x1024 knight atlases alone are 32 MB; Mother Mayhem's 14 sheets ~25 MB) | `art/build/*.png` sizes | Downloading costs no GPU memory; drawing does. Any "warm draw" (P6) is core-tier only |
| Every asset reaches the client through logical ids (`ThemePack.texture` / `image` / `spriteSheet` / `sprites` / `sound` / `fx` / `decor` / `breakable` / `boost`, biome tiles in `biomes`), all from the manifest's `assets` and `biomes` tables | `shared/theme/core.ts`, `pack.ts` | One deep walk of those tables finds every `rbxassetid://` string, whatever the asset kind. No list to maintain by hand |
| The roblox-ts `RuntimeLib` waits for `game.Loaded` on the client before any TS runs; Roblox's default loading screen covers the join until then | `include/RuntimeLib.lua:25` | Our screen can live in a normal Flamework controller: there is nothing of ours to cover before it mounts. Nothing is in `ReplicatedFirst` today |
| Join already has a waiting state: until the first-run gate decides (onboarding doc, up to `TUTORIAL.statusTimeoutSeconds`), `MenuLayer` shows the backdrop alone; then `TutorialController` starts the tutorial or `MenuController` opens the main menu (or a solo run under `KV_SkipMenu`) | `TutorialController.frame`, `MenuController.onFirstRunDecided`, store `menu.awaitingFirstRun` | The loading screen overlaps that wait for free. The join flow fires once **both** the gate decided **and** the screen released (P5) |
| Each endless boss floor's boss is known from its layout (`EndlessFloorLayout.bossKind`, `bossKindFor(floorSeed)`) | `shared/dungeon` | A floor change can queue exactly that boss's sheets first |
| `PreloadAsync(list, callback)` yields until every entry resolved and calls `callback(contentId, AssetFetchStatus)` per asset. The engine docs show Instances (Sound, Decal) and never say whether a bare **string** fetches a sound or an image | create.roblox.com ContentProvider reference | Unverified for strings: the spike (P0) settles strings vs instances before P3 is built |
| `settings.reducedMotion` | `client/store/settings.ts` | The bar's shimmer and the fade-out are skipped under reduced motion |

## Player experience

- First join: Roblox's own loading screen, then ours: the game title, a thin progress bar and "Loading 23 / 40".
  Usually a few seconds; on a returning device (assets cached) it lifts almost at once.
- After **3 s** a **Skip** button appears (click, Enter or pad A). Skipping lifts the screen; the rest keeps loading in
  the background and anything not in yet may still pop in.
- After **15 s** the screen lifts on its own, whatever is left. A failed asset never holds it.
- Then exactly today's join: a first-time player goes straight into the tutorial, everyone else gets the main menu.
- During play nothing changes on screen. Bosses, later biome music and ambience load quietly behind the menu and the
  first floors, so they are normally in long before floor 5.

## Architecture

### 1. Theme: every content id of a logical id (`shared/theme/core.ts`, `pack.ts`)

`ThemeCore.contentIds(id): string[]`: a deep walk of `assets[id]` that collects every string starting with
`rbxassetid://` (sheet `assetId`s, outline sheets, sound `variants`, fx and decor atlases, particle flipbooks), in a
fixed order (sorted keys, so specs are deterministic), deduped. `ThemeCore.assetIdList(): string[]` lists the logical
ids that have any (sorted). `biomeContentIds(biome)` does the same for `biomes[b]` (tiles, materials). `ThemePack`
forwards all three. Placeholder and `SilentAsset` entries return nothing. Pure, headless-tested.

### 2. Pure plan: `shared/view/preload.ts` + `shared/view/preloadConfig.ts`

```ts
export const PRELOAD = {
	/** Logical-id prefixes of the core tier, in download order (first = first on screen). */
	core: ["ui.", "class.", "sfx.ui.", "music.menu", "enemy.", "sfx.", "breakable.", "boost.", "fx.", "decor.", "biome:1"],
	/** Everything else is `later`, in this order. */
	later: ["boss.", "music.", "amb."],
	skipAfterSec: 3,
	timeoutSec: 15,
	fadeSec: 0.25,
	/** Entries per PreloadAsync call: small, so a run start's request gets in between chunks. */
	chunkSize: 4,
	/** P6, only if the spike shows a first-draw hitch. */
	warmCoreImages: false,
} as const;
```

- `preloadPlan(pack): { core: string[]; later: string[] }`: each logical id goes to the first tier whose prefix
  matches (longest match wins: `sfx.ui.` before `sfx.`), content ids deduped across tiers (an id in both stays in
  core). `biome:<n>` stands for `biomeContentIds(n)`; biomes 2-5 fall to `later`.
- `PreloadProgress`: a pure reducer over `queued / done / failed` counts -> `fraction`, and
  `loadingReleased({ coreDone, elapsedSec, skipped })` = core done, or skipped, or `elapsedSec >= timeoutSec`.
  `skipVisible(elapsedSec)` = `elapsedSec >= skipAfterSec`.
- `bossContentIds(pack, bossKind)` for the floor-change push (`boss.act1` / `boss.demonlord`).

### 3. Client: `client/controllers/game/PreloadController.ts` (loadOrder 1, right after `ThemeController`)

- **Queue.** Two FIFO lanes (`front`, `back`) of content ids, with a `seen` set (queued, in flight or resolved), so
  any id is requested once per session. One worker (`task.spawn`) takes up to `chunkSize` ids at a time, front lane
  first, calls `PreloadAsync` and counts each callback (`Success` / `Failure` / `TimedOut`). A failure warns once per
  id and counts as done; it never retries (the engine fetches it again on first use).
- **On init:** queue `core` (back lane), then `later` (back lane). The screen tracks the core ids only.
- `request(ids, lane = "front")`: `AudioController.preload` (run start, floor change) and the floor-change boss push
  call it instead of their own `PreloadAsync`. A boss floor pushes `bossContentIds(bossKind)` to the front.
- `whenReleased(cb)`: fires once the screen released (at once if it already has).
- Exposes progress to the Reflex `loading` slice once per Heartbeat while the screen is up.
- Strings or instances (D4): a content id string goes straight in, or through a hidden `ImageLabel` / `Sound` built
  for it (never parented), as P0 decides. The choice is one function, `toPreloadEntry(id)`.
- Debug: Workspace `KV_SkipLoading` (boolean, off by default) releases the screen at once (the queue still runs), for
  Studio iteration.

### 4. Loading screen: `client/ui/loading/LoadingScreen.tsx` + store `loading`

- Reflex slice `loading`: `{ released, fraction, done, total, skipVisible }`.
- Its own ScreenGui, `LOADING_VIEW.displayOrder` above the menu, settings and pause layers (below the cursor once
  `docs/CURSOR.md` lands), `IgnoreGuiInset`, opaque `background` role. Centre: `loading.title`, a bar (track
  `uiTextDim`, fill `uiAccent`), `loading.progress` ("Loading {done} / {total}"); Skip button (`loading.skip`) once
  `skipVisible`, with gamepad selection on it. Same HUD scale. On release it fades out over `fadeSec` (instant under
  reduced motion) and unmounts.
- Three new required theme strings `loading.title` / `loading.progress` / `loading.skip` (contract, placeholder and
  vale packs; `strings.spec`).

### 5. Join gate (`TutorialController`, `MenuController`)

The first-run gate keeps polling as today, but **dispatching** its decision (`sim.startTutorial()`, the
`onFirstRunDecided` listeners) waits for `PreloadController.whenReleased`. So: decided early, released late -> the
decision fires on release; released early, decided late -> fires on decision. `menu.awaitingFirstRun` stays true until
then, so the menu backdrop sits under the loading screen as now. Menu music starts with the main menu, as today.

### 6. What does not change

The sim, the dungeon, lockstep, the server, replays, scores, fixtures, the theme contract's asset ids and every
renderer. With the placeholder pack (no ids) both tiers are empty and the screen releases on its first frame.

## Tasks

**P0 Spike (Studio + a published test place).** A spike flag `KV_SpikePreload` (Workspace attribute, off by default,
Janitor cleanup) that, on join, times `PreloadAsync` of (a) the knight's eight sheets as strings, (b) the same as hidden
ImageLabels, (c) five sfx as strings, (d) as Sounds, printing each callback's status and wall time. Then shows a
knight sheet in a 1x1 ImageLabel and watches the MicroProfiler for an upload hitch. Run it on a **fresh device**
(a phone that never joined, or after clearing the Roblox cache): Studio's local cache hides download time.
Verify: results recorded in this doc (strings ok for images / sounds?, core-tier time on the phone, any first-draw
hitch); D4 and D5 settled.

**P1 Theme content ids.** `contentIds` / `assetIdList` / `biomeContentIds` on `ThemeCore`, forwarded by `ThemePack`.
Verify: specs: vale's union of content ids equals the set of `VALE_ASSET_IDS` values its manifest references (each
once); a sprites set returns its sheets and outlines; a sound returns `assetId` + variants; placeholder returns none;
order is stable.

**P2 Pure plan.** `preload.ts`, `preloadConfig.ts`, barrel export. Verify: specs: every vale content id lands in
exactly one tier; `sfx.ui.*` and `class.vanguard` come before `enemy.*`; boss sheets and `music.biome.2+` are later;
`loadingReleased` / `skipVisible` truth tables at the boundaries (2.99 / 3, 14.99 / 15); an empty pack releases at once.

**P3 PreloadController.** Queue, lanes, dedupe, progress, `whenReleased`, `KV_SkipLoading`; `AudioController.preload`
routed through `request`; boss push on floor change. Verify: `npm run verify`; Studio output shows core then later
chunks, a run start's audio request jumping the back lane, no id requested twice.

**P4 Loading screen.** Slice, component, strings, display order. Verify: `npm run verify`; Studio: bar fills, Skip
appears at 3 s and works by mouse, Enter and pad A; fade; reduced motion has no fade.

**P5 Join gate.** Dispatch on gate-decided AND released. Verify: Studio with `KV_Tutorial` true and false, and with
`KV_SkipMenu`: the tutorial / menu / solo run each start only after the screen lifts; Skip during the onboarding wait
still waits for the gate (backdrop shows, as today).

**P6 Warm draw (only if P0 found a hitch).** Before release, one frame of a 1x1 ImageLabel per core image under the
opaque cover, then destroyed. Verify: MicroProfiler shows no upload spike on the first run's first frame; texture
memory (Developer Console > Memory > GraphicsTexture) noted before / after.

**P7 Docs.** `docs/CLIENT.md` section "Preloading and the loading screen" + smoke test lines, `CLAUDE.md` decision log
entry, this doc's status and as-built notes. Verify: `npm run verify` green, test count noted.

## Studio smoke test

1. Play (Studio): loading screen, then the menu (or the tutorial on a fresh onboarding doc). Output: `[Preload] core
   <n> / <n> in <t> s`, later tier lines after it.
2. Play with `KV_SkipLoading`: no screen; menu at once; the queue still runs.
3. Start a solo run during the later tier: the run's audio request is served first (output order).
4. Reach a boss floor: `[Preload] front: boss.<kind>` on the floor change (usually already seen, so nothing to do).
5. Published place, fresh phone: note the core time and whether the knight, the first swarmer and the first swing play
   without pop-in.

## Edge cases

- **Cached rejoin:** core resolves in a frame or two; the screen just fades. No minimum show time (D2).
- **Placeholder pack / nothing uploaded:** both tiers empty, released on the first frame.
- **A sound without every variant uploaded** (`SilentAsset`): returns no ids, so nothing is queued for it.
- **Lobby invites during the screen:** they queue in the store as today and show once the menu is up.
- **The player leaves mid-load:** the worker's thread dies with the client; nothing to clean.
- **Mobile memory:** downloads do not take GPU memory; only P6's warm draw does, and only for core (~70 MB
  uncompressed at most). If P0 shows no hitch, P6 is dropped.
- **New art later** (Demon Lord sheets, cursor, more biome tiles): picked up by the walk with no code change, in the
  tier its prefix says; `boss.` is later, `ui.` core.

## Decisions (signed off 2026-10-27: the recommended default, first, in each)

- **D1 Tiers.** Core = what the menu, the tutorial and floor 1 can show (UI, knight, regular enemies, every sfx,
  breakables, boosts, fx, decor, biome 1, menu music); later = bosses, biome 2-5, other music, ambience.
  *Alternative:* core = menu only (tiny; the screen becomes a flash and the first run still pops in).
- **D2 Release rule.** Core done, or Skip (after 3 s), or 15 s; no minimum show time, 0.25 s fade.
  *Alternative:* a 1 s minimum so the screen never flashes on a cached rejoin.
- **D3 No ReplicatedFirst script.** Roblox's screen covers the join until `game.Loaded`, which our TS waits for anyway.
  *Alternative:* a plain-Luau `ReplicatedFirst` cover (no RuntimeLib) calling `RemoveDefaultLoadingScreen` for a
  branded screen from the first second; costs a non-TS file and a hand-copied background colour.
- **D4 Strings vs instances.** Whatever P0 shows works for both images and sounds; instances if strings do not fetch
  sounds. One function either way.
- **D5 Warm draw.** Only if P0 measures a first-draw hitch; core images only.
- **D6 Skip.** Offered after 3 s, never before. *Alternative:* no Skip, timeout only.

## Out of scope

Fonts (Roblox's built-in families load with the engine), server-side preloading, a logo or splash art (none uploaded),
tips or a lore carousel on the screen, per-floor unloading of art.
