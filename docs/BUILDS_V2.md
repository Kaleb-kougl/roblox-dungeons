# Builds v2: more builds (proposal)

Status (2026-11-05): **proposal only, nothing built.** Follows `docs/BUILDS.md` (BU0-BU10 built, BU11-BU14 open).
Everything here uses the same patterns: new boons appended to `BOONS` (indices 17+ after docs/LEGENDARIES.md's two, append only, hashed), effects run
through the proc engine with the same `gen` / `GEN_MAX` 3 / `EFFECT_BULLETS_MAX` budgets, new bullet kinds pass
`buildReport` (BUD12), everything follows the `buildFx` Reduced setting (BUD13), and builds stay endless-only (BUD8).
Same rule of thumb as v1: **if a player cannot see it happen, it is not in this plan.**

## Why: the gaps v1 leaves

Read from the code and docs on `main` today:

1. **The guard has no build.** Parries already feel great (GRAZE_PARRY: gold burst, PARRY!, 30 ms freeze), but the only
   thing that scales off them is the Mirror Cloak relic. The sword's best skill move has no boon behind it.
2. **The bow's charged shot has no build.** Every bow duo reads stream / heavy / Flurry arrows the same way, so holding
   ALT is never a build decision.
3. **The safe picks never get a payoff.** Hearty and Deep Flask have no duo, and Composure is only in Unshaken
   (BUILDS.md: "they are the safe picks"). Picking safety should still lead somewhere exciting.
4. **Systems players already enjoy have no build.** Breakables (DECOR D4), pellets and the power pellet, and the Goldling
   all give dopamine on their own, but nothing in the draft makes them bigger.
5. **Bosses ignore builds.** `damageCapPerSecond` 6 means no build shortens a boss (BU13 recommendation 6), so a
   strong build feels the same as no build in the biggest fight of a floor.
6. **Duos are hard to find** (BU13 recommendation 1). The best moment of v1 is also its rarest.

## New boons (indices 17-22)

**Overkill moved (2026-11-06):** the owner made Overkill a legendary in docs/LEGENDARIES.md (indices 15 / 16 go to
Overkill and Bastion), so its row below is withdrawn and the rest renumber after them.

Each common / rare boon has levels I / II and an evolution at III, like v1. Numbers are starting points for a BU13-style
tuning pass.

| Boon | Lvl I | Lvl II | Evolution (III): the new visible rule | The dopamine beat |
|---|---|---|---|---|
| **Riposte** (rare, offense) | a guard that erases at least 1 bullet fires a counter-wave forward when it ends: 1 damage per bullet erased (max 6), pierces all | max 10 | **Counterstrike**: erasing 5+ bullets in one guard turns the wave into a full ring, and each erased bullet also flies back at the nearest enemy (gen 0) | The PARRY! tick climbs in pitch per bullet eaten, then `COUNTER x7` pops as the wave goes out. Sniper volleys turn into ammo |
| **Ballista** (rare, offense) | a heavy arrow bursts into 6 bolts when it spends its last pierce or hits a wall | 10 bolts, charge time -25 % | **Siege Bolt**: the first non-boss the heavy arrow hits is **pinned** and carried until the arrow hits a wall; a wall slam deals 3x heavy damage plus a shockwave ring | Charging becomes the anticipation. Dragging a bruiser through a swarm into a wall is a moment players will clip |
| **Hemorrhage** (common, offense) | each player hit adds a blood mark to the enemy (pips over its head); 5 marks **rupture** for 4 damage and a red ring | ruptures at 4 marks | **Crimson Bloom**: a rupture spreads 2 marks to every enemy within 3 tiles (rupture kills proc like any kill) | Pips fill up visibly. In a dense room the marks spread, then the whole room ruptures in one rolling wave |
| ~~**Overkill**~~ | withdrawn: now a legendary, docs/LEGENDARIES.md | | | |
| **Wrecker** (common, offense) | rolling through a breakable smashes it; smashed pieces fire 3 splinters at the nearest enemies (gen 0) and refill the combo timer | 5 splinters | **Demolition**: smashed breakables explode (1.5 tiles) and set off neighbouring breakables, chaining across the room; each piece +1 combo step | The room becomes ammo. Bookshelf rows and pillars go off like fireworks |
| **Berserk** (rare, offense) | at 1 heart: +40 % damage and attacks recover 20 % faster; the knight glows red | +60 % / 30 % | **Undying Rage**: at 1 heart, every 10 kills heal half a heart (still only up to 1.5 hearts, so the build stays on the edge) | Staying alive at 1 heart is the strongest feeling in the genre. A `CLUTCH` shout plays when a room clears at 1 heart |
| **Glutton** (common, score) | pellet pickup radius x2; each pellet fires a tiny shard at the nearest enemy (1 damage, gen 0) | x3 radius, 2 shards | **Devour**: a Sweep (every pellet before the last enemy dies) grants 3 s of power pellet: enemy bullets you touch turn into points instead of hurting you | A chomp chain climbing in pitch, and a Sweep becomes something to chase every room, not only for score |

Recommended order (owner call): **wave 1** = Riposte, Ballista, Wrecker (they fill gaps 1, 2 and 4, and each reuses
an existing sim hook: guard cancels, the heavy arrow, breakable hits). **Wave 2** = Hemorrhage, Berserk,
Glutton.

## New duos

Gap 3 first: every v1 boon now has at least one duo.

| Duo | Boons | Rule | Beat |
|---|---|---|---|
| **Full Heart** | Hearty + Sharpened | at full hearts, every finisher and every heavy arrow also fires a piercing light beam (4 tiles, finisher damage) | The classic full-health sword beam. Not getting hit pays off in every swing |
| **Adrenaline** | Deep Flask + Berserk | drinking at 1 heart grants Fury (the boost, +50 % damage) for 6 s, and the flask still heals | A near-death drink becomes a power spike instead of a retreat |
| **Happy Hour** | Deep Flask + Bounty | drinking doubles kill points for 5 s (its own pop colour) | Saving a flask for a big pack becomes a score play |
| **Stillwater** | Composure + Riposte | a parry gives back the combo the last hit cut, if within 3 s | You take it back. The greyed-out lost multiplier (COMBO break) lights up again |
| **Thunder Guard** | Riposte + Chain Spark | every bullet the guard erases sparks to the nearest enemy (1 damage, gen 1) | One guard against a sprayer turret lights up the room |
| **Dragon Bolt** | Ballista + Ember Wake | a heavy arrow leaves an ember along its whole path (the Fire Arrows ember, `FIRE_ARROWS_EMBERS_MAX` does not apply) | A line of fire across the room in one shot |
| **Blood Shards** | Hemorrhage + Soul Shards | each shard hit adds 2 marks instead of 1 | Shards seed the room, ruptures finish it |
| ~~**Supernova**~~ | Overkill + Volatile | moved to docs/LEGENDARIES.md (redefined: a 3+ carry bursts one ring larger) | |
| **Powder Keg** | Wrecker + Volatile | a smashed breakable procs like a kill (gen 0: bursts, sparks and shards all fire) | Every crate is a kill |

**Matador dropped (owner, 2026-11-07).** Riposte + Slippery (a bullet rolled through counts as a guard erase) is
withdrawn: Bastion's roll brace (docs/LEGENDARIES.md LGD7) already counts bullets rolled through as blocked.

## Builds: how they come together

Each build is named as the player would describe it, with the cards that make it and the moment it "comes online".

1. **The Duelist** (sword): Riposte -> Counterstrike, Chain Spark (Thunder Guard), Composure (Stillwater). *Online:* a
   sniper fan arrives, guard, 7 bullets eaten, `COUNTER x7`, ring wave plus 7 sparks, the pack is gone.
2. **The Siege Engine** (bow): Ballista -> Siege Bolt, Ember Wake (Dragon Bolt), Piercing Arrows. *Online:* charge, pin a
   bruiser, drag it through 4 swarmers, wall slam, shockwave, a line of fire left behind.
3. **The Blood Gardener**: Hemorrhage -> Crimson Bloom, Soul Shards (Blood Shards), Swift Strikes. *Online:* the whole room
   wears pips, one more hit, rupture spreads, the room pops in a rolling red wave.
4. **The Wrecking Crew**: Wrecker -> Demolition, Volatile (Powder Keg), Slippery (Blazing Trail). *Online:* one roll
   through a bookshelf row and the room detonates.
5. **The Last Stand**: Berserk -> Undying Rage, Deep Flask (Adrenaline), plus the Second Wind relic. *Online:* at 1
   heart, red glow, Fury on the drink, `CLUTCH` on the clear.
6. **The Executioner**: Overkill (legendary, docs/LEGENDARIES.md), Sharpened -> Executioner, Volatile (Supernova). *Online:* one finisher
   on a bruiser, a red streak hops through every low enemy, each corpse bursts.
7. **The Paladin**: Hearty -> Lionheart, Sharpened (Full Heart), Warding -> Bulwark. *Online:* full hearts, every
   swing fires a beam, a PERFECT clear heals. It rewards clean play instead of chaos.
8. **The Glutton**: Glutton -> Devour, Bounty -> Jackpot (Happy Hour), Lingering (Gold Rush). *Online:* a Sweep, bullets
   turn to points, Jackpot pops, the score panel's number jumps.

## Dopamine rules for every new boon

Reused from systems already in the game, so no new presentation machinery is needed:

- **Anticipation you can see:** pips (Hemorrhage marks), a charge glow (Ballista), a counter that grows during the
  guard (Riposte). The payoff should be visible on its way.
- **Pitch climbs:** the combo kill sound and the graze shimmer already climb. Riposte's erase tick, Glutton's chomp and
  Demolition's chain pops do the same, with a voice cap and generation pitch (BUILDS.md risks: audio spam).
- **Named breakpoints:** `COUNTER x7`, `PINNED`, `CLUTCH` use the combo shout's construction, which must never hide a
  bullet (CD9).
- **Freeze on the big hit:** solo only, through the existing Freeze frame setting: Counterstrike's ring, the Siege Bolt
  wall slam (40 ms, as the Goldling catch).
- **Recap brag lines** (RUN_RECAP highlights, presentation only from an unhashed feed): `Biggest cascade 23 kills`,
  `Best counter x9`, `Longest pin 6 tiles`, `Rooms cleared at 1 heart: 4`.

## Two fixes that make every build feel better

1. **Duo hint on cards** (presentation only). A New card whose boon completes a duo with something you own shows a small
   joined-icon badge with the duo's silhouette and `Completes a duo`. This makes the duo visible as a goal two picks
   early. Pair it with BU13 recommendation 1(b) (the boss double draft falls back to a partner card), a sim change.
2. **Overcap pays points** (boss gap 5, sim and score change, owner call). Damage the boss cap throws away pops as small
   gold points (`+12`) at the boss, in its own score source. A strong build still can't shorten the fight, but the
   player sees their build working on the boss.

## Fit with the sim (what each one needs)

| Item | Sim hook it reuses | New state (hashed, `builds` group) | Risk |
|---|---|---|---|
| Riposte, Thunder Guard | `scoreGuardCancels` / the guard sweep's erase count | per-player erase count for the current guard | low |
| Ballista, Dragon Bolt | the heavy arrow's last pierce and wall hit | none | low |
| Siege Bolt | the heavy arrow | pinned actor id per arrow | **medium**: moving actors through walls and pillars needs `collision.ts`; bosses and Goldlings never pin |
| Hemorrhage, Blood Shards | `damageActor` | marks per actor slot (cleared on death and floor change) | medium: per-actor state and its clone / hash |
| ~~Overkill, Supernova~~ | moved to docs/LEGENDARIES.md | | |
| Wrecker, Powder Keg, Demolition | breakable hits (DECOR D4) | none (the chain runs through the proc queue) | medium: breakable counts per room, frame time on dense decor floors |
| Berserk, Adrenaline | hearts, flask drink, the Fury boost | none | low; co-op per player |
| Glutton, Devour | pellet pickup, the power pellet rule | power timer per player | low |
| Duo hint | `cardKind`, duo table | none (presentation) | none |
| Overcap points | `damageCapPerSecond` | none (a score source) | endless replays change |

Every row changes endless replays and scores from the first draft on, as v1 did (M1, fixtures and the tutorial do not
move). Recommend landing wave 1 **after BU14**, so the frame-time and readability numbers for v1 are known before more
bullets go on screen.

## Owner calls (settled 2026-11-07)

1. **Wave 1:** Riposte, Ballista and Wrecker, as proposed. Wave 2 stays Hemorrhage, Berserk and Glutton.
2. **Siege Bolt:** true pin and drag. The first non-boss enemy the heavy arrow hits is carried with it until the arrow
   hits a wall (bosses and the Goldling never pin). This needs the collision work in the risk table (medium).
3. **Berserk:** on at or below 25 % of max hearts, so it scales with Hearty and Stone Heart.
4. **Duo hint:** the badge only (presentation). No partner bias in the odds.
5. **Overcap points:** yes. Damage the boss cap throws away pops as small gold points at the boss, in its own score
   source (a score change: endless scores and replays change).
6. **Bastion + Riposte duo:** yes, designed as part of the wave 1 plan (Riposte lands in wave 1; the duo's rule is open,
   for example a brace also fires Riposte's counter-wave as a full ring).
