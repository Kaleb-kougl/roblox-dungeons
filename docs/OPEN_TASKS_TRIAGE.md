# Open tasks: triage

A proposed closing state for each of the 171 open tasks docs/OPEN_TASKS.md listed on 2026-11-21 (before this pass
ticked 5), and for the 68 decision-log entries with a pending note. **A proposal: the owner closes.** Nothing here
was run in Studio, and a task is marked `done` only where the repository proves it.

| State | Tasks | Meaning |
|---|---|---|
| `studio-pass` | 110 | Closed by the lines of docs/STUDIO_PASS.md named in "Where" (all of them) |
| `issue` | 51 | Real work left: the issue key in "Where" (18 issues, commands at the end) |
| `done` | 5 | The repo proves it; ticked in its source doc in this pass |
| `won't do` | 5 | Superseded; proposed, **not ticked** |

Line numbers are the task's line in its doc at this commit.

## Tasks

| Doc | Task | Line | State | Where | Why |
|---|---|---|---|---|---|
| ART | S0 | 163 | `studio-pass` | 1E-6, 4A-5 | The go / no-go is moot (the sprite renderer shipped and its art is uploaded, docs/ART.md Status), but its measurements were never taken; they are asked on the shipped renderer. |
| ART | S5 | 230 | `studio-pass` | 1E-6, 2-4, 4A-5 | Pack, specs and uploads done (`assetIds.ts`); the Studio run with fps and memory is open. |
| BOOKSHELVES | BK8 | 188 | `studio-pass` | 1E-3 | The check; the tuning that follows it is issue T2. |
| BOOKSHELVES | BK9 | 189 | `issue` | A2 (`art-upload`) | Bookshelves: lectern or pedestal in big libraries, near-wall low shelf (docs/BOOKSHELVES.md BK9) |
| BOOKSHELVES | RA6 | 266 | `studio-pass` | 1E-3 |  |
| BOOSTS | B6 | 205 | `studio-pass` | 1E-7, 2-4 |  |
| BOOSTS | B7 | 208 | `studio-pass` | 1E-7 |  |
| BOOSTS | B8 | 211 | `done` |  | Art moved to docs/BOOST_ART.md (BA4 ticked, uploaded 2026-10-26); the four boost sounds have layouts in `packs/vale/audioLayout.ts` (`sfx.boost.collect` / `.drop` / `.expire` / `.aegisbreak`) and ids in `packs/vale/assetIds.ts`; `packs/vale/audio.spec.ts` holds the validator. |
| BOOSTS | B11 | 223 | `issue` | P1 (`playtest`) | Playtest: boosts and boosts from breakables (drop rate, contested drops, uptime) |
| BOOST_ART | BA0 | 157 | `studio-pass` | 5-3 |  |
| BOOST_ART | BA5 | 173 | `studio-pass` | 1E-7, 2-10, 4A-5 |  |
| BOOST_ART | BA6 | 176 | `studio-pass` | 1E-7 | Auras built and uploaded (BAD3); BA-P6's HUD icons exist as docs/BOOSTS.md "As built: boost icons". Only the Studio look is open. |
| BOOST_ART | BA7 | 178 | `done` |  | Each listed doc carries it: docs/BOOSTS.md B8 points here, docs/ART.md has the boost drop and aura rows and no gems decor row, docs/DECOR.md Status records "Gems are not decor", docs/CLIENT.md has "Drop art layers" and the BA3 / BA5 smoke steps, CLAUDE.md has the docs/BOOST_ART.md row. |
| BOSS_DEMONLORD | D0 | 138 | `studio-pass` | 5-3 | The contact sheet and facing order; "how a Studio test reaches a boss" is answered by docs/DEV_MODE.md. |
| BOSS_DEMONLORD | D7 | 320 | `studio-pass` | 1G-1, 2-8, 4A-5 | Sheets and the taunt clip are uploaded (`assetIds.ts`); the Studio half is open. |
| BOSS_DEMONLORD | D8 | 328 | `issue` | F3 (`follow-up`) | CLAUDE.md, the decision log and the theme README have it; docs/ART.md has no Demon Lord row and docs/CLIENT.md "Boss sprites" still says Mother Mayhem has no art. |
| BRAMBLE_ART | BR1 | 135 | `studio-pass` | 5-3 |  |
| BRAMBLE_ART | BR5 | 188 | `studio-pass` | 1C-6, 1G-2 |  |
| BRAMBLE_ART | BR6 | 193 | `studio-pass` | 1C-6, 1G-2, 2-8, 4A-5 | Spec part and upload done (2026-10-26); Studio open. |
| BRAMBLE_ART | BR7 | 209 | `issue` | F3 (`follow-up`) | docs/ART.md, DEMON_ART.md and BOSS_DEMONLORD.md are updated; docs/CLIENT.md still says Mother Mayhem stays a placeholder. |
| BREAKABLE_DROPS | BL7 | 154 | `done` |  | `sfx.breakable.loot` has a layout in `packs/vale/audioLayout.ts` and `sfx-breakable-loot.ogg` an id in `packs/vale/assetIds.ts`; `packs/vale/audio.spec.ts` holds the validator. |
| BREAKABLE_DROPS | BL9 | 160 | `issue` | P1 (`playtest`) | Playtest: boosts and boosts from breakables (drop rate, contested drops, uptime) |
| CODEBASE_SCALE | DX6 | 158 | `issue` | F5 (`follow-up`) | The doc says "Not built in this pass". |
| CODEX | CX11 | 290 | `studio-pass` | 1B-3, 1C-7, 1E-21, 2-4, 3-4, 4A-4, 5-5, 6-8 | `sfx.codex.new` has no layout or id yet (5-5). |
| COMBO | CB9 | 181 | `studio-pass` | 1E-13, 1G-3, 2-4, 4A-4 | Both clips are uploaded (`sfx-combo-tier.ogg`, `sfx-combo-break.ogg` in `assetIds.ts`); the check and the tuning by ear are open. |
| COSMETICS | CS0 | 167 | `studio-pass` | 4B-5 |  |
| COSMETICS | CS1 | 169 | `studio-pass` | 5-3 |  |
| COSMETICS | CS7 | 180 | `studio-pass` | 2-1 |  |
| COSMETICS | CS9 | 184 | `studio-pass` | 1B-5, 2-1 | The check; the playtest half is issue T2. |
| COSMETICS | CS11 | 187 | `issue` | F10 (`follow-up`) | "Not this pass". |
| COSMETICS | CS12 | 188 | `issue` | F8 (`follow-up`) | "Not this pass". |
| CURSOR | C0 | 287 | `studio-pass` | 1A-1 |  |
| CURSOR | C8 | 327 | `studio-pass` | 1B-2, 1E-17, 2-4, 3-4 |  |
| DECOR | "Studio check" | 394 | `studio-pass` | 1E-1 |  |
| DECOR | R5 | 422 | `studio-pass` | 1E-1, 5-7 | `decor-atlas.png` and `decor-mote.png` have ids in `assetIds.ts`, so the upload is done; the Studio look and the demo folder's removal are open. |
| DECOR | R7 | 483 | `issue` | F3 (`follow-up`) | Open by its own text: PROVENANCE, the log's D3 line, docs/CLIENT.md. |
| DECOR | R14 | 701 | `issue` | F3 (`follow-up`) | docs/CLIENT.md and the sim README are updated; docs/SERVER.md has no breakables replay-cost line. |
| DECOR | R15 | 706 | `issue` | P2 (`playtest`) | Playtest: decor, void and effects across biomes and depth bands |
| DEMON_ART | DA1 | 140 | `studio-pass` | 5-3 |  |
| DEMON_ART | DA7 | 210 | `studio-pass` | 1E-4, 2-4, 4A-5 |  |
| DEMON_ART | DA8 | 220 | `issue` | F3 (`follow-up`) | Open by its own text: docs/CLIENT.md. |
| DEMON_ART | DA14 | 316 | `studio-pass` | 1C-5, 1D-1, 4A-5 |  |
| DIFFICULTY | RS0 | 195 | `issue` | F1 (`follow-up`) | Not built: docs/DIFFICULTY.md Status says "Planned ... Nothing built" and `src/shared/sim` has no `respite` module. |
| DIFFICULTY | RS1 | 199 | `issue` | F1 (`follow-up`) | Not built: docs/DIFFICULTY.md Status says "Planned ... Nothing built" and `src/shared/sim` has no `respite` module. |
| DIFFICULTY | RS2 | 204 | `issue` | F1 (`follow-up`) | Not built: docs/DIFFICULTY.md Status says "Planned ... Nothing built" and `src/shared/sim` has no `respite` module. |
| DIFFICULTY | RS3 | 208 | `issue` | F1 (`follow-up`) | Not built: docs/DIFFICULTY.md Status says "Planned ... Nothing built" and `src/shared/sim` has no `respite` module. |
| DIFFICULTY | RS4 | 213 | `issue` | F1 (`follow-up`) | Not built: docs/DIFFICULTY.md Status says "Planned ... Nothing built" and `src/shared/sim` has no `respite` module. |
| DIFFICULTY | RS5 | 216 | `issue` | F1 (`follow-up`) | Not built: docs/DIFFICULTY.md Status says "Planned ... Nothing built" and `src/shared/sim` has no `respite` module. |
| DIFFICULTY | RS6 | 219 | `issue` | F1 (`follow-up`) | Not built: docs/DIFFICULTY.md Status says "Planned ... Nothing built" and `src/shared/sim` has no `respite` module. |
| DIFFICULTY | RS7 | 223 | `issue` | F1 (`follow-up`) | Not built: docs/DIFFICULTY.md Status says "Planned ... Nothing built" and `src/shared/sim` has no `respite` module. |
| DIFFICULTY | RS8 | 227 | `issue` | F1 (`follow-up`) | Not built: docs/DIFFICULTY.md Status says "Planned ... Nothing built" and `src/shared/sim` has no `respite` module. |
| DIFFICULTY | RS9 | 229 | `issue` | F1 (`follow-up`) | Not built: docs/DIFFICULTY.md Status says "Planned ... Nothing built" and `src/shared/sim` has no `respite` module. |
| DIFFICULTY | RS10 | 233 | `issue` | F1 (`follow-up`) | Not built: docs/DIFFICULTY.md Status says "Planned ... Nothing built" and `src/shared/sim` has no `respite` module. |
| DIFFICULTY | RS11 | 235 | `issue` | F1 (`follow-up`) | Not built: docs/DIFFICULTY.md Status says "Planned ... Nothing built" and `src/shared/sim` has no `respite` module. |
| DIFFICULTY | RS12 | 238 | `issue` | F1 (`follow-up`) | Not built: docs/DIFFICULTY.md Status says "Planned ... Nothing built" and `src/shared/sim` has no `respite` module. Its playtest belongs to the same issue. |
| DRAFT_REVEAL | DR9 | 226 | `studio-pass` | 1C-7, 1E-15, 2-4, 3-4, 4A-4 | The six `ui-draft-*.png` and the `sfx-draft-*.ogg` clips have ids in `assetIds.ts`; the check and tuning are open. |
| DUMMY_ART | DA7 | 95 | `studio-pass` | 1C-4, 4A-5 |  |
| FEEL | J10 | 190 | `studio-pass` | 1E-12 | Optional, "only if J12 asks for it": decided in the feel line. |
| FEEL | J12 | 194 | `studio-pass` | 1D-1, 1E-12, 1G-3, 2-4 | The docs half is in (docs/CLIENT.md "Juice", the log's "Game feel pass"). |
| FLOOR_MODIFIERS | FM11 | 281 | `issue` | A1 (`art-upload`) | Optional. |
| FLOOR_MODIFIERS | FM12 | 282 | `studio-pass` | 1F-5, 2-7, 4A-4 | The check; the playtest question and OC2 / OC3 are issue T2. |
| FLOOR_MODIFIERS | FM13 | 284 | `issue` | F8 (`follow-up`) | Optional. |
| FORTUNE | FO10 | 215 | `done` |  | The recolour, altar and coin art are uploaded (the task's own text; `golden-*.png`, `pact-altar.png`, `golden-coin.png` in `assetIds.ts`), and the eight sounds as built have layouts and ids: `sfx.golden.appear` / `.escape` / `.hit` / `.jackpot`, `sfx.horde.double` / `.horn` / `.wave`, `sfx.pact.take` (`packs/vale/audioLayout.ts`, `assetIds.ts`). |
| FORTUNE | FO11 | 223 | `issue` | F8 (`follow-up`) | Optional. |
| FORTUNE | FO13 | 225 | `issue` | P3 (`playtest`) | Playtest: Fortune and the Goldling hunt |
| FRAME_PACING | FP0 | 291 | `studio-pass` | 6-11 |  |
| FRAME_PACING | FP6 | 317 | `studio-pass` | 6-12 |  |
| FRAME_PACING | FP7 | 320 | `studio-pass` | 6-12 | Optional, "only if FP0 / FP6 point to it": decided there. |
| FRAME_PACING | FP14 | 615 | `studio-pass` | 6-11 |  |
| FRAME_PACING | FP15 | 618 | `studio-pass` | 6-12 |  |
| FRAME_PACING | FP21 | 1656 | `studio-pass` | 2-11 |  |
| FX_AUDIO | F0 | 327 | `studio-pass` | 1E-6, 4A-5 | The effects atlas is uploaded (`fx-effects.png` in `assetIds.ts`), so the style question is asked on the shipped effects. |
| FX_AUDIO | F5 | 346 | `studio-pass` | 1E-6 | Upload done; "every cue fires once" is open. |
| FX_AUDIO | A0 | 355 | `studio-pass` | 5-4 |  |
| FX_AUDIO | A4 | 370 | `studio-pass` | 6-1 | Ids are in `assetIds.ts`; the published-place check is open. |
| FX_AUDIO | A5 | 374 | `studio-pass` | 1E-24, 4A-5 |  |
| FX_AUDIO | W2 | 385 | `issue` | P2 (`playtest`) | Playtest: decor, void and effects across biomes and depth bands |
| GAMEPAD_MENUS | GM0 | 370 | `studio-pass` | 3-1, 4A-6 |  |
| GAMEPAD_MENUS | GM8 | 410 | `studio-pass` | 3-2, 4A-3 |  |
| GAMEPAD_MENUS | GM11 | 443 | `studio-pass` | 3-3 |  |
| GOLDLING_RUMOURS | GR11 | 169 | `studio-pass` | 1F-2, 2-7, 4A-4 | The check; the playtest questions are issue P3. |
| GOLDLING_RUMOURS | GR12 | 171 | `issue` | F8 (`follow-up`) | Optional. |
| GRAVEYARD | GY0 | 82 | `issue` | F2 (`follow-up`) | Not built: docs/GRAVEYARD.md Status says "planned 2026-11-08, not started"; `solidDecor` has no `graveyard` theme. |
| GRAVEYARD | GY1 | 84 | `issue` | F2 (`follow-up`) | Not built: docs/GRAVEYARD.md Status says "planned 2026-11-08, not started"; `solidDecor` has no `graveyard` theme. |
| GRAVEYARD | GY2 | 86 | `issue` | F2 (`follow-up`) | Not built: docs/GRAVEYARD.md Status says "planned 2026-11-08, not started"; `solidDecor` has no `graveyard` theme. |
| GRAVEYARD | GY3 | 87 | `issue` | F2 (`follow-up`) | Not built: docs/GRAVEYARD.md Status says "planned 2026-11-08, not started"; `solidDecor` has no `graveyard` theme. |
| GRAVEYARD | GY4 | 89 | `issue` | F2 (`follow-up`) | Not built: docs/GRAVEYARD.md Status says "planned 2026-11-08, not started"; `solidDecor` has no `graveyard` theme. |
| GRAVEYARD | GY5 | 91 | `issue` | F2 (`follow-up`) | Not built: docs/GRAVEYARD.md Status says "planned 2026-11-08, not started"; `solidDecor` has no `graveyard` theme. |
| GRAVEYARD | GY6 | 92 | `issue` | F2 (`follow-up`) | Not built: docs/GRAVEYARD.md Status says "planned 2026-11-08, not started"; `solidDecor` has no `graveyard` theme. |
| GRAVEYARD | GY7 | 93 | `issue` | F2 (`follow-up`) | Not built: docs/GRAVEYARD.md Status says "planned 2026-11-08, not started"; `solidDecor` has no `graveyard` theme. |
| HAPTICS | HP0 | 203 | `studio-pass` | 3-6, 4B-4 |  |
| HAPTICS | HP8 | 225 | `studio-pass` | 3-7, 4B-4 |  |
| HUD_LAYOUT | H9 | 213 | `studio-pass` | 1C-7, 1D-1, 1E-11, 1G-3, 4A-4, 4A-6 | The docs half is in (docs/CLIENT.md "HUD", the log's "HUD layout"). |
| INVITES | I0 | 231 | `studio-pass` | 6-2 |  |
| INVITES | I7 | 254 | `studio-pass` | 6-4 | Server half done (its own text). |
| INVITES | I8 | 257 | `studio-pass` | 6-3 |  |
| INVITES | I9 | 259 | `studio-pass` | 6-4 |  |
| ITEM_TOOLTIPS | IT0 | 154 | `studio-pass` | 1E-18, 3-4 | `KV_TooltipSpike` was never built (no such attribute in `src/`); the Status defers IT0 to the Studio check, so its questions are answered on the shipped tooltip. |
| ITEM_TOOLTIPS | IT10 | 256 | `issue` | F3 (`follow-up`) | docs/ITEM_TOOLTIPS.md and docs/CLIENT.md "Item tooltips" exist; CLAUDE.md's table and docs/DECISIONS.md have no entry. |
| ITEM_TOOLTIPS | IT11 | 258 | `studio-pass` | 1E-18, 2-4, 3-4, 4A-4 |  |
| KENNEY_DECOR | KN11 | 398 | `studio-pass` | 5-2 |  |
| KENNEY_DECOR | KN13 | 401 | `studio-pass` | 1E-3, 4A-5 | The check; tuning is issue T2. |
| LOCAL_PREDICTION | "Optional" | 327 | `studio-pass` | 6-12 | Optional. |
| MINIMAP | M0 | 230 | `studio-pass` | 4A-5, 6-8 | `KV_SpikeMinimap` was never built; the minimap shipped on `EditableImage` (docs/MINIMAP.md as built), so the spike's questions are asked on it. |
| MINIMAP | M11 | 409 | `studio-pass` | 1D-1, 1E-10, 2-4, 4A-5, 4A-6 |  |
| MOBILE | MB0 | 138 | `studio-pass` | 4B-1 |  |
| MOBILE | MB14 | 155 | `studio-pass` | 4A-2, 4B-3 |  |
| MOBILE | MB15 | 157 | `studio-pass` | 4B-2 |  |
| MOBILE | MB16 | 160 | `studio-pass` | 4B-8 |  |
| NEW_BEST | NB0 | 157 | `studio-pass` | 1E-19 | Only NBD8 (the confetti) is open. |
| NEW_BEST | NB10 | 177 | `studio-pass` | 1E-19, 1G-3, 2-4, 6-8 | `sfx-best-new.ogg` and `sfx-jingle-record.ogg` have ids in `assetIds.ts`; the check is open. |
| OUTLINE | O6 | 86 | `studio-pass` | 1E-4, 2-4, 4A-5 |  |
| PELLETS | PL8 | 232 | `studio-pass` | 5-1 | Uploaded; only the byte-for-byte `art:build` / `art:lock` confirmation is open. |
| PELLETS | PL9 | 236 | `issue` | P4 (`playtest`) | Playtest: pellets and the tutorial's pellet room |
| PELLETS | PL15 | 254 | `issue` | P4 (`playtest`) | Playtest: pellets and the tutorial's pellet room |
| PLAYER_NAMES | PN4 | 52 | `studio-pass` | 2-3 |  |
| PLAYER_OUTLINE | P7 | 63 | `studio-pass` | 1E-4, 2-4, 4A-5 |  |
| PORTRAIT | PT9 | 84 | `studio-pass` | 4A-3, 4B-3 |  |
| PROJECTILE_ART | PA0 | 247 | `studio-pass` | 1A-4, 4A-1 |  |
| PROJECTILE_ART | PA9 | 311 | `studio-pass` | 1E-5, 1G-3, 2-4, 4A-5 |  |
| REPO_HYGIENE | RH9 | 87 | `issue` | F4 (`follow-up`) | History rewrite with git filter-repo before the first remote (docs/REPO_HYGIENE.md RH9-RH12) |
| REPO_HYGIENE | RH10 | 92 | `issue` | F4 (`follow-up`) | History rewrite with git filter-repo before the first remote (docs/REPO_HYGIENE.md RH9-RH12) |
| REPO_HYGIENE | RH11 | 95 | `issue` | F4 (`follow-up`) | History rewrite with git filter-repo before the first remote (docs/REPO_HYGIENE.md RH9-RH12) |
| REPO_HYGIENE | RH12 | 97 | `issue` | F4 (`follow-up`) | History rewrite with git filter-repo before the first remote (docs/REPO_HYGIENE.md RH9-RH12) |
| ROLLBACK_SPIKE | R3a | 720 | `won't do` |  | Superseded by RBD8 (don't build rollback) and R7, which removed the spike's code; the doc's own checklist says "Obsolete since R7" (docs/ROLLBACK_SPIKE.md). |
| ROLLBACK_SPIKE | R3 | 757 | `won't do` |  | Superseded by RBD8 (don't build rollback) and R7, which removed the spike's code; the doc's own checklist says "Obsolete since R7" (docs/ROLLBACK_SPIKE.md). |
| ROLLBACK_SPIKE | R4 | 762 | `won't do` |  | Superseded by RBD8 (don't build rollback) and R7, which removed the spike's code; the doc's own checklist says "Obsolete since R7" (docs/ROLLBACK_SPIKE.md). |
| ROLLBACK_SPIKE | R4b | 765 | `won't do` |  | Superseded by RBD8 (don't build rollback) and R7, which removed the spike's code; the doc's own checklist says "Obsolete since R7" (docs/ROLLBACK_SPIKE.md). |
| ROLLBACK_SPIKE | R5 | 771 | `won't do` |  | Superseded by RBD8 (don't build rollback) and R7, which removed the spike's code; the doc's own checklist says "Obsolete since R7" (docs/ROLLBACK_SPIKE.md). |
| ROOM_CLEAR | RC10 | 124 | `studio-pass` | 1E-14, 2-4, 4A-4 | `sfx-room-clear.ogg` / `-perfect.ogg` have ids in `assetIds.ts`; the check and tuning are open. |
| ROOM_EDGES | RE7 | 216 | `studio-pass` | 1E-9 |  |
| ROOM_EDGES | RE8 | 218 | `studio-pass` | 1D-1, 1E-9, 1G-3, 2-4, 4A-5 |  |
| RUN_CONTRIBUTION | CT10 | 301 | `studio-pass` | 2-6, 2-10, 3-4, 4A-4 |  |
| RUN_RECAP | RR8 | 306 | `studio-pass` | 6-10 |  |
| RUN_RECAP | RR10 | 394 | `studio-pass` | 1E-19, 1G-3, 2-5, 4A-4 |  |
| SECRET_ROOMS | SR13 | 580 | `issue` | F9 (`follow-up`) | Optional, not built. |
| SECRET_ROOMS | SR15 | 592 | `studio-pass` | 1F-4, 2-7, 4A-4 | The check; the playtest question is issue T2. |
| SECRET_ROOMS | SR16 | 594 | `issue` | F8 (`follow-up`) | Optional, not built. |
| SILVER | SV11-SV13 | 583 | `done` |  | Built as docs/COSMETICS.md, which opens "This is docs/SILVER.md's phase 2 (SV11-SV13, 'Cosmetics') made concrete": the catalogue and validator (CS3, CS4), equip and per-player looks (CS4, CS6, CS7) and the drawing (CS5) are ticked there with as-built sections; `shared/theme/cosmetics.spec.ts`. What is left is tracked as COSMETICS CS0 / CS1 / CS7 / CS9 / CS11 / CS12. |
| SILVER | SV15 | 589 | `studio-pass` | 1B-4, 1E-20, 1F-5, 2-7, 3-4, 4A-4, 6-8 | Sounds, coin icon and heart art are uploaded (docs/SILVER.md "Left for the owner"); the check is open, the tuning playtest is issue T2. |
| SILVER_SHOP | SH0 | 216 | `studio-pass` | 1A-5, 3-4 |  |
| SILVER_SHOP | SH9 | 231 | `studio-pass` | 1B-6, 3-4, 4A-4, 6-9 | Products exist (2026-11-14); the rollout, the checks and one real purchase are open. |
| SNIPER_ART | SN7 | 129 | `studio-pass` | 1C-5, 1E-4, 2-4, 4A-5 |  |
| SPECTATE | S6 | 178 | `studio-pass` | 2-9, 2-10, 3-4 | The docs half is in (docs/CLIENT.md "Co-op spectating", the log's entry). |
| SPIKES | L0 (a) | 532 | `studio-pass` | 1A-3 |  |
| SPIKES | L0 (b) | 533 | `studio-pass` | 1A-3 |  |
| SPIKES | L0 (c) | 534 | `studio-pass` | 1A-3 |  |
| SPIKES | L0 (d) | 535 | `studio-pass` | 6-7 |  |
| SPIKES | L0 (e) | 536 | `studio-pass` | 1A-3 |  |
| SPIKES | L0 (f) | 537 | `studio-pass` | 6-7 |  |
| SWORD_SPACING | SP7 | 465 | `studio-pass` | 1E-23, 1G-3, 2-12, 3-5, 4B-6 |  |
| TREASURE | TR9 | 1291 | `studio-pass` | 1F-3, 2-7, 2-10, 4A-4 | Chest, cage, column and the four sounds are uploaded (`sfx-treasure-*.ogg`, `sfx-jingle-treasure.ogg` in `assetIds.ts`); the facings check is open. |
| TREASURE | TR11 | 1342 | `issue` | T1 (`tuning`) | Tune vault locks: SWIFT par and UNTOUCHED keep rates (docs/TREASURE.md TR11) |
| TUTORIAL | T8 | 510 | `studio-pass` | 1C-1, 2-2, 3-4, 4A-2 |  |
| TUTORIAL_ARROW | A6 | 184 | `studio-pass` | 1C-2, 4A-4 |  |
| TUTORIAL_FUNNEL | TF0 | 187 | `studio-pass` | 6-5 |  |
| TUTORIAL_FUNNEL | TF9 | 216 | `studio-pass` | 6-6 |  |
| TUTORIAL_MAP | TM7 | 223 | `studio-pass` | 1C-3, 3-4, 4A-4 |  |
| UI_ART | UA1 | 178 | `studio-pass` | 1A-2 |  |
| UI_ART | UA12 | 223 | `studio-pass` | 1E-11 |  |
| UI_ART | UA15 | 235 | `studio-pass` | 1B-1, 1C-7, 1E-11, 2-4 |  |
| VOID_DECOR | "Studio check" | 254 | `studio-pass` | 1E-2, 4A-5 |  |
| VOID_DECOR | "Studio check" | 332 | `studio-pass` | 1E-2 |  |
| VOID_DECOR | "Studio check" | 373 | `studio-pass` | 1E-2 |  |
| VOID_DECOR | "Studio check" | 410 | `studio-pass` | 1E-2 |  |
| VOID_DECOR | "Studio check" | 423 | `studio-pass` | 1E-2 |  |
| VOID_DECOR | VD11 | 433 | `studio-pass` | 1E-2, 2-4, 4A-5 | The check; tuning is issue P2. |
| WALL_SLIDE | WS3 | 286 | `issue` | F6 (`follow-up`) | Wall slide: stepped-wall smoothing (docs/WALL_SLIDE.md WS3) |
| WALL_SLIDE | WS6 | 385 | `studio-pass` | 1E-22 |  |
| WALL_SLIDE | WS9 | 429 | `studio-pass` | 1E-22 | Optional. |
| WALL_SLIDE | WS10 | 432 | `issue` | F7 (`follow-up`) | Optional. |

## Decision-log entries with a pending note

One row per entry of docs/DECISIONS.md that docs/OPEN_TASKS.md lists (68). "Stale half" marks a sentence the repo
already contradicts (an upload whose id is in `src/shared/theme/packs/vale/assetIds.ts`): edit the entry when the
rest of it closes. The log was not edited in this pass.

| Entry | Proposal |
|---|---|
| Minimap with fog of war (docs/MINIMAP.md) | studio-pass 1D-1, 1E-10, 2-4; the M0 questions 4A-5, 6-8 |
| Player outline (docs/PLAYER_OUTLINE.md) | studio-pass 1E-4, 2-4, 4A-5 |
| Mobile play (docs/MOBILE.md) | studio-pass 4A-2, 4B-1 to 4B-3, 4B-8 |
| Room clear celebration (docs/ROOM_CLEAR.md) | studio-pass 1E-14, 2-4, 4A-4 |
| Combo you chase (docs/COMBO.md) | studio-pass 1E-13, 1G-3, 2-4 |
| Grazes and parries (docs/GRAZE_PARRY.md) | studio-pass 1E-16 |
| Draft reveal (docs/DRAFT_REVEAL.md) | studio-pass 1E-15. **Stale half:** the art and sounds are uploaded (`ui-draft-*.png`, `sfx-draft-*.ogg` in `assetIds.ts`) |
| UI art (docs/UI_ART.md) | studio-pass 1A-2, 1B-1, 1E-11. **Stale half:** uploaded 2026-10-30 (docs/UI_ART.md Status) |
| Enemy variants (docs/ENEMY_VARIANTS.md) | studio-pass 1F-6. **Stale half:** the slime, imp and summoner sheets have ids in `assetIds.ts` |
| New-best celebration (docs/NEW_BEST.md) | studio-pass 1E-19, 6-8. **Stale half:** `sfx-best-new.ogg` and `sfx-jingle-record.ogg` have ids |
| Builds (docs/BUILDS.md) | studio-pass 1F-6; owner calls: issue T2. **Stale half:** the icon sheets and the `sfx-build-*.ogg` clips have ids |
| Daily dungeon and seeded rosters (docs/DAILY.md) | studio-pass 6-13 |
| Localization (docs/LOCALIZATION.md) | studio-pass 1A-3, 1B-7, 6-7 |
| Tutorial analytics funnel (docs/TUTORIAL_FUNNEL.md) | studio-pass 1C-8, 6-5, 6-6 |
| Boosts from breakables (docs/BREAKABLE_DROPS.md) | studio-pass 1E-8; BL9: issue P1. **Stale half:** `loot-glint.png` and `sfx-breakable-loot.ogg` have ids (BL7 ticked in this pass) |
| Void decoration (docs/VOID_DECOR.md) | studio-pass 1E-2 |
| Tutorial map lesson (docs/TUTORIAL_MAP.md) | studio-pass 1C-3, 3-4, 4A-4 |
| Portrait play (docs/PORTRAIT.md) | studio-pass 4A-3, 4B-3 |
| 3D kit decor, trial (docs/DECOR.md "3D kits") | studio-pass 1E-1 |
| 3D kit decor, second kit (docs/DECOR.md "3D kits") | studio-pass 1E-1 |
| Solid decor (docs/DECOR.md "Solid decor") | studio-pass 1E-1 |
| Room themes (docs/DECOR.md "Room themes") | studio-pass 1E-1; the throne / statue / carpet uploads 5-6 (no such ids in `assetIds.ts` yet) |
| New enemies (docs/NEW_ENEMIES.md) | studio-pass 1F-6; tuning NE12-NE13: issue T2 |
| Pellets (docs/PELLETS.md) | studio-pass 1C-7; playtests: issue P4; the four owner calls stay in docs/PELLETS.md "Open owner calls" |
| Run-over recap and co-op moments (docs/RUN_RECAP.md) | studio-pass 1E-19, 2-5, 6-10 |
| Co-op contribution (docs/RUN_CONTRIBUTION.md) | studio-pass 2-6 |
| Bookshelves (docs/BOOKSHELVES.md) | studio-pass 1E-3 (both notes) |
| Treasure rooms (docs/TREASURE.md) | studio-pass 1F-3, 2-7; TR11: issue T1. **Stale half:** the four sounds have ids |
| Fortune (docs/FORTUNE.md) | studio-pass 1F-1, 2-7; FO11: issue F8; FO13 and the owner calls: issue P3. **Stale half:** FO10's art and audio are uploaded (ticked in this pass) |
| Projectile art (docs/PROJECTILE_ART.md) | studio-pass 1A-4, 1E-5, 5-1 |
| Goo art (docs/GOO_ART.md) | studio-pass 1E-5 |
| Boost auras (docs/BOOST_ART.md BAD3) | studio-pass 1E-7 |
| Relic pedestals as chests (docs/TREASURE.md "Relic pedestals as chests") | studio-pass 1F-3 |
| Kenney bookcases (docs/KENNEY_DECOR.md) | studio-pass 1E-3. **Stale half:** `lop-patch-blotch1.png` / `-2.png` have ids |
| Training dummy art (docs/DUMMY_ART.md) | studio-pass 1C-4. **Stale half:** `dummy.png` and its outline have ids (DA5) |
| Legendaries (docs/LEGENDARIES.md) | studio-pass 1F-6; art (LG8) and audio: check at 5-6 |
| Hazard art (docs/HAZARD_ART.md) | studio-pass 1E-5 |
| Gamepad menus (docs/GAMEPAD_MENUS.md) | studio-pass 3-1 to 3-3 |
| Wall slide (port retune, 2026-11-07, docs/WALL_SLIDE.md) | issue F6 (WS3) |
| Boon icons (docs/BUILDS.md BU11, the boons part, 2026-11-08) | studio-pass 1F-6 |
| Relic and curse icons (docs/BUILDS.md BU11, the relic and curse part, 2026-11-08) | studio-pass 1F-6 |
| Boost icons (docs/BOOSTS.md "As built: boost icons", 2026-11-08) | studio-pass 1E-7 |
| Armor pips (docs/UI_ART.md "As built: armor pips", 2026-11-08) | studio-pass 1E-11 |
| Duo icons (docs/BUILDS.md BU11, the duo part, 2026-11-08) | studio-pass 1F-6. **Stale half:** `duo-icons.png` has an id |
| Graves (docs/DECOR.md "Graves", 2026-11-08) | studio-pass 1E-1 |
| Co-op frame pacing (docs/FRAME_PACING.md) | studio-pass 2-11, 6-11, 6-12 |
| Builds v2, wave 1 (docs/BUILDS_V2.md) | studio-pass 1F-6; tuning BV12: issue T2 |
| Molten tiles (docs/ART.md "As built: molten tiles", 2026-11-08) | studio-pass 1E-1 |
| Frost tiles (docs/ART.md "As built: frost tiles", 2026-11-08) | studio-pass 1E-1 |
| Grim tiles (docs/ART.md "As built: grim tiles", 2026-11-09) | studio-pass 1E-1 |
| Verdant tiles (docs/ART.md "As built: verdant tiles", 2026-11-09) | studio-pass 1E-1 |
| Kenney Forge pieces (docs/KENNEY_DECOR.md KN5-KN9, 2026-11-08) | studio-pass 1E-3 |
| Stage assets (docs/STAGE_ASSETS.md, 2026-11-09) | studio-pass 1B-8, 4B-7 |
| The Archer (docs/ARCHER.md, 2026-11-09) | studio-pass 1F-6; owner calls: issue T2 |
| Gauntlet cursor (docs/CURSOR.md) | studio-pass 1A-1, 1B-2, 1E-17 |
| Floor modifiers (docs/FLOOR_MODIFIERS.md) | studio-pass 1F-5; FM11: issue A1; FM13: issue F8; OC2 / OC3: issue T2. **Stale half:** FM10's stings are uploaded (ticked in its doc), OC1 is answered |
| Goldling hiding places and rumours (docs/GOLDLING_RUMOURS.md, 2026-11-12) | studio-pass 1F-2; GR12: issue F8; the calls: issue P3 |
| Codex (docs/CODEX.md) | studio-pass 1B-3, 1E-21, 5-5, 6-8 |
| Haptics in play (docs/HAPTICS.md, 2026-11-13) | studio-pass 3-6, 3-7, 4B-4 |
| Secret rooms (docs/SECRET_ROOMS.md) | studio-pass 1F-4; SR13: issue F9; SR16: issue F8. **Stale half:** `secret.png`, `sfx-secret-*.ogg` and `sfx-jingle-secret.ogg` have ids |
| Silver (docs/SILVER.md, 2026-11-14) | studio-pass 1B-4, 1E-20, 6-8. **Stale half:** cosmetics are built (docs/COSMETICS.md; SV11-SV13 ticked in this pass) |
| Silver shop (docs/SILVER_SHOP.md, 2026-11-14) | studio-pass 1A-5, 1B-6, 6-9 |
| New enemies 2 (docs/NEW_ENEMIES_2.md) | studio-pass 1F-6, 5-4; tuning: issue T2 |
| New enemies 3 (docs/NEW_ENEMIES_3.md) | studio-pass 1F-6. **Stale half:** the mender / mortar / jackal sheets (20 PNGs) and the six sounds have ids |
| Cosmetics (docs/COSMETICS.md, 2026-11-17) | studio-pass 5-3, 4B-5, 1B-5, 2-1; CS11: issue F10; CS12: issue F8 |
| Co-op name tags (docs/PLAYER_NAMES.md, 2026-11-19) | studio-pass 2-3 |
| Breakable outline (docs/DECOR.md "Breakable outline", 2026-11-19) | studio-pass 1E-1 |
| Sword spacing (port retune, 2026-11-19, docs/SWORD_SPACING.md) | studio-pass 1E-23, 1G-3, 2-12, 3-5, 4B-6 |

## Issues to file

Ready to run from the repository's root once it has a GitHub remote (not run here). The first block creates the six
labels; `studio-check` and `device` are for lines of docs/STUDIO_PASS.md that fail.

```bash
gh label create studio-check --color 5319e7 --description "A Studio check that failed or is still owed" --force
gh label create playtest --color 0e8a16 --description "Needs other players" --force
gh label create device --color 1d76db --description "Needs a phone, tablet or console" --force
gh label create art-upload --color fbca04 --description "Art or audio to build and upload" --force
gh label create tuning --color d93f0b --description "Numbers to tune from measurements" --force
gh label create follow-up --color c5def5 --description "Planned work that is not built" --force

# F1
gh issue create --label follow-up --title 'Respite (adaptive difficulty): build docs/DIFFICULTY.md RS0-RS12 or drop the plan' \
  --body 'docs/DIFFICULTY.md tasks RS0-RS12. Planned 2026-10-27, nothing built. Decide: build it (sim state, hash group, census, client, telemetry, playtest) or close the plan as won'\''t do.'
# F2
gh issue create --label follow-up --title 'Graveyards: rows of solid graves on grim floors (docs/GRAVEYARD.md GY0-GY7)' \
  --body 'docs/GRAVEYARD.md tasks GY0-GY7. Planned 2026-11-08, not started. A gameplay change to endless (bumps DAILY.ruleset); ends with the owner'\''s Studio check GY7 (seed 2 or 3, floor 1, dev mode).'
# F3
gh issue create --label follow-up --title 'Docs catch-up: docs/CLIENT.md sprite sections, ART.md Demon Lord row, SERVER.md, item tooltips'\'' log entry' \
  --body 'Leftover doc tasks: BOSS_DEMONLORD D8 (docs/ART.md row; docs/CLIENT.md "Boss sprites" still says Mother Mayhem has no art), BRAMBLE_ART BR7 and DEMON_ART DA8 (docs/CLIENT.md sprite smoke steps for the bruiser, turrets and Mayhem), DECOR R7 (PROVENANCE, the log'\''s D3 line) and R14 (docs/SERVER.md replay cost), ITEM_TOOLTIPS IT10 (CLAUDE.md table row and a docs/DECISIONS.md entry).'
# F4
gh issue create --label follow-up --title 'History rewrite with git filter-repo before the first remote (docs/REPO_HYGIENE.md RH9-RH12)' \
  --body 'docs/REPO_HYGIENE.md RH9 (the rewrite on a fresh clone), RH10 (commit ids in docs from the commit-map), RH11 (verify and out:digest in the rewritten clone), RH12 (swap and close). The owner'\''s, on the Mac (RHD7).'
# F5
gh issue create --label follow-up --title 'Archetype skeleton generator scripts/new/archetype.js (docs/CODEBASE_SCALE.md DX6)' \
  --body 'docs/CODEBASE_SCALE.md DX6: append the data rows a new archetype needs and a stub file, with a node:test spec. Not built in the DX pass (about 20 insertion points).'
# F6
gh issue create --label follow-up --title 'Wall slide: stepped-wall smoothing (docs/WALL_SLIDE.md WS3)' \
  --body 'docs/WALL_SLIDE.md WS3 (Design 4): notches per dungeon, case C at 1.00 / 1.00 / 0.97 / 0.91, reachability over seeds 1-40 x floors 1-10. Gameplay: read the wall slide entry in docs/DECISIONS.md first.'
# F7
gh issue create --label follow-up --title 'Wall slide: walking enemies on the slide mover (docs/WALL_SLIDE.md WS10, optional)' \
  --body 'docs/WALL_SLIDE.md WS10: measure enemies against moveCircleAroundCorners first; it changes enemy paths and needs its own sign-off.'
# F8
gh issue create --label follow-up --title 'Optional telemetry: floor modifiers, Fortune, Goldling rumours, secret rooms, cosmetics' \
  --body 'FLOOR_MODIFIERS FM13, FORTUNE FO11, GOLDLING_RUMOURS GR12 (folds into FO11), SECRET_ROOMS SR16, COSMETICS CS12. None built; each doc lists its fields.'
# F9
gh issue create --label follow-up --title 'Secret rooms: bot census of discovery (docs/SECRET_ROOMS.md SR13, optional)' \
  --body 'docs/SECRET_ROOMS.md SR13: the endless bot with an investigate option, per character and with / without Wrecker; revisit SRD1 / SRD4 / SRD6 with the numbers.'
# F10
gh issue create --label follow-up --title 'Cosmetics: earned cosmetics (docs/COSMETICS.md CS11)' \
  --body 'docs/COSMETICS.md CS11, left out of the first pass.'
# A1
gh issue create --label art-upload --title 'Floor modifier icons (docs/FLOOR_MODIFIERS.md FM11, optional)' \
  --body 'docs/FLOOR_MODIFIERS.md FM11: the icon sheet, its lock, the card and chip with and without the art.'
# A2
gh issue create --label art-upload --title 'Bookshelves: lectern or pedestal in big libraries, near-wall low shelf (docs/BOOKSHELVES.md BK9)' \
  --body 'docs/BOOKSHELVES.md BK9, later / optional: the Essential Kit'\''s Pedestal_Set5_0 or the Modular Set V2 lectern; a half-height near-wall shelf if near walls look bare.'
# P1
gh issue create --label playtest --title 'Playtest: boosts and boosts from breakables (drop rate, contested drops, uptime)' \
  --body 'BOOSTS B11 (solo and 4-player, PC and phone, keyboard and gamepad; tune DROPS and the boost table) and BREAKABLE_DROPS BL9 (is the glint noticed, total boost uptime on floors 1-10; tune BREAKABLE_LOOT).'
# P2
gh issue create --label playtest --title 'Playtest: decor, void and effects across biomes and depth bands' \
  --body 'DECOR R15 (crate cheese against snipers, enemies stuck on crates; tune DECOR_DEPTH, BREAKABLE), FX_AUDIO W2 (effect and sound fatigue over long runs, phone performance) and the tuning half of VOID_DECOR VD11 (VOID, VOID_PIECES, VOID_DEPTH).'
# P3
gh issue create --label playtest --title 'Playtest: Fortune and the Goldling hunt' \
  --body 'FORTUNE FO13 and the playtest questions of GOLDLING_RUMOURS GR11 (do players go looking, is a calm catch after the clear too easy), with docs/FORTUNE.md'\''s open owner calls 1-4.'
# P4
gh issue create --label playtest --title 'Playtest: pellets and the tutorial'\''s pellet room' \
  --body 'PELLETS PL9 (do players chase pellets mid-fight, is a sweep reachable; tune PELLETS; open owner call 1: chasing costs 13.6 % of room points) and PL15 (new players in room G, funnel drop at step 12; tune TUTORIAL.pellets.max).'
# T1
gh issue create --label tuning --title 'Tune vault locks: SWIFT par and UNTOUCHED keep rates (docs/TREASURE.md TR11)' \
  --body 'docs/TREASURE.md TR11: solo and co-op 2 / 4, PC and phone. Open item from the TR5 census: SWIFT kept 30 / 30 at swiftParPercent 100 against a 40-60 % target (try 30-40 after measuring players); UNTOUCHED 32 %; a co-op census is part of the task.'
# T2
gh issue create --label tuning --title 'Tuning round after the Studio pass (open owner calls)' \
  --body 'What the Studio pass leaves to tune: BOOKSHELVES BK8 (theme weights, run lengths, shelfShare), KENNEY_DECOR KN13, FLOOR_MODIFIERS OC2 / OC3 (Plunder'\''s strength, the kind mix) and FM12'\''s question, SECRET_ROOMS SR15'\''s question, SILVER SV15'\''s first-hour pacing, COSMETICS CS9'\''s playtest, and the measured-tuning notes in docs/DECISIONS.md (Builds BU13, Builds v2 BV12, New enemies NE12-NE13, New enemies 2 NX12, The Archer AR13).'
```
