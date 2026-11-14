# Codex (plan, as built)

Status (2026-11-12): **built** on branch `codex` (CX1-CX10, one commit each; CX0 was a read-only findings pass);
headless checks per step green (typecheck, lint, build, the codex / theme / view/menu / view/sighting / view/hud specs,
`l10n:check`, `build:place` at CX6). **Pending:** CX11, the owner's Studio check (none of the UI, sound, remotes or
DataStore behaviour has run in Studio yet; see "Studio check") and the sound (`sfx.codex.new` is SILENT, no fallback).
Owner answers: CXD5 (2026-11-03: veterans start nearly empty, the onboarding `seen` list is the only seed) and CXD1
(2026-11-12: client claims, server stores). The owner said "proceed with implementation" (2026-11-12): CXD2..CXD4 and
CXD6..CXD15 are accepted as recommended; the lead's resolutions of the CX0 findings are R1-R14 (below). Siblings:
`claude/build-online-plan.md` (BO, not built: only its hook exists), docs/RUN_RECAP.md (RR: the run-over row is built
here, CX9), docs/TREASURE.md (chest relics).

Goal: give every run a second reason to go deeper, beyond score. A **Codex** on the main menu lists everything the game
has: boons, evolutions, duos, relics, curses, boosts, enemies, champion affixes and bosses. Each entry starts as a dark
`???` tile. It is **seen** the first time it shows up (a draft card, a Greed altar's curse, a drop, an enemy on screen)
and **found** the first time you take it, pick it up or defeat it. The first time something is found a small **NEW!**
marks it in the run, the main menu's Codex button shows a badge, and the run-over panel says `3 new in the Codex`.
Completion shows as a percentage. **No gameplay power at all.**

**Presentation plus one server doc.** No sim, dungeon, lockstep, hash, replay, fixture or score change: everything is
read from state the views already read. New: one per-player DataStore doc (`KV_Codex_v1`), four remotes (one push, three
client calls), 54 theme strings, one port audio ID, one menu screen. Scoring, leaderboards, records, drafts and their
odds are untouched (the Codex never changes what is offered).

## What already existed (and is reused)

| Piece | Before the Codex | Where |
|---|---|---|
| First sightings (the seed) | Per-account `seen` list in `KV_Onboarding_v1` (`SIGHTING_IDS`: imp, slime, summoner, bomber, charger, stormcaller, warbanner, reaper, golden, `affix.<id>`, `pellet.power`); remote `bestiarySeen(id)` (client claims, server records; `BESTIARY_SEEN_RATE` 10 / 10 s) | shared/onboarding, OnboardingService |
| Sighting card | `SightingController` + `SightingQueue` (one card at a time, 5 s + 0.75 s gap; waits on a draft / pause; never in the tutorial, under the stage cover or after run over), `sightingsInView` (VIEW player, radius 9), line `bestiary.<id>`; drawn by `SightingCard` (left edge), not ToastPanel | client/controllers/game, shared/view/sighting, client/ui/hud |
| Records doc pattern | `PlayerDocCache`, `MergeKeyValue` (UpdateAsync with a merge transform; no-op writes in Studio), `seeded` marker, `KV_Fake*` Studio fake, `{ loaded: false }` on a failed load | shared/settings, shared/records, server RecordsService |
| Content | 20 boons (9 common / 7 rare / 4 legendary), 16 evolutions (theme keys only), 20 duos, 4 relics, 4 curses, 4 boosts (Fury, Quickstep, Frenzy, Aegis), 11 endless room kinds + the Goldling, 4 affixes, 2 bosses (Mother Mayhem `boss.act1`, the Demon Lord) | sim progression / builds / drops / affixes, dungeon endlessData, fortune |
| Toasts | `SimController.pushToasts` (run events boon / relic / curse / boost / ... -> `toastFor`) into ToastPanel; treasure reward cards | client, shared/view/hud |
| Item art | `runItemCells` / `itemCellArt` (icons in vale, text labels in the placeholder), boost icons, enemy / boss sprite sets, `ui.icon.help` | shared/view/hud, shared/view/sprites.ts |
| Menu | `MenuScreen` stack, `CreditsScreen` (the model), `MenuButton` (no badge), the phone two-per-row layout with `fit.spec` | client/ui/menu, shared/view/menu |

Three facts shape the design: (1) the game already trusts the client for harmless facts (sightings, tutorial
completion), and the Codex grants and ranks nothing (CXD1); (2) there is no history to seed from but the sightings list
(CXD5), so a veteran's first run finds 20+ entries and a toast budget keeps it readable (CXD8); (3) most "first times"
already toast, so the Codex decorates those toasts instead of adding a second one (CXD7).

## Player experience

### Entry states

| State | Tile | Detail panel |
|---|---|---|
| **Unknown** | dark frame with `ui.icon.help` (`???` without it); enemies and bosses show their sprite still as a black silhouette | `???` and one hint line (below) |
| **Seen** | the art faded (`CODEX_SCREEN.seenTransparency` 0.55; not desaturated: ImageLabel has none) | name, kind line, description / tell, `Seen` |
| **Found** | full art | name in its role colour, kind line, description / tell, `Found on floor 7 · 3 Nov 2026` (zero parts skipped: `foundFloor` / `foundDate` / `foundAny`) |
| + **NEW dot** | a `uiAccent` dot in the corner: its tier rose since you last looked | cleared when the tile is hovered, tapped or selected |

What counts (for **you**: sightings follow the VIEW player, so spectating counts; finds are the LOCAL player's):

| Category | Seen | Found |
|---|---|---|
| Boon | dealt to you on a NEW / UPGRADE card | owned (any level) |
| Evolution | its EVOLUTION card dealt to you | level reaches III (`BOON_MAX_LEVEL`: NEW -> I, UPGRADE -> II, EVOLUTION -> III) |
| Duo | its duo card dealt to you | owned |
| Relic | **never** (R1: pedestal and chest both draw on the take; seen = found) | owned (pedestal or a Rare vault chest) |
| Curse | a Pact of Greed altar card names it to the view player (R2) | accepted by you (Greed or the tutorial's classic shrine: seen = found there) |
| Boost | a ground drop of that kind near the view player | running on you (`activeBoosts`, state, not the snapshot's view-player boosts) |
| Enemy | a living one near the view player | one dies while you are in the run (party kills count; slimelets count for the Ooze; the Goldling = caught) |
| Affix | an affixed enemy near the view player | an affixed enemy of that kind dies while you are in the run |
| Boss | engaged | defeated |

Hints on unknown tiles: enemies `Lurks deeper in the dungeon` (R3: no floor number, unlock floors differ between endless
and the Daily); affixes `Champions from floor {floor}` (from the affix unlock data: Hulking and Swift 4, Shielded 7,
Vengeful 9); bosses `Waits every {every} floors` (`BOSS_FLOOR_EVERY`); evolutions `Take {boon} three times` once that
boon is found, else `???`; duos `Recipe: {a} + {b}` once both boons are found, else `Combine two boons`; boons, relics,
curses, boosts `???`. Weapon-gated entries (Piercing Arrows, Ballista, Riposte, Mirror Cloak, their evolutions and
duos) count toward 100 % and show `Knight only` / `Archer only` in the detail (R7).

### In the run (small, never over the fight)

- **Decorated toasts** (no new toast): a ToastPanel toast whose entry is found for the first time ever on that frame
  (a boon, `Volatile evolved: Cataclysm`, a duo, a pedestal relic, a curse, a boost pickup) gets a `NEW!` chip and a
  second line `Added to your Codex` (`uiTextDim`). A first-sighting card (`Imp: watch the ring`) gets the chip whenever
  the entry rose this run (always shown, outside the budget).
- **Codex toasts** (only where nothing else toasts) on the **sighting card's slot**: `NEW! {name} · Codex` with the
  entry's 16 px tile art, `sfx.codex.new`. For the first kill of an enemy or affix kind, the first sightings of the
  floor-1 kinds with no bestiary line (swarmer, sniper, bruiser), a relic from a vault chest (no relic toast exists:
  always shown), a boss defeated (always shown). One at a time with the sightings (a queued sighting goes first), the
  same gates. At most one codex toast per entry per run (a swarmer's sighting toast suppresses its kill toast).
- **Budget** (CXD8): `CODEX.toastsPerFloor` (2) codex toasts and budgeted chips per floor (boon / curse / boost chips,
  pedestal relics, enemy / affix kills, floor-1 sightings); evolution / duo chips, chest relics and boss kills always
  pass and never spend it. The rest are silent and still count on the run-over line.
- **Draft cards**: a card whose entry is not yet found wears a small `NEW` tag (top right, `uiAccent`) once its flip has
  settled (`textAlpha` 1), so the reveal's beats are unchanged.
- Silent cases: a draft deal, a drop seen, a Greed card, a boss engage.

### Run over

The run-over panel has a Codex row (all three layouts): `3 new in the Codex` (`run.codex.newOne` for one), up to
`CODEX.recapIcons` (5) tiles of this run's found entries in the order found (one frame's finds ranked legendary, duo,
evolution, boss, rare, other), `+N` after the fifth, then `Codex 41%`. Found entries only; hidden when nothing was
found, when the Codex is not loaded or for a run that cannot claim.

### Main menu and the Codex screen

- **Codex button** right after Leaderboard (R10; desktop: a full button; phone: a small button between the invite
  reason and Credits), badge = entries with a NEW dot (`9+` above 9). Greyed while the Codex is unavailable (desktop
  label `Codex unavailable`); enabled while still loading.
- **Screen** (MenuScreen `codex`, menu skin): title and completion `41%` with a bar; tabs Boons, Evolutions, Duos,
  Relics & Curses, Boosts, Bestiary, each `found/total` with a NEW dot; the grid (columns from the panel width, boons
  by rarity, sub-headers Relics / Curses and Enemies / Champions / Bosses); the detail panel follows focus (art, name
  in its role colour, kind line `Rare boon` / `Evolution of {boon}` / `Duo` / `Champion` / `Boss`, the draft text or
  `bestiary.<id>` / `codex.desc.*`, a duo's two boons (`???` while unknown), the Seen / Found line, the R7 tag).
  Gamepad: LB / RB tabs (clamped), the first tile is the default, B back. Upright phone: the detail is a sheet under
  the grid and the tab row scrolls. Leaving the screen sends the cleared dots (`codexViewed`), so the badge drops.

### Rules

- **Which runs claim** (`codexEligibility`): endless and the Daily (solo or co-op) with toasts; the tutorial silently
  (R8; its turrets and dummy are not entries); never M1 (`game` / `dungeonNoEncounter` / `greybox`), the `dev` world,
  a run started with `KV_Debug` on (`SimController.isDebugRun()`), a dev or stress run (R9). Private servers and Studio
  claim (Studio: the session cache only).
- **Co-op:** each client claims for its own player; a teammate's take does not count for you, a party kill does; a
  player who left claims nothing after leaving (the frame's `left` is sticky for the run).
- **Before the doc is loaded** the tracker holds what it sees and shows no NEW (never a false NEW); the first loaded
  status turns the held entries that are new against it into claims (silent; they count as new this run). A failed load
  (`loaded: false`) greys the button and drops the run's claims.
- **Reduced motion:** chip and tag without a pop. Particles off: no change. SFX volume covers `sfx.codex.new`. No
  setting (CXD13).

## Data (server)

Full detail: docs/SERVER.md "Codex".

- **DataStore** `KV_Codex_v1` (`CODEX.dataStore`), key `u_<UserId>`: `{ v: 1, seeded?: true, e: { [entryId]: [tier,
  day, floor] }, unread?: string[] }`; `tier` 1 seen / 2 found, `day` the UTC day it was first found (0 while seen),
  `floor` 1..`CODEX.floorMax` 999 (0 while seen), `unread` the ids with a NEW dot. 86 entries, under 3 KB. Unknown ids
  decode away from the session / display doc; decoding never throws. The store transform keeps well-formed unknown
  entries (a newer server's) and their dots untouched (rollout-safe, review fix M1).
- **Entry ids** `<category>:<key>` (the theme id minus its prefix): `boon:swiftStrikes`, `evo:sharpened`,
  `duo:fireArrows`, `relic:mirrorCloak`, `curse:frailty`, `boost:fury`, `enemy:swarmer`, `enemy:slime`, `enemy:golden`,
  `affix:hulking`, `boss:act1`, `boss:demonlord`. Catalog order is append-only (a lock list in `catalog.spec.ts`).
- **Merge** (`mergeCodex` / `mergeStoredCodex`): per entry the higher tier wins, two founds keep the earlier day (and
  its floor), `seeded` kept once either side has it, `unread` the session's plus stored-only rises. Every write is a
  `MergeKeyValue` UpdateAsync, so two servers (teleport, rejoin) never lose an entry.
- **Seed** (CXD5, R13): once, the onboarding doc's cached `seen` list -> seen entries without NEW dots (`imp` ->
  `enemy:imp`, `golden` -> `enemy:golden`, `affix.swift` -> `affix:swift`; `pellet.power` and unknown ids dropped). It
  waits (<= `CODEX.seedWaitSeconds` 30) for `OnboardingService.joinLoadState(player)`; a failed or late onboarding load
  leaves `seeded` unset (retried next join) and the Codex works meanwhile. No extra DataStore read.
- **Remotes** (shared/network.ts): server -> client `codexStatus(CodexStatus { loaded, entries?, unread?, seeded? })`,
  once after the join load and seed and in answer to `requestCodex()`; client -> server `codexClaim(items: { id, tier,
  floor }[])` (<= `CODEX.claimMaxItems` 16, catalog ids, tier 1 or 2, floor clamped, the server stamps the day;
  idempotent, a lower tier never wins) and `codexViewed(ids)` (<= `CODEX.viewedMaxIds` 64). Each remote 10 calls / 10 s
  per player (`CODEX.claimRate`); oversize calls are refused whole; nothing is echoed (the client applies its own claims
  with `applyClaims` / `markViewed`); claims before the load or after a failed one are ignored.
- **Trust** (CXD1): the server records what the client claims after the id / tier / size / rate checks; nothing is
  replayed. A cheater can fill their own Codex, which harms nobody while it grants nothing.
- **Budget:** +1 GetAsync per join; writes only through `PlayerDocCache` (autosave when dirty every
  `CODEX.autosaveSeconds` 120, leave, BindToClose with `CODEX.shutdownSaveSeconds` 25, one save after a seed).
- **Studio:** writes are no-ops unless `CODEX.writeFromStudio`; `KV_FakeCodex` (Workspace string: `all`, `seen`,
  `none`, `unknown` = `loaded: false`, or a list `boon:volatile:2,enemy:imp:1`) replaces the loaded doc for the session.
- **Client pacing** (`CodexOutbox`, `CODEX_OUTBOX`): claims and views queue until the first `loaded: true`, collapse per
  id to the highest tier, flush at most every 2 s (hurried at run over and when the screen closes), each remote at most
  5 calls per 10 s (under the server's 10).

## Design (as built)

| Piece | Where | Step |
|---|---|---|
| `CODEX_CATALOG` (86 rows `{ id, tab, group, order, nameKey, descKey, artRef, hint, requires? }` built from BOONS, the boon evolutions, DUOS, RELICS, CURSES, the boost kinds, `ENDLESS_ROOM_KINDS` + `golden`, the affixes, `ENDLESS_BOSSES`), `CODEX_TABS` / `CODEX_GROUPS` / `CODEX_TAB_GROUPS`, `codexEntry`, `isCodexId`, `catalogTotal(tab?)`, `codexTabEntries`, `codexDescKeys`, the id mappers (`codexBoonId`, `codexEvoId`, `codexDuoId`, `codexCardId(card, kind?)`, `codexRelicId`, `codexCurseId`, `codexBoostId`, `codexEnemyId`, `codexAffixId`, `codexBossId`) | src/shared/codex/catalog.ts | CX1 |
| `CODEX` tunables, `CODEX_RETRY`, `KV_FakeCodex`; `CodexDoc` codec (`CODEX_CODEC`), `mergeCodex`, `applyClaims(doc, claims, day, markUnread)`, `markViewed`, `codexFoundCount`, `codexDay`, `seedFromSightings`, `decodeCodexClaims` / `decodeCodexViewed`, `mergeStoredCodex`; `CODEX_POLICY` / `codexEligibility` / `codexWritesAllowed`; `parseFakeCodex` | src/shared/codex (config.ts, doc.ts, policy.ts, fake.ts) | CX2 |
| `CodexService` (PlayerDocCache, seed from OnboardingService's cache, the remotes, MergeKeyValue, BindToClose), `OnboardingService.joinLoadState`; `codexStatusOf` / `codexDocOfStatus` / `codexClaimUpdate` / `codexViewedUpdate` / `seedCodexDoc`; docs/SERVER.md "Codex" | src/server/services/CodexService.ts, OnboardingService.ts, src/shared/codex/status.ts, src/shared/network.ts | CX3 |
| `CodexFrame` (`readCodexFrame`, `pushCodexDeath`, `clearCodexFrameEvents`) and the pure `CodexTracker` (`receive`, `startRun` / `endRun`, `update` -> `{ rises, codexToasts, chips }`, `showsNewTag`, `codexNewThisRun`, `sightingChip`, `codexRunSummary`), `codexToastRoute`, `codexSummaryRank`, `codexSightingId` | src/shared/view/codex (frame.ts, tracker.ts) | CX4 |
| Theme: `CODEX_STRING_KEYS` (54, spread last into `REQUIRED_STRING_KEYS`), `CODEX_AUDIO_IDS` = `sfx.codex.new` (last in `PORT_AUDIO_EVENTS`, SILENT in the placeholder, no `SFX_FALLBACK`), tab / group / kind / requires key helpers; English in the placeholder manifest (vale inherits); 54 `l10n/context.json` entries | src/shared/theme/codex.ts, contract.ts, packs/placeholder/manifest.ts, l10n/context.json | CX5 |
| `CodexOutbox`, `codexUnreadCount` / `codexProgressOf`; `CODEX_HUD_STRINGS`, `CODEX_CHIP` / `codexChipScale`, `codexToastEntryId` / `codexToastChip`, `codexToastNameKey`, `codexSeenSightings`; SightingQueue `learn` / `claimSlot`; store slice `codex`; `CodexController` (`ToastChipSource` for SimController); `ToastView.codexNew` / `codexId`; `CodexChip`; ToastPanel / SightingCard chips; `SFX.codexNew` (priority 46); footprint rows | src/shared/codex (outbox.ts, progress.ts), src/shared/view/codex/toasts.ts, src/client/store/codex.ts, src/client/controllers/fx/CodexController.ts, client/controllers/game (SimController, SightingController), client/ui/hud (CodexChip, ToastPanel, SightingCard), shared/view/audio/cues.ts, shared/view/hud/footprint.ts | CX6 |
| `CODEX_SCREEN` / `codexGridColumns` / `codexGridGroups` / `codexDetail` / tab helpers / `codexCompletionPct` / `codexBadgeText`; `codexTileArt(pack, entry, state)` (icons / sprite still / affix ring / label / unknown), `codexStillFrame`; `CodexArt`, `CodexScreen`, `MenuButton.badge`, the main menu button, `MenuController.openCodex`, `MenuActions.openCodex` / `codexViewed` | src/shared/view/codex (screen.ts, art.ts), client/ui/hud (CodexArt.tsx, primitives.tsx), client/ui/menu (CodexScreen.tsx, MainMenu.tsx, MenuLayer.tsx, actions.ts), shared/view/menu (nav, skin, padActions, config) | CX7 |
| `DraftNewTags` / `DRAFT_NEW_TAG`; DraftRevealController flags at `begin`, `DRAFT_UI.cards[i].newTagT` / `newTagScale`; DraftOverlay `NewTag` | src/shared/view/codex/draftTag.ts, client/controllers/fx/DraftRevealController.ts, client/ui/hud (DraftOverlay.tsx, draftUi.ts) | CX8 |
| `codexRecapRow` / `codexRecapRowLines` / `codexRecapRowHeight` / `codexRecapIconsWidth` / `CODEX_RECAP`, `codexSummaryHas` (BO hook); `CodexRunRow`; RunOverPanel `ROW.codex` | src/shared/view/codex/recap.ts, client/ui/hud (CodexRunRow.tsx, RunOverPanel.tsx) | CX9 |

### Not changed

- The sim, scoring, leaderboards, records, drafts and their odds.
- The sighting cards' text and timing (EV12): they gain the chip and share their slot with codex toasts.
- The onboarding doc: `bestiarySeen` still writes `seen` (the SightingController still fires it); the Codex only reads
  it once for the seed and keeps its own catalog-wide sighting map (R11).

## As built (2026-11-12)

Per step (commits `665d70f`, `5be1d84`, `b30dd2e`, `f951bc8`, `51ef63d`, `c5b9c5d`, `774bd6f`, `fff8225`, `a502d33`):

- **CX1 Catalog.** 86 entries: boons 20, evolutions 16, duos 20, relics & curses 8, boosts 4, bestiary 18 (12 enemies
  incl. the Goldling with `slime.small` folded into the Ooze, 4 champions, 2 bosses) (R5). Not in v1: the power pellet,
  pacts, vault tiers, characters, weapons, turrets, the dummy. `order` is data order (the screen sorts boons by rarity).
- **CX2 Doc core.** The seed applies with `markUnread = false` (seeded entries show no NEW dot). Day 0 / floor 0 mean
  unknown (the found line skips them).
- **CX3 Service.** As the plan, plus: the status waits for the seed (an early `requestCodex` is answered by the join-end
  push, up to ~30 s after join); the seed reads OnboardingService's cache, gated by the new `joinLoadState`; a failed
  load sends `{ loaded: false }` for the session and never writes. `CodexService.getDoc(player)` exists but is unused.
- **CX4 Tracker.** Pure and frame-driven: the caller fills deaths (FX `killed`), pedestal relics (run events), boss
  engage / defeat and run over. One rise per id per frame at its highest tier; floor = the frame's floor for found, 0
  for seen. **Relic seen = found** (R1); **curses are seen through Greed altar cards** (`greedCurseFor` while
  `pactCardsNear` and the altar is available to the view player), the plan's "stood in the shrine's zone" dropped (R2).
- **CX5 Theme.** 54 strings; plural style `run.codex.new` (n >= 2) / `run.codex.newOne` (LD7's singular key); five
  codex-only descriptions where no tell existed (`codex.desc.enemy.swarmer` / `.sniper` / `.bruiser`,
  `codex.desc.boss.act1` / `.demonlord`, R6); **no enemy floor hint** (`codex.hint.enemy` "Lurks deeper in the dungeon",
  R3); the boss hint reads `BOSS_FLOOR_EVERY`. `contract.luau` / `validate.luau` top-level locals 187 / 197 (were 186 /
  197; limit 200). Specs that skip a feature's tail (fortune, treasure, runRecap, boosts, audio, contract) now skip the
  Codex's tail too (`CODEX_AFTER`): a later feature appending to `REQUIRED_STRING_KEYS` / `PORT_AUDIO_EVENTS` must update
  `codex.spec`'s `tail` and those skips. Rebased onto main's floor modifiers (docs/FLOOR_MODIFIERS.md FM7), whose
  eleven strings and five stings sit just before the Codex's: floorModifiers.spec skips the Codex's tail (`CODEX_AFTER`)
  and the other specs skip both; `SFX_PRIORITY` 46 for `sfx.codex.new` (the stings took 67, no collision). Then onto
  main's Goldling rumours (docs/GOLDLING_RUMOURS.md GR6 / GR7): their two sounds and two chip strings sit between the
  floor modifiers' and the Codex's (fortune.spec's rumour tails and floorModifiers.spec skip the Codex's too; priorities
  45 / 66, no collision). The hidden Goldling is no actor until a player breaks its piece, so `enemy:golden` is seen
  only once it is out (unchanged); the rumour card's sighting id `golden.rumour` maps to no entry (the seed drops it,
  `codexSightingId` / `sightingChip` give nothing; doc.spec / tracker.spec pin it).
- **CX6 Controller and store.** The tracker frame runs inside `SimController.pushToasts` (`ToastChipSource`), so chips
  match that frame's toasts. **Kills count one frame late**: FxTracker runs after the sim, so a kill or a
  `bossDefeated` lands in the next sim frame's update (the run's last update waits for that frame's FX instead: m4). **A first boost decorates `hud.toast.boost` with the chip**
  (route `chip`), not a codex toast (the plan's codex toast would have doubled the existing toast). **Codex toasts use
  the sighting card's slot** (SightingCard, left edge) instead of a separate toast, so they inherit its queue and gates;
  they show whether or not the onboarding status loaded. After a seeded `codexStatus`, the Codex's sightings are
  unioned into the sighting queue's seen set (`codexSeenSightings`). Claims flush on Heartbeat (works in the menu too).
  The store copy is updated locally on every claim / view (no server echo).
- **CX7 Screen.** **Codex button after Leaderboard** (not "between Leaderboard and Tutorial": not adjacent in the
  real order); **on phones a small button between the invite reason and Credits** (the reason shrinks by one small
  button), `fit.spec` covers the last row, the desktop menu one button taller and the screen at landscape compact,
  desktop and a 360 pt upright phone. **The NEW dot clears on activation (click, tap, A) or after the tile held the
  focus (hover, pad selection, the default selection on open) for `CODEX_SCREEN.viewDwellSeconds` 0.6 s**
  (`CodexViewDwell`, review fix m6; locally at once; the server hears at screen close). `MenuButton` gained `badge?` (the `MENU_VIEW.buttonBadge` pill). Sprite stills draw idle frame
  0 facing 270 degrees, the whole cell (`art.ts`, kept out of `sprites.ts` for its Luau locals); silhouettes are the
  same image tinted black.
- **CX8 Draft tag.** Flags are taken at the deal (`showsNewTag(codexCardId(offer, kind))`), the tag shows when the
  card's `textAlpha` reaches 1; the reveal's timings spec is unchanged.
- **CX9 Hooks.** RR had no slot in code (only a sentence in docs/RUN_RECAP.md), so CX9 added `ROW.codex` 13 to
  RunOverPanel (exits 14, verdict 15, info 16, padHints 17): wide / narrow under the daily block (narrow on two lines),
  compact in the left column above the exits. **While the Codex row shows, the compact run-over stats column's line gap
  is 2 instead of 6** (`MENU_FIT.runOverLineGap`) to keep the 693 x 320 record-daily worst case fitting; runs without
  the row keep the old layout (review fix m10). BO's first-fire callout does not
  exist in code: only the hooks are exported (`codexSummaryHas`, `CodexController.codexNewThisRun`); BO adds `NEW TO
  YOUR CODEX` (a new string) when it is built.
- **Review fixes** (commit after `15872b0`):
  - **M1 rollout-safe merge.** `mergeStoredCodex` passes stored entries whose ids this catalog does not know through
    untouched when well-formed (`isCodexIdShape`: `CODEX_ID_SHAPE` `^%a%w*:[%w_]+$`, at most `CODEX_ID_MAX_LENGTH` 64
    bytes; a mark `decodeCodexMark` reads), with their unread ids; malformed ones still drop. Only the session /
    display doc drops unknown ids. A doc holding only a newer server's entries is not rewritten.
  - **M2 rejoin during a leave save.** CodexService waits (bounded, `CODEX.rejoinWaitSeconds` 30 / `rejoinPollSeconds`)
    for the same UserId's release before the join load, tracks one owning Player per entry (only the owner's leave
    releases it; a release that finds a newer owner reloads it) and never sends a status from a missing entry.
    `notReady` refusals log once per player. PlayerDocCache is unchanged; RecordsService / SettingsService share the
    exposure (docs/SERVER.md "Codex").
  - **m1.** `requestCodex` over the rate gets no answer; drop warnings throttled to `CODEX.warnRate` (1 / 10 s / player).
  - **m2.** A status sets the local copy's dots to the server's minus the views still queued (`CodexOutbox.pendingViews`)
    plus this session's rises the server has not stored (`codexReceivedDoc`), not a union.
  - **m3.** A load after the run's summary froze moves the held finds of that run into it: the tracker rebuilds the
    frozen summary (also when it froze unloaded) and CodexController dispatches `setCodexRunSummary` again.
  - **m4. The run's last frame counts its events.** On the frame the run is over or the local player left, the tracker
    still collects that frame's deaths / `bossDefeated` (never its state) before it ends; CodexController runs that
    last update after the frame's FX events (FxTracker `onFrame`), so the buffered kills and the kill that ended the run
    count (a boss kill on the run-over frame is found). An exit before it runs the update at `endRun`.
  - **m5.** `readCodexFrame` / `pushCodexDeath` reuse pooled actor views (`actorPool` / `deathPool` in the buffer), and
    CodexController skips the frame read (and buffers no kills) while `CodexTracker.isCounting()` is false (an
    ineligible run, a failed load).
  - **m6.** Viewed dwell (above, CX7).
  - **m7.** The run-over row's width is estimated (`codexRecapRowWidth`: the texts at `HUD_VIEW.smallText` by
    `ROOM_CLEAR_VIEW.tallyFit.glyphAspect` per byte, the icons, the Row gaps; no text-width constant existed in the
    run-over fit specs, so the room-clear tally's HUD-font advance is used). `codexRecapRowFit`: one line when it fits
    the column, else one line with fewer icons (down to `CODEX_RECAP.minIcons` 1; a second line would overflow the
    693 x 320 record-daily worst case), else two lines (always upright). fit.spec counts the worst English row
    (`86 new in the Codex`, `+N`, `Codex 100%`) through it.
  - **m8.** A codex toast's tile art is drawn in the tier its entry rose to (`codexToastTiers` on the tracker output,
    `ToastView.codexTier`, `codexToastArtState`): a swarmer's sighting toast shows the seen art.
  - **m10.** The compact stats gap change applies only with the row (above); CodexScreen's `1e-6` is `MIN_TAB_SCALE`.
- **Not done** (v1 gaps): gamepad focus does not wrap in the grid; no names under tiles (the detail shows the name);
  seen tiles are faded, not desaturated; the Codex is not on the pause menu (CXD15).

## Tasks

- [x] **CX0. Confirm the assumptions.** Findings pass against `main` `677b5b1` (counts, relic / curse visibility, keys,
  enemy unlocks, sightings, debug gate, menu, theme locals); resolved by R1-R14.
- [x] **CX1. Catalog.** Spec: every endless entity exactly once, no tutorial / M1-only kind, unique stable ids, every
  name / desc key in both packs, append-only order lock.
- [x] **CX2. Doc core.** Codec round trip and junk, merge (tier up only, earliest found day, unread union minus viewed,
  commuting merges), seed mapping, policy (endless, daily, co-op, tutorial, M1, debug, Studio), fake parser.
- [x] **CX3. CodexService.** Studio fakes, claims before load ignored, failed load never overwrites, rate / size limits,
  seeded once, BindToClose, docs/SERVER.md.
- [x] **CX4. Tracker.** Per-category specs (spectating, party kills, slimelets, a leaver), baseline, budget, gates,
  `newThisRun` / summary ordering.
- [x] **CX5. Theme.** Contract / placeholder / vale specs; Luau locals 187 / 197.
- [x] **CX6. CodexController and store.** `build:place`; outbox batching and resend after a late load; sighting chip.
- [x] **CX7. Codex screen.** Pure specs (columns, tab counts, hints per state, art), fit specs.
- [x] **CX8. Draft tag and toast chip.**
- [x] **CX9. Sibling hooks.** Run-over row; BO hook exported.
- [x] **CX10. Docs.** This doc, docs/CLIENT.md, docs/SERVER.md, the CLAUDE.md decision log.
- [ ] **CX11. [owner] Studio check and sound.** The Studio check below; audition `sfx.codex.new` (Ninja Adventure UI /
  Menu folder: a soft chime or page turn, about 0.4, never a jingle, never ducks the music), `audio:lock`,
  `audio:build`, upload, id into `packs/vale/assetIds.ts` (and a vale `audioLayout` entry).

## Studio check

1. `KV_FakeCodex = "none"`, endless floor 1: the first swarmer / sniper / bruiser sightings give `NEW! Swarmer · Codex`
   cards on the left (two at most on the floor; the rest only on the run-over line); the first draft's cards all wear
   `NEW` after their flips; taking one decorates the boon toast with the chip and `Added to your Codex`.
2. `seen`: an Imp's first sighting shows the existing tell card with the chip; killing one is silent if the budget is
   spent, else a codex card. A boost pickup decorates its boost toast.
3. A duo or evolution taken for the first time: the chip always (outside the budget). A Rare vault chest's relic: a
   codex card. A boss kill: a codex card. Check the kill-toast one frame after the kill reads fine.
4. Run over: `3 new in the Codex` (and `1 new ...`), the icon strip with `+N`, `Codex n%`, in wide / compact / narrow;
   a run that found nothing: no row. Compact layout with the tighter 2 px line gap.
5. Main menu: the badge count (`9+`); the screen's tabs, counts, dots and completion; hovering / tapping / selecting
   tiles clears dots; closing drops the badge. Duo recipe hints only once both boons are found; evolution hints once
   the boon is found; enemy silhouettes are dark shapes, not readable art; `Knight only` / `Archer only` tags.
6. Co-op (two clients): a teammate's take does not count for you; a party kill does; spectating sightings count; a
   Greed card seen while spectating names the teammate's curse.
7. A run with `KV_Debug` on claims nothing; the dev world and M1 claim nothing; the tutorial records silently (check
   the menu after its outro: swarmer / sniper / bruiser found, no turret or dummy).
8. `unknown`: the button greyed `Codex unavailable` (phone keeps `Codex`); no NEW anywhere in a run.
9. Published place with the fakes off: the seed from `seen` (no dots), rejoin keeps every entry, a second server
   (teleport) merges without loss; a claim made right after join (before `codexStatus`) is resent.
10. Touch upright (sheet under the grid, tab row scroll), HUD 70 %, gamepad only (LB / RB, B back), Reduced motion.
11. Studio-only items from the build: the tab row's `CanvasPosition` scroll under UIScale (`scrollTabsTo`); sprite
    still crops at tile size (the whole cell is drawn: may look small, worst for the Demon Lord's 256 px cells); the
    badge overflowing the button edge; the draft `NEW` tag against the legendary flare; seen tiles' fade reading as
    "seen" without desaturation; the grid without focus wrap.
12. Risks to check first: toast clutter on a veteran's first run, text fit of long names (`Chain Reaction`,
    translations) in the detail and the run-over row.

## Decisions

CXD5 (2026-11-03) and CXD1 (2026-11-12) are the owner's answers; the rest were accepted as recommended (2026-11-12).

- **CXD1. Client claims, server stores** (owner, 2026-11-12). Matches first sightings and the tutorial, no replay work,
  NEW plays the moment it happens. Rejected: server-derived discoveries from the replay (NEW only at the verdict, the
  tutorial and unranked runs never count, the validator would need a collector). Revisit if a milestone ever unlocks
  something.
- **CXD2. Two tiers, seen and found**; completion counts found.
- **CXD3. Found means yours:** your takes and pickups, party kills while present.
- **CXD4. Its own DataStore `KV_Codex_v1`**, seeded once from onboarding's `seen`.
- **CXD5. No inferred seeding** (owner, 2026-11-03). Rosters are seeded per run, so a deep record proves nothing.
- **CXD6. The tutorial records silently.**
- **CXD7. Decorate existing toasts; add a codex toast only where none exists.**
- **CXD8. Toast budget 2 per floor**; boss / duo / evolution (and chest relics, R1) always shown.
- **CXD9. A NEW tag on unfound draft cards** (information, not odds).
- **CXD10. Recipe hints** for duos once both boons are found; evolution hints once the boon is found.
- **CXD11. No new art in v1:** item cells, boost art, sprite stills, `ui.icon.help`; silhouettes by tint.
- **CXD12. One sound, `sfx.codex.new`,** only on codex toasts; chips and tags are silent.
- **CXD13. No setting.**
- **CXD14. Debug runs and M1 claim nothing; private servers and the Daily do.**
- **CXD15. Codex button on the main menu only** (not the pause menu) in v1.

Lead resolutions of the CX0 findings (2026-11-12):

- **R1. Relics:** seen = found; a vault chest's relic gets a codex toast (always shown); pedestal relics decorate their
  toast.
- **R2. Curses:** seen from a Greed altar card for the view player; found when the local player accepts (Greed or the
  tutorial shrine); the shrine-zone rule dropped.
- **R3. Hints:** no enemy floor hint (`codex.hint.enemy`); affixes from the unlock data; bosses from `BOSS_FLOOR_EVERY`.
- **R4. Names:** theme names everywhere (the first boss is Mother Mayhem, not "Mother Bramble").
- **R5. Catalog v1:** boons 20, evolutions 16, duos 20, relics 4, curses 4, boosts 4, the endless room kinds (Ooze with
  slimelets) plus the Goldling, affixes 4, bosses 2; the seed maps `golden` and drops `pellet.power`.
- **R6. Codex-only descriptions** `codex.desc.<entryKey>` only where no description / tell exists; context entries for
  every new string.
- **R7. Weapon-gated entries** count toward 100 % with `Knight only` / `Archer only` in the detail.
- **R8. Tutorial:** silent; turrets / dummy are not entries.
- **R9. Debug gate:** `KV_Debug` at run start (`SimController.isDebugRun()`), the `dev` world and M1, dev / stress runs;
  the "replay / spectate-only client" rule dropped (no such client).
- **R10. Menu:** Codex after Leaderboard; `MenuButton.badge`; `fit.spec` green on the phone layout.
- **R11. Sightings:** the Codex keeps its own catalog-wide sighting map; the SightingCard keeps its lines and gains the
  chip.
- **R12. Run over:** CX9 adds a Codex row to `RunOverPanel` (all three layouts).
- **R13. Onboarding:** `OnboardingService.joinLoadState` tells the seed whether the join load finished OK.
- **R14. Toasts:** `ToastView.codexNew` set in `SimController.pushToasts`; the draft tag shows once `textAlpha` is 1.

## Risks

- **Toast clutter** on early floors and a veteran's first run. Mitigation: CXD7, CXD8, the sighting card's single slot
  and gaps.
- **A NEW tag biasing picks** toward weaker unknown boons. Acceptable (it ends once found); watch run depth.
- **Sprite stills** at tile size for big rigs (whole cell drawn). Mitigation: a per-entry `artRef` crop override.
- **One frame late kills**: a kill's codex toast or chip lands a frame after the kill (invisible at 60 Hz; check).
- **Client trust** (CXD1): anyone can fill their own Codex. Harmless while it grants nothing.
- **Rollout overlap:** old servers still write onboarding `seen`; the seed runs whenever `seeded` is unset and later
  sightings arrive through the Codex anyway.
- **Luau locals:** `validate.luau` 197 / 200, `contract.luau` 187; new required-key lists must be built inside
  functions.
- **Spec coupling:** the theme specs that skip the Codex's tail must move when a later feature appends strings or audio
  ids.

## Later (not in this plan)

- Cosmetic unlocks from Codex milestones (25 / 50 / 75 / 100 %, a full tab): outline colours, roll trails, guard spark
  colours. Would want server-derived discoveries (CXD1's alternative) first.
- BO's `NEW TO YOUR CODEX` callout line (the hook exists: `codexSummaryHas` / `codexNewThisRun`).
- Per-entry stats (times taken, kills, best floor with it), a "favourite build" line.
- More categories: chests and vault tiers, pacts, the power pellet, characters, weapons and skins.
- Pause-menu access, a "new this week" tab, telemetry for Codex opens and completion, lore lines per entry.
- Grid focus wrap, names under tiles, true desaturation for seen tiles.

## Secret rooms (2026-11-13)

docs/SECRET_ROOMS.md SRD12 appends ONE entry `secret:room` ("Secret rooms") in a new group `secrets`, the Bestiary tab's
last section (a seventh tab did not fit the desktop row); the catalogue is 87 entries (order lock updated). Seen at the
local player's first knock on a crack (`CodexFrame.secretKnocked`; the sighting `secret.crack` maps to it), found at an
open (`secretOpened`), both from `readCodexSecrets`; its tile is a `label`. Its sounds follow `sfx.codex.new` in
`PORT_AUDIO_EVENTS` (codex.spec's tail updated).
