# Draft reveal (plan)

Status (2026-10-30): **plan, not started.** DR0 (owner decisions) is open: DRD3, DRD5, DRD8, DRD11 are the ones that
change what gets built.

Goal: make the boon draft a moment the player looks forward to on every floor. Today the three cards appear all at
once, already face up, the moment the stage cover fades, and nothing plays when they appear or when a boon is taken.
After this plan the cards **deal in face down and flip one by one**, each flip a little higher in pitch; a **rare**
card lands with a chime and a shine; a **legendary** card gets a **beat of anticipation** (the other cards dim, the
music dips, its back trembles and glows), then a hush, then a fast flip into a **flare** (a flash, a burst of rays, a
pop and a sting), and it keeps a slow halo of rays while the draft is open. Taking a boon **stamps** the card with a
sound.

**Presentation and client input only:** no sim, dungeon, lockstep, hash, replay or fixture change. The offers, their
rarities, the selection and the confirm rule (`DRAFT_MIN_OPEN_TICKS`) are untouched. The client holds back the
confirm button while its own reveal plays (like the stage cover's `coverGate`), so the sim simply sees the press later.
Theme additions: five port audio IDs (SILENT in the placeholder). No new setting (DRD8), no new strings.

## What already exists (and is reused)

| Piece | Today | Where |
|---|---|---|
| Offers | `drawBoonOffers`: per card one rarity roll (Common 70 / Rare 25 / Legendary 5 %, legendary +1 point per floor cleared after the first, at most 15 %), then a boon of that rarity among the unowned, not yet offered ones (none left: any remaining boon). With 3 or fewer unowned boons left, all of them, no rng. 1 to 3 cards | shared/sim/progression/progression.ts, progressionData.ts |
| Boon rarities | 7 Common, 3 Rare (Sharpened, Hearty, Warding), **2 Legendary (Ember Wake, Composure)** | progressionData.ts `BOONS` |
| Draft lifecycle | Opens for every present player on each endless floor change (`openDraft`), world frozen until every open draft is closed; the stick picks the column; a FIRE press edge after `DRAFT_MIN_OPEN_TICKS` (30 = 0.5 s) confirms; `draftOpened` / `draftChosen` run events | progression.ts `stepDraft` |
| Stage cover | A floor change shows the floor card (`minCardSec` 0.6), then fades (`fadeSec` 0.25) to the new floor **with the draft already open**. Input is neutral under the cover and through the fade (`coverGate`, a `CoopMenuInputGate`) | client StageController, SimController, shared/view stageLoader.ts |
| Overlay | `DraftOverlay`: title, three `DraftCard`s (name in the rarity colour, rarity name, effect), the selected card at 1.06x with a `uiAccent` stroke, the hint (`hud.draft.wait` until `draftReady`), co-op "waiting for N". Re-rendered from the snapshot every frame while a draft is open | client/ui/hud/DraftOverlay.tsx, shared/play/snapshot.ts |
| Rarity colours | `RARITY_COLOR_ROLES` = common `rarity.normal` (#e8e6e3), rare `rarity.rare` (#ffe066, yellow), legendary `rarity.unique` (#c7864b, bronze). Also the owned-boon icons (RunItems) | shared/view/hud/progression.ts |
| Touch | A tapped card queues a pick (`InputController.queueDraftPick`: its column, then the confirm) | client HudController, shared/play/touch/draft.ts |
| Sounds | **None** on draft open, flip or pick (only the boon toast shows). `sfx.ui.confirm` / `sfx.ui.move` exist for menus | shared/view/audio/cues.ts |
| Juice tools | Per-frame React bindings written by a controller (`ROOM_CLEAR_UI`, `COMBO_UI`), UIScale pops in fixed slots, swept UIGradient shine (ComboRow), `MusicDuck` (jingles dip the music), `AudioController.play(id, scale, speed)` | client/ui/hud, client/controllers/audio |

Three facts shape the design:

1. **The draft opens under the stage cover.** By the time the cards can be seen, `draftTicks` is usually past the
   0.5 s confirm guard, so the sim's guard cannot protect the reveal. The reveal starts when the cover starts to fade,
   and the client masks FIRE until its reveal has settled (DRD2). A press during the reveal skips it instead (DRD6).
2. **Legendary is rare and runs out.** Only 2 of 12 boons are legendary and an owned boon is never offered again. A
   floor 1 draft shows one with about 14 % odds (1 - 0.95^3), rising to about 39 % per draft at the 15 % cap; a
   player sees a legendary card perhaps one to three times a run. That rarity is what pays for a ~1 s beat, and why
   the beat must **never** play for a card that is not legendary (no fake-outs, DRD4).
3. **The rare colour outshines the legendary one.** Rare is a bright yellow and legendary a muted bronze, so the
   flare would land on the dullest colour. DRD3 proposes the usual ladder (white, blue, gold) by remapping
   `RARITY_COLOR_ROLES` to existing roles.

## Player experience (target)

### The deal and the flips (no legendary)

Times from the moment the stage cover starts to fade (`t = 0`). Three cards; one or two cards follow the same rules.

| t (s) | What happens |
|---|---|
| 0 | The title fades in (0.15 s). Three card **backs** rise 24 px into their slots and fade in, 0.05 s apart (0.18 s each). A back is a `uiPanel` card with a `uiAccent` frame and a centred glyph; all backs look the same |
| 0.35 | Card 1 **flips** (0.20 s): its width squashes to 0 over 0.10 s, the face swaps in, and it springs back to full width over 0.10 s (overshoot 1.04 -> 1). `sfx.draft.flip` at the squash start. The name, rarity and effect fade in over 0.08 s as it lands (no text is drawn while the card is thin) |
| 0.57 | Card 2 flips, `sfx.draft.flip` +2 semitones |
| 0.79 | Card 3 flips, +4 semitones |
| 1.07 | **Settled**: the selection highlight appears on the card under the stick, the hint switches from "wait" to the key hint, and the confirm is let through |

A **common** card is a plain flip. A **rare** card's flip also plays `sfx.draft.rare` (a chime) on landing, its stroke
flares to full brightness in the rare colour for 0.3 s, and a white shine sweeps across it once (0.35 s, the
ComboRow UIGradient technique).

### The legendary beat

Legendary cards flip **last**, whatever their column (DRD5): the other cards flip first in left-to-right order, then
the beat. The flip order is presentation only; columns and the selection are the sim's.

| t (s) after the last other card landed | What happens |
|---|---|
| 0 | **Charge** (0.70 s): the other cards dim to 50 %; the legendary back's stroke glows up from nothing to full in the legendary colour; the back trembles (0 -> 2 px, about 30 Hz); faint rays start to turn behind it; the music dips to `AUDIO_VIEW.duck.level` (`MusicDuck`); `sfx.draft.charge` (a riser, DRD11) |
| 0.70 | **Hush** (0.12 s): the tremble stops, the charge sound has ended, nothing moves. This is the beat |
| 0.82 | A fast flip (0.14 s), no flip sound |
| 0.96 | **Flare**: a white flash over the card (opacity 0.8 -> 0 over 0.12 s, card area only), a ring of rays bursts out (scale 0.6 -> 1.4, fading over 0.5 s), the card pops (1.25x -> 1x, ease out back, 0.25 s), the other cards undim (0.2 s), `sfx.draft.legendary` (a jingle: it ducks the music for its length) |
| 1.21 | **Settled** (the pop has landed). The legendary card keeps a **halo**: rays turning slowly behind it (0.1 rev/s, 35 % opacity) and its stroke pulsing gently (1 Hz) for as long as the draft is open |

A whole draft with a legendary takes about 2.0 s instead of 1.1 s. **Two legendaries** in one draft share one beat:
both charge together and flip together into one flare (one sting).

### Skipping

A confirm press (FIRE, or a tap on touch) **during** the reveal skips it: every card still face down flips at once
(0.12 s, one flip sound). A legendary still gets its flash, burst, pop, sting and halo, but no charge or hush: you skip
the wait, not the reward. The skipping press is held back until it is released (DRD6), so a held or mashed attack
never picks a card the player has not seen. A pick needs a fresh press after the cards are settled.

### Taking a boon

On the confirm frame (the local player's `draftChosen`): the chosen card **stamps** (1.0x -> 1.12x -> 1.0x over 0.15
s, a white flash at 0.5 opacity), the other cards drop 16 px and fade (0.2 s), `sfx.draft.pick` plays, and the overlay
fades out over 0.25 s after the stamp (it stays mounted from the controller's copy of the offers: the snapshot's draft
is already closed). In co-op, the "waiting for N teammates" line takes its place. The boon toast is unchanged.

### Rules

- **Every draft**: endless runs and the tutorial's floor 2 draft (its first impression; the tutorial prompt is
  unchanged). The finished tutorial's floor 3 draft is never shown, as today.
- **Local only.** Each client reveals its own offers; a teammate's draft is never shown. Co-op: the party waits for
  everyone's reveal plus pick; the world was already frozen for the slowest picker, so a reveal adds at most ~1 s, or
  ~2 s with a legendary, to that wait (and a skip removes it).
- **Start**: the first frame the local draft is open and the stage cover is fading or gone (`StagePhase` `revealing`
  or `done`). A draft opened with no cover at all (debug floor skip without a card) starts at once.
- **Selection during the reveal**: the stick still moves the sim's `draftSelected` (harmless); the highlight and the
  1.06x scale are drawn only once settled.
- **Touch**: a tap during the reveal is a skip and its queued pick is dropped (`queueDraftPick` asks the reveal first).
- **Reduced motion**: no rise, tremble, pop, burst, ray rotation or drop; a flip becomes a 0.12 s crossfade from back to
  face; the legendary flash is replaced by its stroke going to full brightness; the charge keeps its timing, glow, dim,
  music dip and sound (the beat is timing, not motion). Every sound stays.
- **Photosensitivity**: one flash per legendary, on the card only (never full screen), at most 0.8 opacity; the halo
  pulse is 1 Hz.
- **Pause**: a solo pause during the reveal freezes it (the reveal steps on unpaused frames). Leave run / restart drop it.
- **Fewer than three cards**: the same timings over the cards there are (two sit left and right, one in the centre).

## Design (summary)

| Piece | Where | Step |
|---|---|---|
| `DRAFT_REVEAL` (deal, flip, interval, text fade, rare chime / shine, charge, hush, fast flip, flash, burst, pop, halo, skip flip, stamp, exit; flip semitone step 2; dim 0.5; tremble px / Hz) and the reduced-motion values | shared/view/hud/draftRevealConfig.ts | DR1 |
| `revealOrder(rarities)` (non-legendary left to right, then legendaries); `DraftReveal`: `begin(rarities, reducedMotion)`, `skip()`, `pick(index)`, `step(dt)` -> a reused `DraftRevealFrame` (per card: `face` 0/1, `width`, `rise`, `alpha`, `textAlpha`, `dim`, `tremble`, `glow`, `flash`, `burst`, `pop`, `shine`, `halo`; overall: `settled`, `leaving`, `done`, and this frame's cues `{ id, speed }` and duck request) | shared/view/hud/draftReveal.ts | DR1 |
| `DraftRevealGate` (masks FIRE while the reveal is not settled; a FIRE press edge then is a skip; held until released, like `CoopMenuInputGate`) | shared/play/draftGate.ts | DR2 |
| Rarity colour ladder remap (DRD3) | shared/view/hud/progression.ts | DR3 |
| Port audio IDs `sfx.draft.flip` / `.rare` / `.charge` / `.legendary` / `.pick` in `PORT_AUDIO_EVENTS` (SILENT in the placeholder); `SFX` entries, priorities, `sfx.draft.legendary` in `DUCKING_SFX` and category `jingle`; `art/audio.json` entries | shared/theme contract, packs, shared/view/audio/cues.ts | DR4 |
| `DRAFT_UI` bindings (per card slot, plus overlay alpha); `DraftCard` gains a back face, a flip holder (width from a binding, AnchorPoint centre, text hidden while `width` < 0.9), a glow stroke, a flash frame, a ray ring (behind the card, outside the layout) and a shine gradient; the overlay hides the selection until settled and stays mounted while `leaving` | client/ui/hud/DraftOverlay.tsx, DraftRays.tsx | DR5 |
| `DraftRevealController`: per frame, reads the local draft (`run.players[local]`), the stage phase and pause, begins / steps / skips / picks the reveal, writes `DRAFT_UI`, plays cues (`AudioController.play`), requests the music dip (a new `AudioController.duckFor(seconds)` on `MusicDuck`); exposes `blocksConfirm()` for SimController (solo and co-op input paths, after `coverGate`) and InputController (`queueDraftPick`) | client/controllers/fx/DraftRevealController.ts, SimController, InputController, AudioController | DR6 |
| `KV_DraftRevealDebug` (Workspace string attribute, e.g. `c,r,l`, `l,l`): the next draft's reveal uses these rarities (display only: the faces stay the real boons); off by default | client controller, `shared/config` debug flags | DR6 |

### Not changed

- **The sim**: offers, rarity odds, boon pool, selection, confirm rule, `DRAFT_MIN_OPEN_TICKS`, the frozen world, co-op
  waiting. No hashed field, run event or replay changes; the sim only sees the confirm press later.
- **The stage cover** timings and its own input gate.
- **Card layout**: same size (240 x 150), same text rows; the rays and flash draw outside the layout and never move a card.
- **The boon toast** and the owned-items panel (apart from DRD3's colours).

## Tasks

Each step is a commit. Specs next to the code; `npm run verify` before each.

- [ ] **DR0. Owner decisions.** DRD3 (colour ladder), DRD5 (legendary last), DRD8 (no setting), DRD11 (sounds, the
  riser source). The rest are proposed defaults.
- [ ] **DR1. Reveal core.** `draftRevealConfig.ts`, `draftReveal.ts` + spec: `revealOrder` (`[c,l,r]` -> 0, 2, 1;
  `[l,l,c]` -> 2, then 0 and 1 together); timelines for 3 commons (settled at 1.07 s, flip cues at +0 / +2 / +4
  semitones), a rare (chime on landing, shine), a legendary in the left column (charge -> hush -> flare, settled at
  ~2.0 s, the duck request, the halo after), two legendaries (one beat, one sting), 1 and 2 cards; skip before the
  first flip, mid-flip and mid-charge (no charge cue after the skip, the flare and sting still once); pick (stamp,
  leaving, done); reduced motion (crossfade, no tremble / pop / burst, same cue times); `step` with dt 0 and a huge dt
  (clamped, every cue still fires once, in order).
- [ ] **DR2. Input gate.** `DraftRevealGate` + spec: FIRE masked until settled; a press edge during the reveal ->
  one skip; the held press stays masked after settle until released; other buttons and the stick pass; a press after
  settle passes on its first frame.
- [ ] **DR3. Colour ladder** (if DRD3 is accepted): `RARITY_COLOR_ROLES` -> `rarity.normal` / `rarity.magic` /
  `rarity.rare`; hud.spec contrast check of the three on `uiPanel` (>= 3:1).
- [ ] **DR4. Audio.** The five IDs (contract, placeholder SILENT, vale), `SFX`, priorities (pick 60, flip 50, rare
  55, charge 62, legendary 72: above everything else that can play over a frozen draft), min intervals (flip 0.05),
  `DUCKING_SFX`; mapper / contract / vale specs. `art/audio.json` entries with the DRD11 candidates (`confirmed:
  false`); lock / build / upload are DR9. Note: `contract.luau` sits at Luau's 200-locals limit; the IDs join the
  existing `PORT_AUDIO_EVENTS` array (no new top-level constant).
- [ ] **DR5. Overlay.** `DRAFT_UI`, the card back, flip holder, glow, flash, rays, shine, selection-after-settle, the
  leaving fade. Touch and HUD scale 70 % lay out as today.
- [ ] **DR6. Controller and gate wiring.** `DraftRevealController`, `blocksConfirm()` in both SimController input
  paths and `queueDraftPick`, `AudioController.duckFor`, the debug attribute; `npm run build:place` still builds.
- [ ] **DR7. Bot check.** The headless tutorial / endless / party bots drive the sim directly and are unaffected; add a
  spec that the gate never masks anything once settled, so a bot-like client cannot stall.
- [ ] **DR8. Docs.** This doc's status and as-built notes, docs/CLIENT.md, the CLAUDE.md decision log.
- [ ] **DR9. [owner] Studio check and sounds.** The check below. On the Mac: `npm run audio:audition` (pick the
  candidates), `audio:lock`, `audio:build`, upload the five `sfx-draft-*.ogg`, ids into `packs/vale/assetIds.ts`,
  `npm run verify`. Tune `DRAFT_REVEAL` by eye and ear with `KV_DraftRevealDebug`.

## Studio check

1. Solo, endless floor 1 -> 2: the floor card, then the backs rise as the cover fades and flip one by one with a
   climbing click; mashing attack through the floor card picks nothing; one press during the flips skips; the hint
   reads "wait" until settled.
2. `KV_DraftRevealDebug = "c,l,r"`: the left and right cards flip, then the centre one charges (others dim, music
   dips, tremble, glow), the hush, the flare and sting; the halo keeps turning; pick it: the stamp and the pick sound.
3. `"l,l"` with two cards; `"r"` with one; skip during the charge.
4. Co-op (two clients): each reveals its own cards; the first to pick sees "waiting for 1 teammate"; a skip on one
   client does not touch the other.
5. Touch: a tap during the flips skips and does not pick; a tap after settle picks. Gamepad: RT the same.
6. Reduced motion on: crossfades, no tremble or burst, same timing and sounds. HUD scale 70 %.
7. The tutorial's floor 2 draft with its prompt.
8. Studio assumptions to check first (none can be checked headlessly): the width-squash flip looks like a flip (not a
   wipe) at 0.10 s per half; Frame `Rotation` on the ray holder rotates its children and the rays are not clipped by
   the overlay panel; the UIGradient shine on a Frame; the music dip and the jingle duck stacking without a pump; the
   ~2 s legendary reveal not feeling slow by the third run (if it does: shorten the charge, never drop the hush).

## Decisions

All proposed; DR0 collects the owner's answers.

- **DRD1. Presentation and client input only.** Nothing in the sim knows the reveal exists.
- **DRD2. The client holds the confirm, not the sim.** Raising `DRAFT_MIN_OPEN_TICKS` would change every endless and
  tutorial replay, could not see the stage cover, and would make a co-op teammate's skip wait for the slowest
  machine. A client gate (like `coverGate`) is per player and free. *Alternative:* a sim guard; rejected.
- **DRD3. Rarity colours: white, blue, gold.** Map common / rare / legendary to the existing `rarity.normal` /
  `rarity.magic` (#6f8cff) / `rarity.rare` (#ffe066) roles, so legendary is the brightest colour on the card and the
  flare lands on gold. Touches the owned-boon icons too. No new colour role. *Alternative:* keep today's yellow / bronze
  and use a new `draft.flare` role for the flare only.
- **DRD4. No fake-outs.** Every back looks the same and the charge plays only for a legendary card, so the beat is a
  promise the game always keeps. No "almost legendary" teases.
- **DRD5. Legendary flips last, whatever its column.** Saves the best for last and puts the beat after the player has
  seen what else is on offer. *Alternative:* strict left to right (the beat can come first, which wastes it).
- **DRD6. A press skips, then must be released.** Repeat players are never slowed; a skip keeps the legendary's flare
  and sting (the reward) and drops only the wait.
- **DRD7. Two legendaries share one beat.** Two charges in a row would double the wait for the same news.
- **DRD8. No setting.** Skip covers impatience, reduced motion covers motion, the SFX volume covers sound. Same call as
  Combo CD11.
- **DRD9. Rare gets a small reward** (chime, stroke flare, one shine), so the ladder has three steps, not two.
- **DRD10. A pick sound and stamp.** Taking a boon plays nothing today; the stamp closes the loop the reveal opens.
- **DRD11. Sounds.** Candidates from the unused Ninja Adventure clips (CC0), picked at the audition: flip
  `Menu/Move6.wav` / `Move7.wav` / `Move8.wav` (a light card snap; three variants, played at the ladder's pitch);
  rare `Magic & Skill/Magic5.wav` or `Heal3.wav`; legendary `Jingles/Secret3.wav` or `Secret4.wav` (category jingle);
  pick `Menu/Accept2.wav` / `Accept3.wav` / `Accept5.wav`. The pack has **no riser** for the charge: either the owner
  adds one (e.g. a Pixabay "magic charge" clip, kept in gitignored `art/vendor/pixabay/` like the combo break), or
  `sfx.draft.charge` stays silent and the music dip alone carries the charge (silence is anticipation too).
- **DRD12. Code-drawn card back, rays and flash.** No new image slots now; an optional `ui.draft.cardBack` /
  `ui.draft.rays` image is Later.

## Later (not in this plan)

- The chosen card **flies** to its icon in the owned-items panel and the icon pops.
- Card art: a painted back, rarity frames, boon icons on the faces.
- A legendary **reroll-proof pity** or odds changes: sim changes (scores and replays change).
- A per-rarity music sting layer once the music has stems.
