# Stage assets: plan

When the stage loader lifts (a run start or a floor change), **every asset that floor can show or play is already
downloaded and ready**: its biome's tiles and decor, the characters in the party, every enemy kind its rooms can
spawn (and their runtime children), its boss, its set pieces, its music and ambience. Nothing pops in or plays late
on that floor. It builds on two shipped systems: the join loading screen and its queue (docs/PRELOAD.md) and the
stage cover (docs/STAGE_LOADER.md). Work it task by task, like `PLAN.md`; each task ends with a **Verify**.

It is **presentation and client input only**: nothing touches `src/shared/sim/**`, `src/shared/dungeon/**`, the
lockstep wire, the server, a fixture, a replay or a hash. The only "hold" it adds is the client keeping a confirm or a
solo tick back (the way the draft reveal and the solo run-start hold already do), which the sim sees as a later press
or a later tick.

## Status (2026-11-09)

Plan only; nothing built. Revision 2 (owner, 2026-11-09, below): the game is **playable while loading** on every
device, with stand-ins (the placeholder 3D objects) for any art not in yet. Decisions SAD1-SAD16 are defaults for
review. Tasks SA0-SA20.

## Revision 2: playable while loading (owner, 2026-11-09)

> "For all (phones, PC, game console), can we use the placeholder 3D objects until the assets are loaded? That way
> enemies / bullets / player etc can all be seen and the game is fully playable while still loading."

