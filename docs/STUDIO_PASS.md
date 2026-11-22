# The Studio pass

Every check in `docs/*.md` that needs Roblox Studio, a second client, a gamepad, a phone, the Mac's art packs or the
published place, merged into one ordered checklist. It replaces walking 61 plan docs: run it top to bottom, once. Built
on 2026-11-21 from the open tasks listed in docs/OPEN_TASKS.md and the pending notes of docs/DECISIONS.md; the table
of every task and where it went is docs/OPEN_TASKS_TRIAGE.md.

## How to record results

1. Run a line. If it holds, put an `x` in its box here (`[x]`). If it does not, leave the box and write what you saw
   under the table (one line, with the line's number).
2. A source task is closed when **every** line that names it is ticked: the "Closes" column says which part of the
   task a line covers ("PC solo", "co-op", "emulator half"). Then tick the task in its own doc and write measured
   numbers where the task asks for them (most say docs/SPIKES.md).
3. `log: <entry>` in "Closes" is a pending note in docs/DECISIONS.md with no checkbox of its own: when its lines
   are ticked, edit that sentence of the entry.
4. When a session is done, run `npm run tasks:open` and commit the docs. The boxes in this file are table cells, so
   the generator does not count them as open tasks (`scripts/check-open-tasks.test.js` holds that).

Every open task ends in one of three states:

| State | Meaning | What to do |
|---|---|---|
| **done** | The check held, or the repo proves the work | Tick the task in its source doc |
| **won't do** | Superseded or no longer wanted | Tick it and append `(won't do: <the decision>)` to the task's line |
| **issue** | Real work is left | File the GitHub issue (commands at the end of docs/OPEN_TASKS_TRIAGE.md), tick the task and append the issue number |

A line that fails becomes an issue with the label `studio-check` (`device` for session 4B), named after the line.

No durations are given: the plans give a basis for three lines only (1A-1: a 10-minute script; 1C-1: a tutorial run of
4-6 minutes; 1E-24: a 10-minute run).

"Switch" is the debug attribute, seed or dev-panel step the source doc names; `none` means the default game. Where a
line cites a numbered list ("Studio check" 1-3), the list in that doc has the detail.

## Session 1: solo, PC, Studio

Setup: `npm run dev`, Studio connected through Rojo, Play solo (F5). Workspace attributes are set before Play
(docs/SPIKES.md "Turning a spike on"; the table in docs/CLIENT.md "Workspace attributes"); the dev panel is **F2**
(docs/DEV_MODE.md). `KV_Debug` gives K (take a hit), M (drop a boost), N (next floor). A run with `KV_Debug` on claims
nothing for the Codex, so line 1E-21 runs with it off.

### 1A. Engine spikes (no run needed, each off by default)

| | # | Do, and look for | Switch | Closes |
|---|---|---|---|---|
| [ ] | 1A-1 | Throwaway LocalScript (never committed; docs/CURSOR.md budgets 10 minutes): `MouseIconEnabled = false` and an ImageLabel at `GetMouseLocation()` from a `Last` render step. Write the five answers (a)-(e) into docs/CURSOR.md "As built". | none | CURSOR C0 |
| [ ] | 1A-2 | The UI art spike panel at 720 / 1080 / 1440 p, UIScale 0.6-1.75, HUD scale 70 / 125 %: borders on whole pixels, no gutter bleed at 1 px, crisp inside a CanvasGroup, whether a stretched noise centre needs `flat`. Four answers into docs/SPIKES.md "Results: UI art (UA1)". | `KV_UiArtSpike` | UI_ART UA1 |
| [ ] | 1A-3 | The localization sheet: (a) glyphs per script and font, (b) Arabic shaping and right-to-left, (c) CJK and Thai wrapping, (e) the `AutoLocalize` defaults. One line each into docs/SPIKES.md "Results: localization (L0)". | `KV_L10nSpike` | SPIKES L0 (a), (b), (c), (e); log: Localization |
| [ ] | 1A-4 | Sprite bullets at 100 / 500 / 1,000 / 2,000, rings and spiral, modes N / A / B / C, quality 1 and 10: fps, update ms, worst frame; blur, lighting, draw order. Go if the best mode holds 60 fps at 1,000 + 200 bullets with an update at most 1.5x the neon baseline. Numbers into docs/SPIKES.md "Spike PA0". | `KV_SpikeBullets` | PROJECTILE_ART PA0 (PC half; emulator half is 4A-1) |
| [ ] | 1A-5 | A mocked product purchase: the receipt handler fires and honours the product id filter; the enums and receipt field types as used; `PriceInRobux` on the client; `PromptProductPurchaseFinished`'s arguments; any refund signal. Results into docs/SPIKES.md. | products configured, `KV_FakeShop` unset | SILVER_SHOP SH0 (the pad over the prompt is 3-4) |

### 1B. Main menu and menus (no run)

| | # | Do, and look for | Switch | Closes |
|---|---|---|---|---|
| [ ] | 1B-1 | Cold join: loading bar, then the main menu with the bone ornament and hover brackets. Options, every tab: the chosen value is the red bar; HUD scale 70 % and 125 % stay crisp. Resize 720 p -> 1080 p -> 1440 p -> full screen: pixels stay square. Switch the pack to `placeholder`: the flat UI, unchanged. (docs/UI_ART.md "Studio smoke test" 1-3, 9.) | none | UI_ART UA15 (menus); log: UI art |
| [ ] | 1B-2 | Gauntlet cursor on menus: docs/CURSOR.md "Studio smoke test" 1, 6, 8-11 (yellow over buttons, the Roblox menu on Esc, alt-tab, the resize steps, Cursor size, Reduced motion), then 13 on a fresh join. | `KV_SystemCursor`; `KV_FakeAssetLatency` for step 13 | CURSOR C8 (menus); log: Gauntlet cursor |
| [ ] | 1B-3 | Codex screen: badge count, tabs, dots, completion, hints, silhouettes (docs/CODEX.md "Studio check" 5); with `unknown` the button reads `Codex unavailable` (8). | `KV_FakeCodex` = `seen`, then `unknown` | CODEX CX11 (menu) |
| [ ] | 1B-4 | Armory: buy Vigor I and see the next goals marked; unlock the Archer at 300 on the character screen; `unknown` greys the Armory with the notice; a tier 8 title asks to confirm, buys and equips. (docs/SILVER.md "Studio check" 3, 4, 7, 8.) | `KV_FakeWallet` = `"0"`, `"unknown"`, `"6000"` | SILVER SV15 (Armory) |
| [ ] | 1B-5 | Armory > Cosmetics: the preview turns through its facings, a focused dye is tried on before buying, buy / equip stamps, Prismatic cycles (held at its first stop under Reduced motion); then one floor with a dye on: the knight still reads against floor and bullets. (docs/COSMETICS.md "As built: Armory (CS6)".) | `KV_FakeWallet` preset | COSMETICS CS9 (solo) |
| [ ] | 1B-6 | Silver shop: no `+` without products; with the fake prices the `+` on the main menu and in the Armory, four prices, a press grants once; `unknown` hides it; no shop anywhere inside a run. (docs/SILVER_SHOP.md "Studio check" 1-5, 7.) | `KV_FakeShop` = `"20,55,115,265"`; `KV_FakeWallet` = `"unknown"` | SILVER_SHOP SH9 (Studio half) |
| [ ] | 1B-7 | Language `en-XA` over every menu and one run: long names wrap, nothing clips; then a real language switch from Options. | Options > Language | log: Localization (Studio check) |
| [ ] | 1B-8 | Loading and stand-ins: the smoke tests in docs/PRELOAD.md, docs/STAGE_LOADER.md and docs/STAGE_ASSETS.md (join screen, floor cover, stand-ins that swap live). | `KV_FakeAssetLatency`, `KV_StandInsForce`, `KV_StageAssetAudit` | log: Stage assets |

### 1C. Tutorial, start to finish

| | # | Do, and look for | Switch | Closes |
|---|---|---|---|---|
| [ ] | 1C-1 | A fresh tutorial, timed (target 4-6 minutes): docs/TUTORIAL.md "Studio smoke test" 1-7 and 9. Tune `bossHpPercent`, the prompt wording and the dummy hp. | `KV_ResetOnboarding` (or `KV_Tutorial`) | TUTORIAL T8 (PC) |
| [ ] | 1C-2 | The floor chevron: docs/TUTORIAL_ARROW.md "Studio check (A5)" 1-5; it reads on the frost floor 1 and on floor 2's biome and never sits on the guard fan in a lesson room. | `KV_Tutorial` | TUTORIAL_ARROW A6 (PC) |
| [ ] | 1C-3 | The map lesson: docs/TUTORIAL_MAP.md "Studio check (TM5)" 1, 2, 4, 5, 7, 8 (prompt before the treasure room, waived when ignored, steps 12-17 in the echo). | `KV_Tutorial`, `KV_AnalyticsDebug` | TUTORIAL_MAP TM7 (keyboard); log: Tutorial map lesson |
| [ ] | 1C-4 | Combat A's training dummy: size and feet against the hitbox, the wobble after each swing, the finisher's burst, the rim on the darkest tutorial floor (the list under docs/DUMMY_ART.md DA7). Sign off DD1 and DD5. | hitbox debug view | DUMMY_ART DA7 (PC); log: Training dummy art |
| [ ] | 1C-5 | Tutorial enemies: combat F's two sprayers and the turret room's sniper against their own bullets and the telegraph tint, rim on and off; feet on the pivot; the hit flinch, the corpse, the respawn after 6 s (the lists under docs/DEMON_ART.md DA14 and docs/SNIPER_ART.md SN7). | `KV_EnemyOutline` on / off, hitbox debug view | DEMON_ART DA14 (tutorial); SNIPER_ART SN7 (tutorial) |
| [ ] | 1C-6 | The tutorial boss: each wind-up and release lines up with the previews, the slam lands on the shockwave, roars read, bullets stay readable over the sprite, the sprite sits under previews, markings and bullets (the list under docs/BRAMBLE_ART.md BR6; BR5). | hitbox debug view | BRAMBLE_ART BR5, BR6 (tutorial boss) |
| [ ] | 1C-7 | Overlays in the tutorial: highlight rings and the ghost heart land on the right element; floor 2's draft with its prompt; room edges light in order with the arrow over them; the minimap from the first frame; room G's pellets and sweep lock; after the outro the Codex shows swarmer / sniper / bruiser found, no turret or dummy. | none | HUD_LAYOUT H9; UI_ART UA15; DRAFT_REVEAL DR9; CODEX CX11 (tutorial steps); log: Pellets |
| [ ] | 1C-8 | The funnel echo: every onboarding step and lesson event prints once, in order, for one tutorial run and one skipped run. | `KV_AnalyticsDebug` | log: Tutorial analytics funnel (Studio half) |

### 1D. The M1 world

| | # | Do, and look for | Switch | Closes |
|---|---|---|---|---|
| [ ] | 1D-1 | F5 in the M1 world: the corner map shows only what is in sight and whole rooms on entry (docs/MINIMAP.md "Studio check" 1); dashed lines at every corridor mouth turn live and back (docs/ROOM_EDGES.md "Studio check" 1); no full-width band (docs/HUD_LAYOUT.md "Studio check" 1); the sandbox sprayer and caster (DA14's list); hit flash, hold and push on swings. | `KV_World` = `game` | MINIMAP M11; ROOM_EDGES RE8; HUD_LAYOUT H9; DEMON_ART DA14; FEEL J12 (M1 parts) |

### 1E. An endless run, floors 1-5 (one floor per biome)

| | # | Do, and look for | Switch | Closes |
|---|---|---|---|---|
| [ ] | 1E-1 | Walk each of floors 1-5, then again at decor bands 0-3: every biome reads at the game camera and enemy bullets stand out against the textured walls and floor tiles (no seams at wall joins, telegraph rings readable on molten floors); decor, breakables with their yellow outline, graves and the 3D kit pieces sit right and never hide a bullet. | `KV_DecorBand` 0-3, `KV_DecorDebug` | DECOR Studio check (line 394), R5 (the Studio look); log: Molten / Frost / Grim / Verdant tiles, 3D kit decor (both), Solid decor, Room themes, Graves, Breakable outline |
| [ ] | 1E-2 | The void on the same floors (N on through floors 1-16 for the bands): shoulders meet walls with no gaps or z-fighting, pieces stand on the shoulder top, nothing covers a bullet, motes only over open abyss and none under Reduced motion; the `[Void]` line's part count and build time; both void attributes toggle live and leave nothing behind after a floor change. Settle VDD5, VDD6, VDD8. | `KV_DecorBand`, `KV_VoidOff`, `KV_VoidDebug` | VOID_DECOR Studio checks (lines 254, 332, 373, 410, 423), VD11 (PC solo); log: Void decoration |
| [ ] | 1E-3 | Themed rooms: bookcases read as bookcases with their backs to the wall, the reading area reads as a desk with chairs, libraries and mess halls read as rooms, bullets never hide behind tables or stock, walkers and the Charger get round the pieces, the minimap shows shelf runs as wall (docs/BOOKSHELVES.md "Studio check"; KN13's list). | none | BOOKSHELVES BK8, RA6; KENNEY_DECOR KN13 (PC); log: Bookshelves, Kenney bookcases, Kenney Forge pieces |
| [ ] | 1E-4 | Enemy and player art in bruiser, sniper and mixed rooms: the style mix, readability on the darkest floor and band with the rim on and off, drawn size against the hitbox, feet planted, the smash on its ring; the player's 1 px rim next to the enemy rim. Sign off DD2, DD4, DD5; decide E3. (Lists under DEMON_ART DA7 and SNIPER_ART SN7; docs/CLIENT.md "Enemy outlines" and "Player outline" smoke steps.) | `KV_EnemyOutline`, `KV_PlayerOutline`, hitbox debug view | DEMON_ART DA7; SNIPER_ART SN7; OUTLINE O6; PLAYER_OUTLINE P7 (PC solo); log: Player outline |
| [ ] | 1E-5 | Bullets on every biome and in the stress rings at 1,000 and 2,000: enemy bullets read at a glance on the darkest floor, player shots never read as danger, the hot core covers the hitbox, turning and the end-of-life shrink; goo puddles, the strike flash and scorch, embers. Sign off PAD4-PAD10. (List under PROJECTILE_ART PA9.) | `KV_Stress` = 1000, 2000; hitbox debug view | PROJECTILE_ART PA9 (PC solo); log: Projectile art, Goo art, Hazard art |
| [ ] | 1E-6 | The sprite renderer and effects as shipped: rects address the pixels exactly, no white fringe, no clipping into walls behind or in front (tune `depthBiasStuds`), no floor seams; every effect cue fires once where it should, the style fits and no effect is mistaken for a bullet (check the swing and guard headings). Write fps and GraphicsTexture memory down. | Developer Console > Memory | ART S0, S5 (PC solo); FX_AUDIO F0, F5 |
| [ ] | 1E-7 | Boosts: drop each kind four times on each biome floor. Each drop reads next to bullets, decor and the pedestal; the stack blinks and fades together; the aura rings per stack rank; the HUD row drains, blinks and resets on refresh; the Aegis pip breaks on a hit; Reduced motion holds still. (Lists under BOOSTS B6 / B7 and BOOST_ART BA5.) | `KV_Debug`: M drops, K hits | BOOSTS B6, B7; BOOST_ART BA5, BA6 (PC solo); log: Boost auras, Boost icons |
| [ ] | 1E-8 | Loaded barrels and crates: the soft glint is noticeable, any break releases the boost, a far bow break leaves the gem to fade. | `KV_LootDebug` | log: Boosts from breakables (Studio check) |
| [ ] | 1E-9 | Room edges: waiting, live and safe looks on an endless floor, the Off setting, no z-fighting (docs/ROOM_EDGES.md "Studio check" 2, 5, 6); the `[RoomEdges] built N dashes` print and the frame time on the worst floor; live near-white never reads as the sword blade in a doorway. Tune dash size and lift. | `KV_Debug` | ROOM_EDGES RE7, RE8 |
| [ ] | 1E-10 | Minimap: fog, the stairwell mark only once seen, enemies and drops only in sight, the full map on M, the Off setting, the corner fade (docs/MINIMAP.md "Studio check" 2, 3, 5-7). Does it ever show something the player should not know? Tune `sightTiles`, zoom and tints on all five biomes. | none | MINIMAP M11; log: Minimap |
| [ ] | 1E-11 | HUD at 1080p, 1440p and 21:9: no full-width band, each corner panel fades as the knight or a bullet reaches it, the info line only in the pause menu, the swap hint (docs/HUD_LAYOUT.md "Studio check" 1-4); hearts, flask, armor pips, combo, weapon slots, score and the pause / run-over panels in the new art (docs/UI_ART.md "Studio smoke test" 4, 6); walk past every corner in biomes 1-5: a bullet behind a panel edge still reads. | none | HUD_LAYOUT H9 (PC); UI_ART UA12, UA15; log: HUD-side Armor pips |
| [ ] | 1E-12 | Feel: each hit kind, a combo into a finisher on a bruiser, the roll's squash and ghosts, Reduced motion, Screen shake off, the low-health pulse, then the risks list (docs/FEEL.md "Studio check" 1, 2, 4-6, 8). Tune `FEEL`; decide whether player bullet streaks (J10) are wanted. | none | FEEL J12 (solo), J10 (decision) |
| [ ] | 1E-13 | Combo: the tier slams, the climbing kill sound, the shatter and the quiet lapse, the crack on a hit, Reduced motion and HUD 70 % (docs/COMBO.md "Studio check" 1, 3, 4, 6, 7). Tune `KILL_PITCH`, `COMBO_VIEW`, `COMBO_SHOUT` by ear and eye. | `KV_ComboDebug` = `1`..`4`, `break`, `small`, `lapse`, `cut` | COMBO CB9 (solo) |
| [ ] | 1E-14 | Room clear: the slow motion, the stamp, the tally ending on the true total, CLEAR against PERFECT, the collapses, the Off settings, the risks list (docs/ROOM_CLEAR.md "Studio check" 1-3, 5, 6). Tune `ROOM_CLEAR` inside the 1.5 s. | none | ROOM_CLEAR RC10 (solo) |
| [ ] | 1E-15 | Draft reveal: the deal and flips, the legendary beat, a shared beat, skipping, Reduced motion, then the engine assumptions (docs/DRAFT_REVEAL.md "Studio check" 1-3, 6, 8). Tune `DRAFT_REVEAL`. | `KV_DraftRevealDebug` = `"c,l,r"`, `"l,l"`, `"r"` | DRAFT_REVEAL DR9 (solo); log: Draft reveal |
| [ ] | 1E-16 | Grazes and parries: the graze spark and climbing shimmer, parry sparks, the ring-out, `PARRY!`, the solo 30 ms freeze (docs/GRAZE_PARRY.md "Studio check"). | none | log: Grazes and parries |
| [ ] | 1E-17 | The cursor through a run: over the stage cover, pause and resume, the draft, the run-over panel and Again (docs/CURSOR.md "Studio smoke test" 2-5). | none | CURSOR C8 (run) |
| [ ] | 1E-18 | Item tooltips: pause on a floor 6 build and hover every kind; in live play aim near the top-left corner while swinging: no tooltip, no lost swing; none while the panel is faded; the run-over list; HUD 70 % and `en-XA` (docs/ITEM_TOOLTIPS.md "Studio check" 1, 4, 5, 7, 8). Record what the shipped tooltip answers of IT0 (a)-(c) in docs/SPIKES.md. | `KV_Debug` boosts; dev panel floor 6 | ITEM_TOOLTIPS IT11, IT0 |
| [ ] | 1E-19 | New best and the recap: the points-to-best row, the fanfare as the shown number passes the target, the floor cards, a run below the best, Reduced motion and HUD 70 % (docs/NEW_BEST.md "Studio check" 1, 3, 5, 7, 8); decide NBD8 (the confetti). Then die near the stairs and near the best: the near-miss line, highlights, mashing through the death, Details (docs/RUN_RECAP.md "Studio check" 1, 2, 4-6, 9). Tune `RECAP` from five solo runs. | `KV_NewBestDebug` = `score:2000`, `floor:2`, `first`, `unknown`, `score:5000` | NEW_BEST NB10, NB0; RUN_RECAP RR10 (solo) |
| [ ] | 1E-20 | Silver in a run: 2 hearts at the start, the counter ticking per room clear, the run-over rows and the top-up, twinkling pieces bursting into coins, a second run the same day; then the risks list (docs/SILVER.md "Studio check" 1, 2, 12). | `KV_FakeWallet` = `"0"`, `KV_SilverLabel` | SILVER SV15 (run) |
| [ ] | 1E-21 | Codex in a run, **`KV_Debug` off**: first-sighting cards (two a floor at most), `NEW` on draft cards, the chips on toasts, the run-over row, then the Studio-only items and risks (docs/CODEX.md "Studio check" 1-4, 11, 12). | `KV_FakeCodex` = `none`, then `seen` | CODEX CX11 (run) |
| [ ] | 1E-22 | Collision debug at a pillar and in an octagon room: blocking cells, notch edges, the body circle and its normal, the red flash on a stall. While there: does thin art on a full 1 x 1 cell (candle stand, chair, barrel) read as an invisible wall? | `KV_CollisionDebug` | WALL_SLIDE WS6, WS9 |
| [ ] | 1E-23 | Sword spacing on keyboard and mouse: hold a key at the enemy while clicking, the pointer on and past the enemy for the finisher, against a swarmer pack, a splitting Ooze, a Reaper and a bruiser's wind-up. Watch for a drift round the enemy, a stall between two, a finisher that feels short. | none | SWORD_SPACING SP7 (keyboard and mouse) |
| [ ] | 1E-24 | The mix at default volumes over a 10-minute run: hurt and telegraph always audible in a full room, shots never tiring, music under the effects, jingles duck cleanly, no click at a loop seam; Silver's four sounds. Write the settings back to `art/audio.json`. | none | FX_AUDIO A5 (PC) |

### 1F. Dev-panel jumps and named seeds

| | # | Do, and look for | Switch | Closes |
|---|---|---|---|---|
| [ ] | 1F-1 | Seed 2, floor 2 (altars in shrine room 10): altar cards readable from the doorway and under bullets, Greed's curse and its deal, the Horde chip, wave 2 and the x2 tally, the settings list (docs/FORTUNE.md "Studio check"). | `KV_PactLabel`, `KV_GoldenLabel` | log: Fortune (Studio check) |
| [ ] | 1F-2 | The Goldling's hiding place: seed 2 floor 2 (room 3, barrel at (60, 12)); seed 14 or 42 floor 2 (a loot piece in the same room: two glints); seed 44 floor 2 (also the vault room); any seed floor 1 (none). The rumour chips and jingles, the piece shrugging off enemy fire, the release on a break, a catch after the clear (docs/GOLDLING_RUMOURS.md "Studio check"). | `KV_GoldenLabel`, `KV_LootDebug` | GOLDLING_RUMOURS GR11 (Studio half) |
| [ ] | 1F-3 | Vaults from floor 2: first TR7's "Studio-only assumptions to check first", then the toast, the sparkle through the doorway, the lock cracking, the open sequence, a SWIFT countdown, a kept Legendary, bullets over the plate, the settings and risks (docs/TREASURE.md "Studio check" 1-5, 7, 8). Check the chest's and cage's facings on every wall, and a relic pedestal drawn as a chest. | `KV_Debug`, `KV_TreasureDebug` = `"every,legendary,untouched"` then `swift`, `KV_TreasureLabel` | TREASURE TR9 (Studio half); log: Treasure rooms, Relic pedestals as chests |
| [ ] | 1F-4 | Secret rooms from floor 3 as the Knight, the Knight with Wrecker, then the Archer; from floor 10 with a Charger; then seeds 1-10 without the override. Start with the "Look at first" list (crack against its wall, overlay orientation, the chamber's walls and torches) (docs/SECRET_ROOMS.md "Studio check"). | `KV_SecretDebug` = `every` (or `every legendary`), `KV_SecretLabel` | SECRET_ROOMS SR15 (Studio half) |
| [ ] | 1F-5 | Floor modifiers from floor 4, each kind in turn: the banner under the floor card, the status chip and its pulse, the pause line, the sting; then seeds 1-10 without the override (docs/FLOOR_MODIFIERS.md "Studio check"). On the Plunder floor, and on a floor with a vault, a secret and a Goldling: every twinkling piece pays exactly one thing (docs/SILVER.md "Studio check" 10). | `KV_FloorModifier` = `gilded`, `hoard`, `feast`, `plunder`, `blood moon`; `KV_Debug` | FLOOR_MODIFIERS FM12 (Studio half); SILVER SV15 (step 10) |
| [ ] | 1F-6 | The deep roster from floor 10, once per character, boons forced from the dev panel: every newer enemy's tells and art (variants and affixes, new enemies 1-3), the on-kill boons, evolutions, duos, legendaries and Builds v2 effects, the Archer's checklists (docs/ARCHER.md AR7-AR9), and the boon, relic / curse and duo icons (the banner row on the longest Evolution banner). | dev panel: floor 10, boons | log: Enemy variants, New enemies, New enemies 2, New enemies 3, Builds, Legendaries, Builds v2, The Archer, Boon icons, Relic and curse icons, Duo icons |

### 1G. Boss floors (the dev panel marks them; seed 1337's floor 5 is a Demon Lord floor)

| | # | Do, and look for | Switch | Closes |
|---|---|---|---|---|
| [ ] | 1G-1 | A Demon Lord floor: facing in all 16 directions, intro / taunt / death timing, the cleave arc and the large sprite never hiding bullets, drawn size against the hitbox (tune `bodyTiles`), half-res sharpness at 1080p, fps and GraphicsTexture memory. Numbers into docs/BOSS_DEMONLORD.md. | hitbox debug view | BOSS_DEMONLORD D7 (PC solo) |
| [ ] | 1G-2 | A Mother Mayhem floor: BR6's list (wind-ups against previews, roars, summoned skeletons, size against the hitbox, 1.5x upscale sharpness, bullets over the sprite with the rim on and off, fps and memory against S5's numbers) and BR5's draw order. Sign off BD1-BD4; record in docs/SPIKES.md. | hitbox debug view, `KV_EnemyOutline` | BRAMBLE_ART BR5, BR6 (PC solo) |
| [ ] | 1G-3 | On either boss floor: the boss bar and toasts fit the top centre at every HUD scale; room edges grey, live, dim; a combo tier-up and a NEW BEST shout inside a dense ring duck under the bullets; boss bullets and a sword fight at the boss; shake and ghosts on the Demon Lord's charge; die at low boss hp: the recap names what the boss had left. | none | HUD_LAYOUT H9; ROOM_EDGES RE8; COMBO CB9; NEW_BEST NB10; PROJECTILE_ART PA9; SWORD_SPACING SP7; FEEL J12; RUN_RECAP RR10 (boss parts) |

## Session 2: two clients on a local server

Setup: Test > Clients and Servers, 2 players, `KV_Debug` on; lines 2-9 and 2-10 need 3 and 4 clients. Dev runs are
solo, so every co-op check here is a lobby run.

| | # | Do, and look for | Switch | Closes |
|---|---|---|---|---|
| [ ] | 2-1 | Lobby and looks: each client sees the other's dye, outline, trail and title in the lobby and in the run. | `KV_FakeWallet` presets | COSMETICS CS7, CS9 (co-op) |
| [ ] | 2-2 | Tutorial and lobbies: Player1 fresh in the tutorial, Player2's Invite and Start answer `Finish your current run first`; no lobby run replaces a running tutorial (docs/TUTORIAL.md "Studio smoke test" 8). | Player1 fresh | TUTORIAL T8 (step 8) |
| [ ] | 2-3 | Name tags: just above each teammate's head, never your own; under bullets and telegraphs; below the feet by a far wall; dimmed near you and under fire; gone on death, spectating and run over; the Off setting; a 20-character name; the Display tab on a small laptop screen. | Options > Display > Player names | PLAYER_NAMES PN4 |
| [ ] | 2-4 | One endless run through floors 1-3 with every presentation feature on: the picker's boost aura on the other client; the shared map and teammate dots; room edges and combo on both; no slow motion and the far-clear chip; each client's own draft and "waiting for 1 teammate"; no global freeze; the cursor and party overlay; a teammate's Codex take not counting for you; each client's own best; the spectate bar and skull; the teammate's boost tooltip; enemy art, the teammate bullet fade and outlines in a party; the void in co-op. (The co-op step of each feature's Studio check.) | none | BOOSTS B6; MINIMAP M11; ROOM_EDGES RE8; COMBO CB9; ROOM_CLEAR RC10; DRAFT_REVEAL DR9; FEEL J12; CURSOR C8; CODEX CX11; NEW_BEST NB10; UI_ART UA15; ITEM_TOOLTIPS IT11; DEMON_ART DA7; SNIPER_ART SN7; PROJECTILE_ART PA9; ART S5; OUTLINE O6; PLAYER_OUTLINE P7; VOID_DECOR VD11 (co-op parts) |
| [ ] | 2-5 | Team moments: a room cleared with no hits gives `TEAM PERFECT` on both screens on the same tick with rings and a streak; both guarding one wave gives `SYNC!` and the tether; guards 0.5 s apart give nothing (docs/RUN_RECAP.md "Studio check" 7, 8). Tune `syncWindowTicks` from three co-op runs. | none | RUN_RECAP RR10 (co-op) |
| [ ] | 2-6 | Run over in a party, three runs: both open on You with the same team totals; die first and spectate; boss damage shares sum to 100 %; tabs never retry or exit; does any line read as blame? (docs/RUN_CONTRIBUTION.md "Studio check" 1-3, 6-8.) Set the title thresholds and wording. | `KV_AnalyticsDebug` | RUN_CONTRIBUTION CT10 |
| [ ] | 2-7 | Gameplay features in a lobby run: the vault's lock, crack and open on every client and every living player's reward card; a teammate's Greed freezing everyone; one Goldling seen by all and a teammate's break; a secret opened on the same tick with a share for each; the modifier banner on every client; one player owning the Archer and one not, each with their own hearts, no desync over three floors. | the attributes of 1F | TREASURE TR9; GOLDLING_RUMOURS GR11; SECRET_ROOMS SR15; FLOOR_MODIFIERS FM12; SILVER SV15 (co-op parts); log: Fortune |
| [ ] | 2-8 | A 2-player run to a Demon Lord floor and to a Mother Mayhem floor: the lists of 1G-1 and 1G-2 again, with the target pick in co-op. | none | BOSS_DEMONLORD D7; BRAMBLE_ART BR6 (2-player) |
| [ ] | 2-9 | Three clients: docs/SPECTATE.md "Studio smoke test" 1-7; again with Reduced motion on; a 2-player run where the only teammate dies. | `KV_Debug` (K) | SPECTATE S6 |
| [ ] | 2-10 | Four clients: cycle the spectate view through everyone; four boost drops at once (fps, no overlap mess); the vault at four; one player leaves on floor 2 (the dim `Left on floor 2` row); the Party list with a fake eight. | `KV_Debug` fake party if available | SPECTATE S6; BOOST_ART BA5; RUN_CONTRIBUTION CT10; TREASURE TR9 (4-player parts) |
| [ ] | 2-11 | Network simulation: first Incoming Replication Lag 100 ms (the per-member fires and the loopback check); then the 4G profile of the owner's first session twice, once as built and once with the late bump. Add the rows to a "Frame pacing" table in docs/SPIKES.md (FP0 starts it) (trips, lead, target, lates, bumps, `pred`) and answer FP21's open question on the `miss` criterion. | `KV_LeadBump`; `KV_PredictOff`, `KV_LeadOff`, `KV_PacingOff` for the A/B | FRAME_PACING FP21; log: Co-op frame pacing (Studio checks) |
| [ ] | 2-12 | On the same 4G link: the predicted Knight's stop against a chasing pack. | none | SWORD_SPACING SP7 (co-op) |

## Session 3: gamepad

Setup: An Xbox pad on the PC (a PlayStation pad too if there is one). Line 3-3 runs with the mouse unplugged.

| | # | Do, and look for | Switch | Closes |
|---|---|---|---|---|
| [ ] | 3-1 | The pad spike: the selection image, ScrollingFrame behaviour, what `SelectedObject` becomes, `SelectionBehavior`, `GuiService:Select`, the key images per pad, a held A / LB leaking into the sim, haptics support (the list under docs/GAMEPAD_MENUS.md GM0). Into docs/SPIKES.md "Results: gamepad menus (GM0)". | `KV_PadSpike` | GAMEPAD_MENUS GM0 |
| [ ] | 3-2 | Walk every surface pad-only at HUD scale 70 % and 125 %; add a `NextSelection*` only where geometry picks wrong and list each override in docs/GAMEPAD_MENUS.md. | none | GAMEPAD_MENUS GM8 (the portrait half is 4A-3) |
| [ ] | 3-3 | Mouse unplugged: join, the tutorial's outro, main menu, every Options tab with a rebind and a reset, leaderboards scrolled to 100, credits, a run (pause, leave confirm, draft, death, Details, Again); a locale switch while a button is selected; mouse and pad switching. With a second client: lobby create / invite / ready / kick / start, and an invite arriving mid-menu. | none | GAMEPAD_MENUS GM11; log: Gamepad menus |
| [ ] | 3-4 | Features on the pad: tutorial prompts show pad glyphs and the map lesson names D-pad left; RT skips the draft reveal; D-pad into the pause Build list and the tooltip follows focus (IT0 (d)); LB / RB and B in the Codex and on the run-over tabs; no pointer while the stick moves; A on a shop card, Roblox's prompt takes the pad, B returns to the `+`; the Armory's hold-to-buy; spectating pad-only. | none | TUTORIAL T8; TUTORIAL_MAP TM7; DRAFT_REVEAL DR9; ITEM_TOOLTIPS IT11, IT0; CODEX CX11; RUN_CONTRIBUTION CT10; CURSOR C8; SILVER_SHOP SH9, SH0; SILVER SV15; SPECTATE S6 (gamepad parts) |
| [ ] | 3-5 | Sword spacing with and without the right stick: nothing feels worse than on keyboard and mouse. | none | SWORD_SPACING SP7 (gamepad) |
| [ ] | 3-6 | The haptics spike on pads: `HapticEffect` against `SetMotor` on each pad, the feel of the small and large motors at the table's strengths, whether a 50 ms gap keeps the heart hurt's double buzz distinct. Into docs/SPIKES.md "Results: haptics in play (HP0)". | `KV_PadSpike`; `KV_HapticDebug` (the seven test cues) | HAPTICS HP0 (pad half) |
| [ ] | 3-7 | Haptics in play on floor 1 and both boss floors: kill ticks, parry thumps, the phase break, the death rumble, the duty cap, pause mid-rumble, the settings, the three hurts (docs/HAPTICS.md "Studio / device check" 1-5, 7, 10); with a second client, a teammate's events are silent (6); a pad on macOS 15+ is silent without errors (9). Tune `PLAY_HAPTICS`. | `KV_HapticDebug` | HAPTICS HP8 (pad half) |

## Session 4: phone (the Studio device emulator, then real devices)

Setup: 4A runs in Studio's device emulator (an iPhone landscape and upright, a small Android, a 4:3 tablet). 4B needs
the published place on a low-end Android, an iPhone and a tablet.

### 4A. Device emulator

| | # | Do, and look for | Switch | Closes |
|---|---|---|---|---|
| [ ] | 4A-1 | Line 1A-4's bullet spike again on the phone emulator, at quality 1 and 10. | `KV_SpikeBullets` | PROJECTILE_ART PA0 (emulator half) |
| [ ] | 4A-2 | The mobile smoke test, emulator steps (docs/CLIENT.md "Mobile" 1-3): no stock thumbstick, controls hide under overlays, one finger walks, attacks and rolls; then the whole tutorial on the touch layout. Tune `TOUCH` / `TOUCH_LAYOUT`. | none | MOBILE MB14 (emulator half); TUTORIAL T8 (phone layout) |
| [ ] | 4A-3 | Upright: menu, a run, pause (map on top), the draft in a column, the tutorial start to finish; rotate mid-run. Then a pad on the upright layout for the directional pass. | none | PORTRAIT PT9 (emulator half); GAMEPAD_MENUS GM8 (portrait) |
| [ ] | 4A-4 | Features on touch, landscape then upright, HUD 125 % and the smallest phone: the map lesson through pause; the arrow's on-screen inset; a tap skips the reveal and does not pick; the combo row, the stamp and tally; tooltips pin on tap; the Codex sheet and tab scroll; the Armory, the shop panel and the balance row; the vault toast wraps; both Goldling chips on the strip; the crack readable; the modifier chip heads the strip; the recap and the scrolling Party list; no panel in the clear zone on a phone or at 4:3. | none | TUTORIAL_MAP TM7; TUTORIAL_ARROW A6; DRAFT_REVEAL DR9; COMBO CB9; ROOM_CLEAR RC10; ITEM_TOOLTIPS IT11; CODEX CX11; SILVER SV15; SILVER_SHOP SH9; TREASURE TR9; GOLDLING_RUMOURS GR11; SECRET_ROOMS SR15; FLOOR_MODIFIERS FM12; RUN_RECAP RR10; RUN_CONTRIBUTION CT10; HUD_LAYOUT H9 (touch parts) |
| [ ] | 4A-5 | Art and budgets on the emulator: boost drop size; enemy, dummy and turret art and both outlines; fps and GraphicsTexture memory on both boss floors against S5's numbers (if the phone budget fails, the Demon Lord falls back to 8 facings); the `[Void]` part count; decor instances per floor (DecorController's report); room edges and the minimap readable, and the minimap's image created; 48 live effects; bullets at stress counts; a 10-minute run with sound. | `KV_Stress`, `KV_Debug` | BOOST_ART BA5; DEMON_ART DA7, DA14; SNIPER_ART SN7; DUMMY_ART DA7; OUTLINE O6; PLAYER_OUTLINE P7; BOSS_DEMONLORD D7; BRAMBLE_ART BR6; ART S0, S5; VOID_DECOR VD11 and the line 254 check; KENNEY_DECOR KN13; ROOM_EDGES RE8; MINIMAP M11, M0; FX_AUDIO F0, A5; PROJECTILE_ART PA9 (emulator parts) |
| [ ] | 4A-6 | Ten-foot: the HUD and the minimap on a TV-sized view; the console emulator's `IsTenFootInterface`, viewport size and TV-safe inset. Decide the default HUD scale. | Studio console emulator | HUD_LAYOUT H9; MINIMAP M11; GAMEPAD_MENUS GM0 (console signals) |

### 4B. Real devices

| | # | Do, and look for | Switch | Closes |
|---|---|---|---|---|
| [ ] | 4B-1 | The touch spike on a low-end Android, an iPhone and a tablet: fill docs/SPIKES.md "Results: touch input (MB0)" (stock touch GUI, InputObject identity, touch against GUI offset, mouse emulation, fps and memory on floor 1, a Demon Lord floor and under stress). Go / no-go on MBD4. | `KV_TouchSpike`, `KV_Stress` | MOBILE MB0; log: Mobile play |
| [ ] | 4B-2 | The same numbers with the controls on: 60 fps on the mid iPhone, at least 30 fps on the low-end Android on a Demon Lord floor. If a budget fails, the Effects setting. | none | MOBILE MB15 |
| [ ] | 4B-3 | Device steps of the mobile smoke test (three fingers, the bow latch, spectate Next / Prev, mirrored controls, touch sizes); then a first-time player finishes the tutorial and reaches floor 3 without help, once in landscape and once upright (needs a second person). Upright at graphics quality 1: no haze, shadow or LOD popping. | none | MOBILE MB14; PORTRAIT PT9 |
| [ ] | 4B-4 | Haptics on an iPhone and an Android phone: the shortest pulse that is felt, whether 25 ms reads as a tick, latency, a voice-chat place on iPhone, a pad on a phone (expect nothing); then kill tick, parry, stagger, death and the three hurts all felt and distinct, and Touch Off silences them (docs/HAPTICS.md "Studio / device check" 7-9). | `KV_HapticDebug` | HAPTICS HP0, HP8 (phone halves); log: Haptics in play |
| [ ] | 4B-5 | GPU texture memory on the iPhone with 0, 1 and 4 dyed players; it decides CSD4. | none | COSMETICS CS0 |
| [ ] | 4B-6 | Sword spacing on touch with auto-target on and off. | none | SWORD_SPACING SP7 (touch) |
| [ ] | 4B-7 | Stage assets on a device: the SA0 / SA20 measurements (how long stand-ins stay, the soft wait at run start). | `KV_StageAssetAudit` | log: Stage assets (device measurements) |
| [ ] | 4B-8 | Mixed devices: PC + phone, 2 and 4 players, Wi-Fi and cellular: no desync, the input lead settles, spectating and invites work on the phone. | published place | MOBILE MB16 |

## Session 5: the Mac with the art packs

Setup: The Mac, with `art/vendor/` in place (docs/ART.md, `art/README.md`). Nothing here needs Studio except the
uploads themselves.

| | # | Do, and look for | Switch | Closes |
|---|---|---|---|---|
| [ ] | 5-1 | `npm run art:build`, then `npm run art:lock`: every output byte-identical to what is uploaded, `pellet.png` and `pellet-power.png` included; a full build completes on the laptop. | none | PELLETS PL8; log: Projectile art (full `art:build`) |
| [ ] | 5-2 | `npm run verify` with every spec file on the Mac's aarch64 VM (or one green CI run of the whole suite). | none | KENNEY_DECOR KN11 |
| [ ] | 5-3 | Contact sheets by eye in `art/build/contact/`: `boss.act1.png` (pin each attack's wind-up and release frames; does Attack 3 looped read as the spiral; choose BD1); the Demon Lord's seven animations and facing order; `enemy.bruiser.png` (row order, shadow cut, Attack 4's impact frame, cell size); the boost frames at 29.6 px a tile on the five biome floors; the dye sheets for every animation and facing, with `exclude` rects for the Archer's bow. | none | BRAMBLE_ART BR1; BOSS_DEMONLORD D0; DEMON_ART DA1; BOOST_ART BA0; COSMETICS CS1 |
| [ ] | 5-4 | `npm run audio:audition`: listen to every pick still `"confirmed": false` in `art/audio.json` (91 today), set clip, gain and trim, and list the gaps that need another source (boss roar, wood break, a molten fire bed). Include New enemies 2's eight sounds. | none | FX_AUDIO A0; log: New enemies 2 (by ear) |
| [ ] | 5-5 | The Codex sound: audition `sfx.codex.new` (a soft chime or page turn, about 0.4), `audio:lock`, `audio:build`, upload, the id into `packs/vale/assetIds.ts` and a vale `audioLayout` entry. | none | CODEX CX11 (sound) |
| [ ] | 5-6 | Uploads the log still lists: the throne / statue / carpet art of the room themes, and anything `art/upload/` holds without an id in `assetIds.ts`. Then `npm run verify`. | none | log: Room themes (uploads), Legendaries (art and audio) |
| [ ] | 5-7 | Remove `art/vendor/lords-of-pain-demo/` once nothing reads it. | none | DECOR R5 (tail) |

## Session 6: the published place, live services and analytics

Setup: A private published test place (and the live one where a line says so), friend or alt accounts, the Creator
Hub. `KV_Fake*` attributes off.

| | # | Do, and look for | Switch | Closes |
|---|---|---|---|---|
| [ ] | 6-1 | Every audio ID plays in the published test place (private-asset permissions), not just in Studio. | none | FX_AUDIO A4 |
| [ ] | 6-2 | The invite spike's test script (docs/SPIKES.md "Spike I0"): confirm the API table row by row (server-side `PromptGameInvite`, where `GameInvitePromptClosed` fires, the landing server, LaunchData delay, `PartyId` at `PlayerAdded`, "join with party"). | `KV_InviteSpike` | INVITES I0 |
| [ ] | 6-3 | Creator Dashboard: create the invite notification string for the live and test experiences; paste the ids into `INVITE.notificationStringIds`. | none | INVITES I8 |
| [ ] | 6-4 | Two friend accounts (three for a party): invite from a lobby (Open and Closed), from the menu, to an offline friend who opens it 5 minutes later, to a full lobby, after the lobby closed; a Roblox Party of 3 joining. Record join times and failures; no `ANALYTICS_FAILED` from send to join. | none | INVITES I7, I9 |
| [ ] | 6-5 | One fresh alt: does `LogOnboardingFunnelStepEvent` take custom fields, do they filter, does the onboarding tab show; each kind in View Events. The signature into docs/SPIKES.md. | none | TUTORIAL_FUNNEL TF0 |
| [ ] | 6-6 | Publish, play 3-5 fresh accounts (keyboard, gamepad, phone), build the charts of "Questions this answers", write "Reading the dashboard" (sample sizes, the 24 h delay, cohorting). Every chart shows data. | none | TUTORIAL_FUNNEL TF9; log: Tutorial analytics funnel |
| [ ] | 6-7 | Localization on the published place: (d) `LocaleId` against `RobloxLocaleId` on client and server for a Spanish account on a French device; (f) the cloud table: auto-translate fills the uploaded entries, `{name}` is kept, the exact CSV header (docs/SPIKES.md "Creator Hub setup for (e) and (f)"). | `KV_L10nSpike` | SPIKES L0 (d), (f); log: Localization (Creator Hub steps) |
| [ ] | 6-8 | Persistence with the fakes off: a pre-update account gets the one-time card with records and Codex intact; rejoin keeps the Silver balance; a purchase survives a teleport; two servers pay the first-run bonus once; a server killed mid-verdict grants once or not at all (docs/SILVER.md "Studio check" 5, 9). The Codex seeds, keeps and merges (docs/CODEX.md 9). A record really saves (docs/NEW_BEST.md 4). The minimap's image creates on the published place. | `KV_FakeWallet`, `KV_FakeCodex`, `KV_FakeRecords` off | SILVER SV15; CODEX CX11; NEW_BEST NB10; MINIMAP M0 (published halves) |
| [ ] | 6-9 | The Silver shop rollout, in order: the codec live on every server (SHD7), the four products' names, icons and translations, publish, a mocked purchase and a buy-then-leave (docs/SILVER_SHOP.md "Studio check" 3, 5), the Dynamic Price Check, decide OC6, then one real Pouch: the audit entry, the Monetization dashboard's sale, the IAP source apart from gameplay (8). | none | SILVER_SHOP SH9; log: Silver shop |
| [ ] | 6-10 | Retry timing: solo endless, die, press Again after the arm, five times; write the five `[Recap] retry: press -> control` times and the `[Stage] run` split into docs/RUN_RECAP.md RR8 before choosing a lever. | `KV_RetryTiming` = true (`KV_Debug` adds the listeners line) | RUN_RECAP RR8 |
| [ ] | 6-11 | A measured co-op session with 2-4 friends: per client ping, batch inter-arrival times and sizes, offset spread, fps, the lead over time; trips p50 / p95 / max, lates, bumps, falls; once with the lead off; once with `BROADCAST_EVERY_TICKS` 1 if possible. Start the "Frame pacing" table in docs/SPIKES.md with these; confirm or edit the tunables and `LEAD`. | `KV_Debug`, `KV_LeadOff` | FRAME_PACING FP0, FP14 |
| [ ] | 6-12 | The same group plays: pacing on against off, the lead on against off, a 60 Hz and a 120 Hz+ screen, one phone. Do players notice; holds and lates per minute. Then decide whether the broadcast cadence (FP7) is needed, and note how the predicted knight feels. | `KV_PacingOff`, `KV_LeadOff` | FRAME_PACING FP6, FP15, FP7 (decision); LOCAL_PREDICTION optional playtest |
| [ ] | 6-13 | The Daily with two accounts: the same seed, roster and modifier banners; day-scoped boards, percentile and yesterday's podium; the DS0 spike's answers. | none | log: Daily dungeon |

## Not in this pass

Tasks that no Studio session can close are in docs/OPEN_TASKS_TRIAGE.md as `issue` (unbuilt plans, leftover docs,
playtests that need other players, tuning) or `won't do` (the rollback spike).