Yes. Every draw path already has a placeholder branch: `ThemePack` returns art **or** `undefined` ("draw
`pack.placeholder(id)`") for sprites, bullets, breakables, boosts, pellets, the chest, the altar, goo / strike / ember
discs, auras, UI icons and slices. Today that choice is made once, from whether an id was **uploaded**. Revision 2 makes
it a runtime choice, from whether the id's content has **finished downloading on this device**: until then the
renderer draws the placeholder (a stand-in), and swaps to the art the frame it is in. Gameplay never waits on a
download, and nothing that matters is ever invisible.

What changes in the plan:

- **No long holds.** The run start waits at most `softWaitSec` (1.5 s) for the floor's manifest, then reveals with
  stand-ins for whatever is missing (SAD3). Floor changes keep only the card's 0.6 s; the draft never holds its confirm
  (SAD4: SA6 is dropped by default). Co-op adds no waits (SAD8), and the tutorial's draftless change holds nothing
  (SAD9). The manifest, the forecast, the `next` lane and the prefetch stay: they decide **what downloads first**, so
  stand-ins are rare and short.
- **The join screen** loads the menu kit only (SAD2, now with no downside to the first run).
- **The same on every device** (SAD11): phones, PC and consoles take the same path; only the queue's chunk size is per
  device (`chunkSizeByDevice`), and SA0 measures each.
- **Stand-ins first, then art**: the order inside the front lane puts what is on screen soonest first: the party's
  characters, every bullet look, the floor's first-room enemies, then the rest of the manifest (SA15).

### What a stand-in looks like, per renderer (the census, checked in SA14)

| Renderer | Stand-in until loaded | Swap |
|---|---|---|
| `ActorRenderController`: players, enemies, bosses, the dummy, the Goldling | The placeholder model (capsule, cones, domes, blocks; the outline / flash Highlights as today) | The sprite-set cache (`spriteSets`) is keyed by readiness: when an id becomes ready, every live view of it is released and re-acquired on the next frame (the existing `view.kind !== a.kind` re-acquire, plus a `view.art` mismatch). Optional sheets (attack, intro, taunt) join as they land, exactly as un-uploaded optional sheets do today |
| `BulletRenderController` / `SpriteBulletPool` | The neon placeholder ball per look (danger pink for enemies) | Per look, per frame: the neon pools already skip the looks the sprite pool draws, so the routing flag just flips; in-flight bullets change pool seamlessly |
| Goo / strike / ember (`FloorSpritePool`, `HazardSpritePool`) | The placeholder disc | Per frame, like bullets |
| `BreakableRenderController`, `BoostDropRenderController`, `PelletRenderController`, `TreasureRenderController`, `PactRenderController`, `RunMarkerController` (pedestal chests) | Their `placeholder` boxes / gems / cubes / plinths | Rebuild the piece's body on the ready edge (they are few per floor) |
| `BoostAuraController` | The Neon discs | Per frame |
| `WorldController` tiles | The Part's biome colour (an unloaded Texture draws nothing, so the colour shows) | Nothing to do: the Texture appears when loaded. The biome colour already equals the texture's mean (`VALE_TILE_MEAN_HEX`), so the swap is subtle |
| `DecorController` / `VoidController`, decor fx, sprite fx | Nothing (decor is cosmetic) | The image appears when loaded |
| **Solid decor** (tombs, candle stands, bookcases, study tables, Kenney stock pieces): WALL cells drawn as floor under their art | **Gap today: an invisible blocker.** New: a placeholder box per solid piece (its footprint, the decor's height band, a stone role colour), shown until its art is ready (also when a pack has no art at all) | Hide the box on the ready edge |
| HUD / menus (`SlicedImage`, `ArtImage`, icons, pips, hearts) | Today's flat UI and labels (the "without the art" path every UI_ART / icon task kept) | Per image on the ready edge (a store flag per sheet) |
| Audio | Silence: a cue whose sound is not loaded is **dropped**, never played late (a late swing sound is worse than none); music and ambience fade in when loaded | AudioController reads readiness before `Play` |
| Cursor (if docs/CURSOR.md's software cursor is on) | The system pointer stays until the gauntlet art is ready | On the ready edge |

### 11. Readiness (pure core `shared/view/artReadiness.ts`, client feed in `PreloadController`)

- `ArtReadiness`: content id -> `pending | ready | failed`; logical id -> ready when every content id it needs is ready
  (for a sprite set: its required sheets; optional sheets count on their own). `epoch()` bumps on every change, and
  `flippedSince(epoch)` lists the logical ids that became ready, so renderers only touch what changed.
- Fed by PreloadController's `PreloadAsync` callbacks (`Success` -> ready; `Failure` / `TimedOut` -> failed: the id
  keeps its stand-in and is retried once, `retryAfterSec` 10 s, then left as a stand-in for the session), and by
  `ContentProvider:GetAssetFetchStatus` for ids already in the engine cache, if SA0 shows it is reliable.
- Renderers ask `readiness.isReady(id)` next to `pack.sprites(id)` / `pack.bullet(id)` / ...; ThemePack itself stays
  pure and unchanged.
- **Warm before swap** (if SA0 finds a first-draw hitch): an id becomes "ready" only after one hidden draw (a 1x1
  ImageLabel for a frame), at most `warmPerFrame` per frame, so a swap never hitches mid-fight.
- Debug `KV_StandInsForce` (Studio): treat every id as pending (the whole game in stand-ins) or a comma list of
  prefixes, to check every stand-in; `KV_FakeAssetLatency` makes the swaps happen live.

## What the code gives us today (checked against `main` @ `d007b503`)

| Fact | Where | Consequence |
|---|---|---|
| The stage cover's only asset wait is **the floor's music and ambience** (`AudioController.floorBeds`) **plus a boss floor's sheets** (`bossContentIds`), capped at `STAGE_LOADER.assetCapSec` **3 s** | `StageController.waitAssets` | Biome tiles, decor, enemies, the knight, set pieces and sfx are never waited for. If they are not in yet, they pop in after the reveal |
| The boss track (`music.boss`) goes to the **back** lane and is not in `floorBeds` | `AudioController.preload` | A boss floor can reveal with its own music still downloading |
| **Co-op never waits** for assets, nor a floor change whose world is live (no local draft: `StageLoad.waitsForAssets` false) | `StageController.waitAssets`, `stageLoader.ts` | Party runs and the tutorial's floor change get no asset guarantee at all |
| The join screen's **core tier is nearly everything**: `ui.`, `class.`, every `enemy.`, every `sfx.`, `breakable.`, `boost.`, `pellet.`, `pact.`, `bullet.`, `fx.`, every `decor.` (all five biomes), biome 1's tiles and four music tracks. It lifts on core done, Skip (3 s) or **15 s** | `PRELOAD` (`shared/view/preloadConfig.ts`) | The pack has grown to **349 uploaded ids, ~51 MB** (art/build sizes of the ids in `assetIds.ts`): knight 8.2 MB, Demon Lord 5.7, Mother Mayhem 3.7, ten regular enemy sets 0.5-2 MB each (~17 MB together), music 9.4 MB. The core tier is ~35 MB, far past what a phone fetches in 15 s, so on a slow device the join screen times out (or is skipped) and the first run starts with most of its art still queued |
| The queue has two lanes (`front`, `back`); a front push moves an id still waiting in back; an id is fetched once per session; `whenLoaded(refs, cb)` fires once every ref resolved (a failure counts as resolved) | `shared/view/preload.ts` `PreloadQueue`, `LoadWaiters`; `PreloadController` | The machinery for a per-stage wait already exists; what is missing is **which** ids a stage needs and a wait that is allowed to be long enough |
| Everything a floor will contain is known once it is forged: `EndlessFloorLayout.roomSpawns` (every planned room enemy), `encounter` (initial spawns: the boss), `bossKind`, `roster`, `breakables` / `breakableLoot`, `pellets`, `vault`, pact altars, the Goldling's room; the biome from `dungeon.params.themeKey` | `shared/dungeon/endless.ts`, `SimController.biomeIndexFor` | A pure function can list a floor's assets exactly from its layout |
| Most of it is also known **without** forging the floor: the roster is `endlessRoster(runSeed, floor)`, the boss `bossKindFor(floorSeed)`, the biome `resolveAutoTheme(floorSeed)` (Forge `themeKey: "auto"`) | `shared/dungeon` | A cheap **forecast** of floor n + 1 can be prefetched while floor n is played, with no 110 ms generation |
| Runtime spawns not in `roomSpawns`: the Summoner's swarmers, the Ooze's slimelets (`slime.small`), the bosses' swarmer adds, the Goldling | `ENEMY_VARIANTS.md`, `BOSS_DEMONLORD.md`, `FORTUNE.md` | The manifest needs a small "children" table, or those kinds pop in on first spawn |
| Every endless floor change opens a boon draft; the client already holds the draft's confirm while its reveal plays (`DraftRevealGate`) and the sim just sees the press later | `shared/play/draftGate.ts`, `DRAFT_MIN_OPEN_TICKS` | The draft is a free loading window: reveal onto the draft after the card's 0.6 s and hold the confirm until the floor's assets are in. The player reads boons while the art finishes, and cannot step into the floor before it is ready |
| A solo run start is already held (`holdSim`, `FROZEN_PACER`: no tick, nothing recorded) until the reveal | `StageController`, SimController | A longer asset wait at run start costs nothing but time |
| The 3D world renders behind the opaque cover, so whatever is **on screen** under it is drawn once (`settleFrames` 2). Room enemies spawn on room entry, so their sheets are never drawn under the cover | STAGE_LOADER.md | "Downloaded" is not "drawn": the first sight of an enemy kind can still hitch on a texture upload. Whether that hitch is real is P0's open question (docs/SPIKES.md: never run) |
| Archer (docs/ARCHER.md, planned): a character screen every run, so the party's characters are known at run start | ARCHER.md | The manifest takes the present players' character ids; the unpicked character's sheets need not block anything |
| Studio's local cache hides download time | PRELOAD.md P0 | The gates need a Studio-only fake latency to be tested at all |

## Player experience (revision 2)

- **Join:** a short screen for the menu kit, then the menu. Everything else streams behind it, the most likely first
  floor first (the last-picked character, biome 1, every kind floor 1 can roll).
- **Run start:** "Forging floor 1...", then at most 1.5 s of "Loading 12 / 31" if something is still missing. The
  cover lifts; anything not in yet is drawn as its placeholder (the knight capsule, cone and dome enemies, neon
  bullets, boxes for crates and tombs) and turns into its art the moment it lands. Everything is visible and playable
  from the first frame. On a cached device there is no bar and no stand-in.
- **Stairwell:** the card (0.6 s), then the draft, never held. Floor n + 1 was prefetched while you played floor n, so
  stand-ins on later floors are rare.
- **Party run:** each client swaps in its own time; nobody waits for anybody.
- **Sound:** a cue whose sound has not landed is silent (never late); music fades in when it lands.
- **Phones, PC, consoles:** the same behaviour.

## Architecture

### 1. The stage manifest (pure): `shared/view/stageAssets.ts` + `stageAssetsConfig.ts`

```ts
export interface StageAssetInput {
	readonly world: string;                        // endless / daily / dev / tutorial / M1 kinds
	readonly floor: number;
	readonly biome: number;                        // 1..5 (0: none)
	readonly characters: ReadonlyArray<string>;    // class ids of the present players (class.vanguard, ...)
	readonly actorKinds: ReadonlyArray<string>;    // planned room spawns + initial spawns (boss), deduped
	readonly bossKind?: string;
	readonly features: StageFeatures;              // breakables, loot, pellets, powerPellet, vault, pacts, golden
	readonly runStart: boolean;                    // adds the run kit
}

export interface StageAssetSet {
	/** Logical ids the cover / draft gate waits for. */
	readonly must: ReadonlyArray<string>;
	/** Logical ids queued in the `next` lane, never waited for (SAD5: rare late cues). */
	readonly soon: ReadonlyArray<string>;
}

export function stageAssets(pack: PreloadSource, input: StageAssetInput, cfg = STAGE_ASSETS): StageAssetSet;
export function stageContentRefs(pack: PreloadSource, set: StageAssetSet): { must: ContentRef[]; soon: ContentRef[] };
```

- **Run kit** (`STAGE_ASSETS.runKit`, on `runStart` only): in-run `ui.*` (HUD, draft, icons, pips), every `sfx.*`,
  `bullet.*`, `fx.*`, `boost.*`, `breakable.*`, `pellet.*`. Small (~2 MB) and used everywhere.
- **Characters:** `characters` -> their sprite sets (and outline sheets).
- **Actors:** each kind -> its logical id (`enemy.<kind>`, a boss through `PRELOAD_BOSS_IDS`), expanded through
  `STAGE_ASSETS.children` (`summoner` -> `swarmer`, `slime` -> `slime.small`, `boss.*` -> `swarmer`), to a fixed point.
- **Biome:** `biomeContentIds(biome)` (tiles, `tile.biome.<n>.*`), `decor.delve.b<n>.*`, `decor.void.b<n>.*`,
  biome-free `decor.*` (fx motes, Kenney / kit pieces), `amb.b<n>`, `music.biome.<n>`.
- **Boss floors:** the boss's sheets and `music.boss` are **must** (today the track is back lane).
- **Features:** each flag -> its ids (`treasure.*` / `fx.treasure.column`, `pact.altar`, `enemy.golden` /
  `fx.golden.coin`, `pellet.power`), from `STAGE_ASSETS.features`.
- **Tutorial:** `music.tutorial`, `enemy.dummy`.
- Ids are matched by prefix through the same matcher as `preloadPlan` (one code path, longest match). A pack without an
  id (placeholder, not uploaded) yields nothing for it, so the placeholder's manifest is empty and every gate opens on
  its first frame, as the join screen does.

**Coverage guard** (`stageAssets.coverage.spec.ts`): every logical id in the vale pack is reachable from some stage
manifest (over all worlds, biomes, kinds, features, characters) **or** listed in `STAGE_ASSETS.notStaged` (menu-only:
`music.menu`, `music.lobby`, menu-only `ui.*`, credits art). A new asset that no manifest knows about fails the suite,
so "new art later" can never silently fall outside the guarantee.

### 2. Floor inputs: exact and forecast (`shared/run/stageInput.ts`)

- `stageInputOf(ctx, floor, characters)`: reads the forged floor (`ctx.endlessFloor(floor).layout` / the M1 or tutorial
  world): every kind in `encounter` initial spawns and `roomSpawns`, `bossKind`, the feature flags, the biome. Exact.
  Called under the cover after the forge (run start) or after the floor change (floor n + 1 is pre-generated during
  floor n's draft, so it costs nothing then).
- `forecastStageInput(runSeed, floor, params, characters)`: no generation. Roster from `endlessRoster`, boss from
  `bossKindFor(floorSeed)`, biome from `resolveAutoTheme(floorSeed)` (SA3 confirms endless floors use `"auto"`; if a
  floor's theme is depth-driven, read that instead), every feature assumed present (they are small). A **superset** of
  the exact input by construction (a room only buys roster kinds).
- `forecastFirstFloor(characters)`: no seed yet (menu, lobby): biome 1 + every kind floor 1 can roll (`swarmer` + each
  `fromFloor` 1 candidate), for the menu / lobby prefetch.
- Spec: forecast ⊇ exact for run seeds 1-60 x floors 1-20 (endless and daily params), and for the tutorial's floors.

### 3. The queue: a third lane (`shared/view/preload.ts`)

`PreloadLane` = `"front" | "next" | "back"`. Front = the stage being waited for; next = prefetch of the stage after
(and the menu's first-floor guess); back = everything else (the old later tier). A push to a higher lane moves an id
still waiting in a lower one (today's front-over-back rule, generalised). `LoadWaiters` gains a progress read
(`resolved / total` per waiter) for the bars. Each id is still fetched once per session.

Studio-only debug `KV_FakeAssetLatency` (number, seconds per chunk, ignored outside Studio): the worker waits that long
before each `PreloadAsync` chunk, and the session's seen set is bypassed for the gate's own refs, so every gate can be
exercised against Studio's cache.

### 4. The stage wait (`StageController`, `stageLoader.ts`)

- `waitAssets` asks the manifest instead of `floorBeds` + boss: `stageContentRefs(pack, stageAssets(pack,
  stageInputOf(...)))`, pushes `must` to front and `soon` to next, then `whenLoaded(must)`.
- `StageLoad` grows an asset phase with progress: the card shows the bar and "Loading {done} / {total}" only once the
  wait has run `showProgressAfterSec` (0.4 s), so a cached floor never flashes a bar. Skip after `skipAfterSec`,
  lift at `hardCapSec` (solo). `maxCoverSec` (8 s) no longer counts the asset phase (it still bounds forge and build).
- **Floor change with a local draft:** the card lifts after `minCardSec` as today, onto the draft; the wait moves to the
  draft gate (5). **Without a draft:** solo holds the run under the card (`holdSim` extended to that case, SD5's
  alternative, safe for the same reason as pause); co-op waits up to `coopCapSec`.
- Logs: `[Stage] floor 4: 31 ids, 6 missing, ready in 2.4 s` / `... skipped at 7.1 s (3 missing: enemy.reaper ...)` /
  `... capped`.

### 5. The draft gate (`shared/play/stageAssetGate.ts`)

`StageAssetGate`: open once the floor's `must` refs resolved (or skipped, or capped). The draft's confirm path asks
`DraftRevealGate` **and** `StageAssetGate` (one `confirmHeld()` reading both), so a press while the floor loads is
held and the pick shows its stamp; the confirm is sent the moment the gate opens if the player already confirmed
(SAD6). The draft panel shows a slim bar and `hud.draft.loading` while held. Co-op: the cap is `coopCapSec`; nothing
crosses the wire (teammates see today's `hud.draft.waiting`).

### 6. Prefetch (`StageController`, `PreloadController`)

- At each **reveal** of floor n: push the forecast of floor n + 1 to `next`. Floor n + 1 normally finishes downloading
  while floor n is played (minutes), so the draft gate rarely holds.
- On the **menu** (after the join screen) and in a **lobby**: push `forecastFirstFloor(lastCharacter)` to `next`.
- On the floor **before a boss floor**: the boss sheets and track are in the forecast, so they prefetch then (today
  they are pushed only on the boss floor itself).

### 7. Join tier (`PRELOAD`)

With the stage gates guaranteeing each floor, the join screen no longer needs to carry floor art (SAD2): core = `ui.`
(menu skin), `sfx.ui.`, `music.menu`, and, for a first-run player whose gate decides "tutorial", nothing more (the
tutorial's run-start cover waits for its own manifest). Everything else becomes `next` (first-floor forecast) then
`back`. Join on a fresh phone drops from a 15 s timeout to a few seconds.

### 8. Ready means drawn (SA0 decides; `PreloadController`, `AudioController`)

- **Warm draw:** once a stage's `must` images resolved, before the reveal, draw each one once under the cover (an
  ImageLabel per image, `warmChunk` per frame, then destroyed), so the first sight of an enemy that spawns later does
  not pay the texture upload. Only the stage's own images (GPU memory: the knight alone is 32 MB of RGBA8). Built only
  if SA0 measures a first-draw hitch (PRELOAD.md D5, never settled).
- **Audio prime:** AudioController creates the floor's Sound instances (beds, the boss track, the run's sfx pool)
  under the cover, so the first `Play` does not wait on `IsLoaded`.

### 9. Audit (debug, `KV_StageAssetAudit`)

ThemePack is the only door to a content id, so under the flag it records every logical id a view resolves during a
floor. At the floor change (or run over) it diffs that against the floor's manifest and prints
`[StageAudit] floor 4 used enemy.slime.small, not in its manifest`. Pure diff in `stageAssets.ts`; the recording is a
client-only wrapper. This is how SA13's playtest proves the guarantee on real floors.

### 10. What does not change

The sim, the dungeon, generation timing (still pre-generated during the draft), lockstep, the server, replays, scores,
fixtures, the theme's asset ids, every renderer's build code.

## Tasks

**SA0 Spike: measure (extends P0, docs/SPIKES.md).** Run spike P0 at last, on a fresh phone in a published place, and
add: (a) time to fetch the current core tier, (b) per-set fetch times (knight, one enemy set, a boss, biome tiles),
(c) a first-draw hitch on an already-downloaded sheet (MicroProfiler), (d) whether a 1x1 ImageLabel draw removes it
(does it upload the full texture?), (e) `ContentProvider:GetAssetFetchStatus` availability (a cheap "already in"
check), (f) first `Sound:Play` latency on a preloaded vs fresh Sound. Verify: numbers in SPIKES.md; SAD2, SAD7 and
SAD8 confirmed or tuned.

**SA1 Theme groups.** Pack helpers for the manifest: actor kind -> logical id, biome -> logical ids (tiles, decor
delve / void, beds), feature -> logical ids, all through the existing `contentIds`. Verify: theme specs; vale's biome 2
group holds `tile.biome.2.floor` / `.wall` and its decor; placeholder groups are empty.

**SA2 Pure manifest.** `stageAssets.ts`, `stageAssetsConfig.ts` (`STAGE_ASSETS`: run kit, children, features,
notStaged, the gate's tunables), barrel. Verify: specs: children expand (summoner floor holds swarmer; slime holds
slime.small; a boss floor holds swarmer and `music.boss`); run kit only on `runStart`; the coverage guard over the vale
pack; empty for the placeholder.

**SA3 Floor inputs.** `stageInputOf`, `forecastStageInput`, `forecastFirstFloor` in shared/run. Verify: forecast ⊇
exact over seeds 1-60 x floors 1-20 (endless, daily), the tutorial floors and M1; the forecast forges nothing (spec
counts `endlessFloor` calls).

**SA4 Queue.** `next` lane, lane moves, waiter progress, `KV_FakeAssetLatency`. Verify: queue specs (a next push jumps
back, a front push jumps next, an id once); Studio with latency 0.5: chunks print in lane order.

**SA5 Stage wait.** StageController and StageLoad: manifest wait, progress on the card after 0.4 s, Skip, hard cap,
`maxCoverSec` excluding the asset phase, the solo no-draft hold, the boss track as must. Strings `stage.loading`
("Loading {done} / {total}") and `stage.skip` (context entries in `l10n/context.json`). Verify: stageLoader specs for
the new phase (progress monotonic, Skip at 5.99 / 6, cap at 30, no bar under 0.4 s); Studio with fake latency: run
start waits, Skip works, the log names what was missing.

**SA6 Draft gate.** `StageAssetGate`, the confirm path reading both gates, the draft panel's bar and
`hud.draft.loading`. Verify: gate specs (press held then sent on open; skip / cap open it); Studio with fake latency:
confirm held, stamp shows, the confirm lands as the floor finishes; gamepad and touch confirm behave the same.

**SA7 Prefetch.** Forecast of n + 1 at each reveal, first-floor forecast on the menu and in a lobby. Verify: Studio
log `[Stage] prefetch floor 5 (22 ids, next lane)` at floor 4's reveal; with fake latency, a floor played for longer
than its prefetch takes reaches the draft with nothing to wait for.

**SA8 Join tier (after SAD2 is signed).** Trim `PRELOAD.core`; the first-run tutorial start relies on its stage wait.
Verify: preload specs (core = menu kit); Studio: join lifts at once, the tutorial's cover waits for its manifest.

**SA9 Warm draw and audio prime (only what SA0 justifies).** Verify: MicroProfiler on a fresh device shows no upload
spike on an enemy's first spawn; Developer Console texture memory noted before / after a floor.

**SA10 Co-op.** Party start cover up to `coopStartCapSec`, the draft gate with `coopCapSec`, lobby prefetch. Verify:
Test > Clients and Servers (3 players, one with fake latency 2): the party waits for the slow client up to the cap, no
desync (hash check), nobody is hit in the entrance.

**SA11 Audit.** `KV_StageAssetAudit` recording and diff. Verify: diff spec; Studio, floors 1-10 of three seeds with
the flag: no `[StageAudit]` misses (or each fixed in SA2's tables).

**SA12 Telemetry (optional, SAD10).** One custom event `StageAssetWait` (seconds bucket, missing count bucket, floor
band, skipped / capped, device kind). Verify: analytics catalog budget spec; TelemetryService rate limit.

**SA13 Docs and playtest.** This doc's status and as-built, PRELOAD.md / STAGE_LOADER.md cross-links, `docs/CLIENT.md`
smoke test lines, CLAUDE.md decision log. Fresh-phone playtest: a full solo run to floor 10 and one party run, with
`KV_StageAssetAudit`. Verify: `npm run verify` green, test count noted; no pop-in noted in the playtest.

**SA14 Stand-in census.** Walk every renderer that resolves a content id (the table above; `rg "pack\.(sprites|bullet|image|spriteSheet|floorSprite|hazardSprite|breakable|boost|pellet|treasurePiece|pactAltar|fx|decor)"` over src/client) and record its stand-in and swap point in this doc. Verify: every hit is in the table.

**SA15 Readiness core.** `artReadiness.ts` (statuses, logical-id readiness, epoch, flips, failure retry) and the front lane's order (characters, bullet looks, first room's kinds, then the manifest). Verify: specs: a set is ready only with its required sheets; an optional sheet flips on its own; failure retry once; flips listed once.

**SA16 Feed and debug.** PreloadController feeds `ArtReadiness`; `GetAssetFetchStatus` path if SA0 allows; `KV_StandInsForce`; per-device `chunkSizeByDevice`. Verify: Studio with `KV_StandInsForce` all: the whole run in stand-ins, playable; Output `[Ready] enemy.imp ready (2 sheets)` as ids land under `KV_FakeAssetLatency`.

**SA17 Actors and bullets swap.** ActorRenderController (players, enemies, bosses: release and re-acquire on the flip, the pools' keys carry art vs stand-in), bullet / hazard / aura routing per frame. Verify: Studio with fake latency: a knight capsule turns into the knight mid-walk, a swarmer pack mid-fight, bullets in flight change look; no orphan parts (pool counts back to normal), no Highlight over 31.

**SA18 Pieces, solid decor, UI, audio.** Breakables / boosts / pellets / chest / altar / pedestals rebuild on the flip; the new solid-decor stand-in box (`SOLID_DECOR_STAND_IN`: height per kind, colour role); UI images per sheet flag; AudioController drops cues not loaded and fades beds in. Verify: Studio: a crypt room's tombs show as boxes, then as art; no invisible blocker in `KV_StandInsForce` runs; the first swing before `sfx` loads is silent, never late.

**SA19 Soft waits.** `softWaitSec` at run start (the cover lifts with stand-ins), no draft hold, no co-op waits; SA5's bar shows only during the soft wait. Verify: stageLoader specs (lift at 1.5 s with refs missing); Studio with fake latency 2: run start reveals at about 1.5 s, stand-ins swap in over the first room.

**SA20 Device pass.** One fresh-cache run each on a phone, a PC and a console (or Studio's device emulator for the console's TV-safe UI): time to playable, how long stand-ins last on floor 1, any swap hitch (MicroProfiler where available). Verify: numbers recorded here; `chunkSizeByDevice` and `softWaitSec` tuned.

## Studio smoke test

1. `KV_FakeAssetLatency` 0.5, Play solo: "Forging floor 1...", then "Loading n / m"; reveal only when done; the log
   lists the floor's ids.
2. Same, press Skip at 6 s: reveal; the log lists what was missing; those ids keep loading.
3. Walk to the stairwell: card, then the draft with "Loading the floor..." if floor 2 was not prefetched; pick, confirm
   held, sent when the bar fills.
4. Play floor 2 for a minute, then descend: the draft opens with nothing to wait for (prefetched).
5. A boss floor (`node scripts/find-boss-seed.js`): boss sheets and track in the manifest; the boss music starts on
   cue at the intro.
6. Tutorial (first join): join lifts fast; the tutorial's cover waits for its manifest; its floor change holds under
   the card.
7. Party run (3 clients, one slow): the wait caps at `coopStartCapSec` / `coopCapSec`; no desync.
8. `KV_StageAssetAudit` over floors 1-10: no misses.

## Edge cases

- **Skip or cap with ids missing:** they stay in the front lane and show as stand-ins until they land; the log and the
  audit name them.
- **Swap jank:** a swap can change an actor's drawn size (sprites draw at `bodyTiles`, placeholders at the body
  radius); hitboxes are the sim's and never change. SAD12 decides whether live actors swap.
- **Highlights:** stand-in enemies join the one `KV_Actors/Enemies` Highlight (never one per actor), so a floor in
  stand-ins stays under the engine's 31.
- **A failed fetch** counts as resolved (today's rule): a broken id never holds a gate.
- **Leave / restart / death under a wait:** the stage load is cancelled (today's `onRunExited`), the gate drops, the
  queue keeps the ids.
- **Floor skip spam (KV_Debug):** each floor's wait restarts; ids from the skipped floor stay queued (front -> they
  finish first, harmless).
- **Dev world (start on any floor):** the run start's manifest is that floor's; the forecast works from there.
- **Co-op teammate's character:** `characters` comes from the party roster at run start, so a teammate's Archer sheets
  are waited for too.
- **Mobile memory:** downloading costs no GPU memory; only the warm draw does, and only for the current floor's images.
  Nothing is explicitly unloaded (Roblox gives no API); floors stop referencing what they no longer draw.
- **A cached device:** every wait resolves in a frame; no bar shows (`showProgressAfterSec`).

## Decisions (defaults for review; the recommended option first in each)

- **SAD1 The guarantee is per stage, from a manifest built from the floor.** *Alternative:* preload everything at join
  (one long screen, ~51 MB; a phone may need a minute).
- **SAD2 Shrink the join tier to the menu kit.** The stage gates carry floor art. *Alternative:* keep today's core tier
  (join stays long on slow devices, but the first run rarely waits).
- **SAD3 Run start waits at most `softWaitSec` 1.5 s, then reveals with stand-ins** (revision 2). *Earlier default:*
  wait for the whole manifest, Skip after 6 s, hard cap 30 s (still the path for a pack setting `standIns: false`).
  *Was:* Run start waits for the whole manifest: Skip after 6 s, hard cap 30 s. *Alternative:* no Skip (wait to the
  cap), or today's 3 s cap.
- **SAD4 Floor changes never hold** (revision 2): the card's 0.6 s only; SA6 is dropped by default. *Earlier default:*
  floor changes wait on the draft, not the card. The card stays 0.6 s; the draft holds its confirm.
  *Alternative:* keep the card up until loaded (simpler, but the player stares at a card instead of reading boons).
- **SAD5 `soon` ids are never waited for.** Only very late, rare cues go there (none at first; every id starts in
  `must`). *Alternative:* everything must.
- **SAD6 A confirm pressed while loading is sent when the floor is in.** *Alternative:* drop it and require a new
  press (safer against a stale choice; one more press).
- **SAD7 Warm draw only if SA0 measures a hitch.** *Alternative:* always warm the stage's images.
- **SAD8 Co-op adds no waits** (revision 2): no client holds the party; each swaps in its own time. *Earlier default:*
  co-op caps, 6 s at party start, 10 s on a draft. The party never waits longer for one slow client.
  *Alternative:* a server-side "all loaded" handshake before the run starts (a server and lobby change; out of scope).
- **SAD9 No hold on a draftless floor change** (revision 2). *Earlier default:* solo floor change with no draft holds
  the run under the card (like pause; replays unaffected).
  *Alternative:* never hold it (assets may pop in on the tutorial's last floor).
- **SAD10 Telemetry `StageAssetWait`.** *Alternative:* logs only.

- **SAD11 Stand-ins on every device**, one code path; per-device chunk size only. *Alternative:* stand-ins on phones
  and consoles, the full wait on PC.
- **SAD12 Live swap**: a live actor swaps to its art the frame it is ready. *Alternative:* swap only on new spawns
  (no visible pop, but a floor's first enemies stay stand-ins until they die).
- **SAD13 A failed id stays a stand-in** after one retry. *Alternative:* keep retrying every 30 s.
- **SAD14 Cues not loaded are dropped**, never played late; music fades in. *Alternative:* play late.
- **SAD15 Solid decor gets a stand-in box** (fixes today's invisible blocker in any pack without the art).
  *Alternative:* draw solid decor cells as wall until the art is in (reads as wall, not as furniture).
- **SAD16 Stand-ins are the existing placeholders, unchanged.** *Alternative:* a dedicated "loading" look (a shimmer on
  stand-ins), more work and more Highlights.

## As built

- **SA1 (theme groups):** `shared/view/stageGroups.ts`, pure, over `PreloadSource` (no ThemePack change). Entries match
  as a prefix when they end in "." and exactly otherwise (not preload.ts's plain `startsWith`, which would let
  `music.biome.1` match `music.biome.10`; preload.ts's matcher is not exported). Actor kind -> the archetype's own
  `data.spriteId`, the id ActorRenderController draws (`turret.sniper` -> `enemy.sniper`, `slime.small` ->
  `enemy.slime`); unregistered kinds `PRELOAD_BOSS_IDS`, else `enemy.<kind>`. Biome n = `biome:biome.<n>` (its
  `biomeContentIds`), `tile.biome.<n>.*` and every `decor.*` id with a `b<n>` segment (delve, void, `decor.fx.ambient.b<n>`);
  beds `music.biome.<n>` / `amb.b<n>`; biome-free decor = decor ids with no `b<n>` segment that no feature claims.
  Groups list only ids the pack has content for, so every placeholder group is empty. The music ids are config strings
  checked against shared/view/audio by spec (importing the audio barrel from shared/view would be a require cycle
  through `boosts/art.ts`).
- **SA2 (manifest):** `stageAssetsConfig.ts` (`STAGE_ASSETS`, `STAGE_GROUPS`, `STAGE_FEATURES`, `STAGE_CHARACTERS`) and
  `stageAssets.ts`. `stageAssetGroups` returns the groups in front-lane order (characters, bullets, actors, biome,
  features, run kit, audio; each id once at its first group), `stageAssetsInOrder` flattens it, `stageAssets` splits it
  by `STAGE_ASSETS.soon` (empty, SAD5), `stageContentRefs` resolves (`biome:<key>` through `biomeContentIds`), and
  `stageAuditMisses` is SA11's diff. Run kit (run start only): `ui.`, `sfx.`, `bullet.`, `fx.`, `boost.`,
  `breakable.`, `pellet.` (all of `ui.`: no menu-only ui id exists yet); bullets are also their own group on every stage.
  Children: summoner / both bosses -> swarmer, slime -> slime.small (pinned against the sim's `summonKind` /
  `splitKind`). World extras table `worlds.tutorial` (dummy, `music.tutorial`); boss floors add `music.boss`. Features
  include `pedestals` (every treasure room's relic pedestal draws the vault chest). `notStaged`: `music.menu`,
  `music.lobby`. The gate's tunables are `STAGE_ASSETS.wait` (unused until SA5 / SA19). Coverage guard
  `stageAssets.coverage.spec.ts` passes on vale (and checks itself is live).
- **SA3 (floor inputs):** `shared/run/stageInput.ts`: `stageInputOf(src, floor, characters, runStart)` (RunContext
  fits `StageRunSource`), `stageInputOfLayout`, `stageInputOfEncounter` (M1), `forecastStageInput(runSeed, floor,
  characters, world, runStart)`, `forecastFirstFloor(characters, biome = 1)`, and the biome rule `biomeIndexForTheme` /
  `biomeIndexOf` (SimController now imports it). Exact kinds are ordered nearest the player's spawn first. Endless floors
  are themed by the Forge's `"auto"` rule on the floor seed (`resolveParams`; a reroll keeps the theme), so floor 1's
  biome is any of five: `forecastFirstFloor`'s biome 1 is a guess. Only type imports from shared/view and `BIOMES` by
  file, so the server's shared/run never loads the theme packs. Spec: seeds 1-12 x floors 1-10 plus floors 15 / 20 on
  two seeds (not 1-60 x 1-20: ~200 ms a floor under Lune, the spec already takes ~27 s), the tutorial's floors, M1, no
  forging (the endless dungeon cache is unchanged), every floor-1 roster of seeds 1-60 inside the first-floor guess.
- **SA4 (queue).** `PreloadLane` = `"front" | "next" | "back"` (`PRELOAD_LANES`); `PreloadQueue.take` serves them in
  that order, a push to a higher lane moves an id still waiting in a lower one, `retry(ref, lane)` re-queues a taken id
  past the seen set (the readiness retry, the fake-latency re-fetch), `pending(lane?)`, `laneOf(id)`. `LoadWaiters`
  gained `progress(payload)` ([resolved, total], undefined once fired), `cancel(payload)` and `forget(id)`; payloads
  match by identity. `PreloadController.whenLoaded` now returns a `LoadHandle` (`progress()`, `isDone()`, `cancel()`;
  callers that ignore it compile unchanged) and `request` logs `next` pushes like `front`. Per-device chunk size
  `PRELOAD.chunkSizeByDevice` (4 / 4 / 4 until SA0 / SA20), `preloadDeviceOf` (ten-foot = console; touch without
  keyboard or gamepad = touch, InputController's rule) and `preloadChunkSize`. `KV_FakeAssetLatency`
  (`RUN_ATTRIBUTES.fakeAssetLatency`, Studio only, read live): the worker waits before each chunk and skips the
  fetch-status pre-check; `whenLoaded` re-fetches each of its already-resolved refs once per id per session.
  ArtReadiness is NOT reset by it (a ready id stays ready; stand-ins are `KV_StandInsForce`'s job).
- **SA15 (readiness core).** `shared/view/artReadiness.ts` `ArtReadiness` (tunables `ART_READINESS`: `retryAfterSec`
  10, `maxFailures` 2) as specified in section 11. Logical ids are ready when every content id is ready or finally
  failed; no content ids = ready. `flippedSince(epoch)` lists tracked ids whose `isReady` CHANGED (pending -> ready in
  play; `setForced` also flips ids back to not ready), each once, in flip order: renderers re-read `isReady`. Tracked =
  asked through `isReady` or `track`. The per-sheet split ("optional sheets count on their own") is the caller's: a
  logical id is all of its `contentIds`, so a set's optional sheet flips on its own only if asked by its own id
  (ThemePack's `contentIds` lists a set's sheets under the set id today; SA17 decides). No warm stage (SAD7);
  the module comment names the extension point. The front lane's order (characters, bullets, first room) is SA5 /
  SA2's push order, not built here.
- **SA16 (feed and debug).** PreloadController owns the one `ArtReadiness` (every `assetIdList()` id tracked at
  start), marks Success ready and failures failed, re-queues a first failure on the back lane once `retryDue` hands it
  out (Heartbeat), and pre-checks `ContentProvider:GetAssetFetchStatus` per id before a chunk
  (`PRELOAD.fetchStatusPrecheck`, pcall; a failing call turns it off; provisional until SA0 (e)). API:
  `getReadiness()`, `isArtReady(id)`, `onReadinessChanged(cb(epoch)) -> unsubscribe` (Heartbeat, at most once per
  frame, each listener in its own thread). `KV_StandInsForce` (`RUN_ATTRIBUTES.standInsForce`, read live,
  `parseStandInsForce`: "all" or a comma list of prefixes). Logs: `[Ready] <id> ready (<n> content ids)` per flip
  under `KV_Debug`, one `[Ready] all <n> ids ready in <t> s (...)` summary always. The join screen is unchanged
  (same tiers, same chunk size; the pre-check only resolves ids the engine already has).
- **SA5 + SA19 (the stage wait, soft).** StageController's `waitAssets` (after the listeners) builds the floor's
  manifest, `stageAssets(pack, stageInputOf(ctx, ctx.floor, STAGE_CHARACTERS, kind !== "floorChange"))` (RunContext does
  not expose the party's characters yet, so every cover uses `STAGE_CHARACTERS`; co-op starts count as run starts for
  the run kit), and pushes `must` to the front lane in manifest order through `PreloadController.whenLoaded`, `soon` to
  next; AudioController's own requests and PreloadController's boss push are untouched (`AudioController.floorBeds` and
  `bossContentIds` are no longer read here). StageLoad (`stageLoader.ts`): only a solo run start waits
  (`waitsForAssets()` = kind `runStart`; floor changes and co-op pass the phase at once, `assetWait` `"none"`, the
  card keeps `minCardSec`, no draft hold). `STAGE_LOADER.assets` = `STAGE_ASSETS.wait`, which gained `standIns` (true):
  with it the wait lifts at `softWaitSec` (`"soft"`); without it at `hardCapSec` (`"capped"`) or a `skipAssets()` from
  `skipAfterSec` (`"skipped"`; `canSkipAssets()`) — the pure path is built and spec'd, **no Skip button is drawn**
  (the stage cover owns no focus scope; not cheap, not needed with stand-ins). `setAssetProgress(done, total)` (fed
  every frame from the LoadHandle; monotonic, clamped), `assetProgress()`, `showAssetProgress()` (assets phase, past
  `showProgressAfterSec`, something missing); the bar's `assets` weight fills with the progress. `maxCoverSec` no
  longer counts the assets phase. `STAGE_LOADER.assetCapSec` is gone. The card shows the join screen's
  `loading.progress` ("Loading {done} / {total}") under the run-start bar (store `stage.assets`, `setStageAssets`): no
  new string. Logs at each reveal: `[Stage] floor N: M ids, ready in T s` or `..., K of C content ids missing at reveal
  (soft: enemy.imp, ... +n)` (names from `isArtReady`, `STAGE_LOADER.logMissingIds` 5) and later `floor N: ready in T
  s, after the reveal`. Specs: soft lift at exactly 1.5 s with refs missing, no line under 0.375 s, floor change / co-op
  ignore assets, the full wait's Skip at 6 s and cap at 30 s, `maxCoverSec` without the assets phase.
- **SA7 (prefetch).** At every reveal, floor n + 1's manifest goes to the next lane (once per run and floor; the
  exact input when that floor was already built: a run start's pre-generation, every tutorial floor; else
  `forecastStageInput(ctx.seed, n + 1, STAGE_CHARACTERS, ctx.world)`; never past `TUTORIAL.lastFloor`); log `[Stage]
  prefetch floor N (k ids, exact | forecast, next lane)`. Menu / lobby: StageController subscribes (after the join
  screen's release) to the menu screen and the joined lobby id, no MenuController edit; with no run up it pushes the
  first-floor guess once per key ("menu" / lobby id) to next. Biome choice: all five biomes on `next`, biome 1's
  full forecast first, then biomes 2..5's new ids (`stageMergedAssets` in `stageAudit.ts`; floor 1's biome is the
  seed's auto theme, so a single guess is right one time in five, and the extra biomes are only tiles and decor);
  the refs are computed once per session.
- **SA8 (join tier).** `PRELOAD.core` = `ui.`, `sfx.ui.`, `music.menu`, `music.lobby` (the menu draws no class or
  enemy art; every `ui.` id stays core because menu and HUD icons share sheets). Everything else moved to `later`
  (back lane), in first-run order: class, bullets, enemies, sfx, pieces, fx, decor, biome 1 and its track, the
  tutorial's track, treasure, pact, bosses, other music, ambience, biomes. The join screen's release rules are
  unchanged; the first-run tutorial's run start is covered by its own soft wait. preload.spec updated.
- **SA11 (audit).** `KV_StageAssetAudit` (`RUN_ATTRIBUTES.stageAssetAudit`, read at each cut). Pure half in
  `shared/view/stageAudit.ts`: `STAGE_AUDIT.methods` (17 ThemePack lookups: id by argument, by the result's `id`, or
  `biome:<key>`; a spec checks each is a ThemePack method), `stageAuditIdsOf`, `StageAuditLog` (begin at the cut, the
  manifest set in `waitAssets`, `close(hasContent)` -> sorted misses). Recording: `ThemeController.setAuditRecorder(cb |
  undefined)` shadows those methods on the ONE pack instance (instance fields over the class methods, removed again
  when off), so ThemePack stays unchanged and references taken earlier are covered; internal calls (`bullet` ->
  `sprites`) are seen too. Closed at the next cut, run over (`isRunOver`, polled per frame) and exit: `[StageAudit]
  floor N used <id>, not in its manifest` per miss (at most `maxMissLines` 40, then a count), or `floor N: k ids used,
  all in its manifest`. Ids without content are never misses. Limit: a renderer that cached a lookup on an earlier
  floor (outside the pack) is not seen on later floors.
- **Studio checks still needed (SA5 / SA7 / SA8 / SA11):** with `KV_FakeAssetLatency` 2, Play solo reveals at about
  1.5 s after the build with "Loading n / m" from 0.4 s and the missing-ids log line; floor changes never wait; the
  prefetch lines at each reveal and on the menu / a lobby; a fresh join lifts on the menu kit; the tutorial's start
  covered by its soft wait; `KV_StageAssetAudit` over floors 1-10 (expect misses only from ids the manifest truly
  lacks).
- **SA17 (actors, bullets, hazards, auras).** Pure helpers `shared/view/standIns.ts`: `drawsArt(hasArt, ready)`,
  `FlipTracker` (`poll(feed)` once per frame -> moved?; `has(id)` for this frame's flips, either direction; the first
  poll syncs, a new feed object counts as all flipped) and `ReadyIds` (a fixed index -> logical id list, re-read only
  when the epoch moves; `isReady(i)`), over `ReadinessFeed` (ArtReadiness satisfies it). The renderers poll
  `PreloadController.getReadiness()` per frame (no `onReadinessChanged` listener needed: they run every frame).
  **ActorRenderController:** `spriteSets` still caches the pack's answer; `acquire` draws the set only while
  `isArtReady(spriteId)`. `ActorView.visualId` / `artCapable`; when the epoch moved, a LIVE actor whose id flipped and is
  drawn the wrong way is released and re-acquired in the same frame (`swapDue`; pool keys already split `sprite:` from
  placeholder keys; the stand-in goes under the one Enemies Highlight, Highlight count unchanged). Corpses keep the view
  they died with until the slot frees (no swap mid-death). A set is all-or-nothing: ready only when every sheet of it
  (rims and optional sheets included) is in, so a sprite never draws a blank frame (decided here: no per-sheet ids).
  Players: `PlayerView` builds its pip only; `usePlayerBody` builds the sprite (+ ring) or the capsule on first draw,
  parks the other (the capsule leaves `Players/Outlined`), resets the cached look / transparency; the player-outline
  Highlight follows the drawn body; the ring (`ui.ring.player`) replaces the pip only once its image is ready too.
  **Bullets:** the sprite pools are built up front whenever the pack has bullet art (anchors grow lazily) and carry
  `SpriteBulletPool.ready` (ReadyIds by look); a look not ready is not drawn there, so the neon pool after it draws it:
  bullets in flight change pool on the frame. **Goo / strike / ember:** `DecalPool.frame(sim, clock, artReady)` draws
  the discs until ready, then the sprite drawer; a mode change parks the other side (`FloorSpriteDrawer.parkAll`, new:
  FloorSpritePool, StrikeSpritePool (drops its scorches), EmberSpritePool). The discs now always live in their plain
  folders (`Goo`, `Strike`, `Ember`) and the art anchors in the art folders; `DecalPool.poolSize` is discs + anchors.
  **BoostAuraController:** per kind `ReadyIds` over `fx.boost.aura.<kind>`; the disc until ready (the shown / seen swap
  parks the unused piece). WeaponViewController, motionFx (ghosts copy drawn sprites only) and bulletTrails draw no art
  by id: unchanged. Not in SA17's files and left as is (cosmetic, nothing gameplay-relevant goes invisible):
  FxSpriteController and GoldenRenderController's coin burst (`pack.fx`).
  Studio checks pending: `KV_StandInsForce` = "all" draws the whole run in stand-ins and is playable; clearing it swaps
  everything live; with `KV_FakeAssetLatency` the knight capsule turns into the knight mid-walk, a pack of enemies
  mid-fight, bullets in flight; no orphan parts (pool counts settle), Highlights under 31.

## Out of scope

Faster downloads (compression, smaller atlases), unloading assets, Parallel Luau generation, a server "all clients
ready" handshake, streaming a floor in pieces, tips or art on the card.
