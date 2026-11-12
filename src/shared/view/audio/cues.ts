/**
 * Sim events -> theme sound IDs (the pure half of the client's AudioController). The web build declared the audio
 * events in its theme contract (sfx.*, music.*) but never played them (`theme.sound()` has no caller @ 42897e2), so
 * this mapping is new; it uses the contract's IDs where one fits and the Roblox-port additions (PORT_SFX, the theme's
 * PORT_AUDIO_EVENTS) for the events the contract has no ID for.
 *
 * Inputs per rendered frame: the frame's summed SimEvents (LiveRun.frameEvents: every tick of the frame, so no event
 * is lost on multi-tick frames), the hit tracker's FX events (per-actor hits / kills / boss phases), and the sim state
 * (the enemy-bullet spawn counter; per-player and per-floor edges through StateWatch, shared/view watch.ts). Output:
 * the cues to start this frame (sound ID + volume scale), each ID at most once per frame and once per its minimum
 * interval (a bow stream or a bullet ring is one sound, not fifty), at most one jingle (JINGLE_SFX), at most
 * AUDIO_VIEW.maxStartsPerFrame of them, the highest SFX_PRIORITY kept (the player's hurt and the telegraph over enemy
 * shots and hits).
 *
 * Silent IDs: the mapper's `playable` predicate (the controller passes `pack.sound(id).assetId !== undefined`) turns a
 * silent ID into its SFX_FALLBACK when that one plays, else drops it before it is a candidate: a silent sound never
 * takes a per-frame cap slot, the one jingle slot or a cooldown (`resolve`, also used for the menu sounds).
 *
 * Co-op (docs/FX_AUDIO.md X4): the summed events count the whole party, so in a party run the player sounds (hurt,
 * death, roll, flask, swing, finisher) come from the watch's per-player edges instead: the local player's at full
 * volume, a teammate's at AUDIO_VIEW.teammateVolume; shots, swaps and the bow's full charge are the local player's
 * only. The deflect (summed bulletsDeleted: the sim keeps no per-player count) is the local player's at full volume
 * when the local player could have deleted them this frame (guard up, this frame or the last, or a swing:
 * StateWatch.mayDeflect), else a teammate's. A solo run reads the summed events exactly as before (the watch only
 * picks swing vs finisher). The power pellet's erases (docs/PELLETS.md PL4: in bulletsDeleted too) are no deflect: the
 * deflect reads deflectedBullets (bulletsDeleted without them), and the power pellet plays sfx.pellet.power.
 *
 * Boost drops (docs/BOOSTS.md B7) come from the frame's collected drop events (shared/view/boosts BoostEventSource,
 * the run view's `boostEvents`, every tick of the frame): a landing plays sfx.boost.drop (a landing out of a broken
 * piece, `fromPiece`, plays sfx.breakable.loot instead: docs/BREAKABLE_DROPS.md BL6; the drop's sound while silent;
 * a loaded piece lost on a full floor, `lostLoot`, is silent: its break plays); a pickup sfx.boost.collect
 * (the local player's at full volume, a teammate's at AUDIO_VIEW.teammateVolume); a boost of the LOCAL player running
 * out sfx.boost.expire (a teammate's is silent); an Aegis pip absorbing a hit sfx.boost.aegisbreak (split like the
 * pickup).
 *
 * The combo (docs/COMBO.md CB4) comes from the score state and the frame's combo events (shared/view/fx
 * ComboFrameSource, the run view's `combo`, every tick of the frame):
 *   - Kill ladder (CD5, CD6): a regular kill's sfx.enemy.death plays at killPitchSpeed(combo), the score combo at the
 *     frame's end (`state.score.combo`, after every tick), with no pack jitter (it would mask a step), and ranks
 *     COMBO_KILL_PRIORITY (over swings and shots) so a busy frame never drops the one sound that carries the ladder.
 *     Several kills on one frame stay one cue at the final pitch. At x1.0, or in an unscored run, it is the plain cue
 *     (the pack's jitter, SFX_PRIORITY). The ladder follows the combo value, so a graze climbs it (with no kill sound:
 *     the graze has its own shimmer, GP6 below), a hit cut lowers it (the next kill is heard lower) and a streak end
 *     drops it to the plain cue; the combo is the party's, so a teammate's kill climbs it too. Boss kills keep
 *     sfx.boss.death, unladdered.
 *   - Tier sting (CD7): the frame's peak reached a higher tier than its start (comboTier) -> sfx.combo.tier at
 *     tierStingSpeed(tier). Re-earning a tier after a cut plays it again, never inside its 0.5 s interval.
 *   - Break (CD3, CD14): a streak end during a fight (ComboReset.fight) -> sfx.combo.break, at
 *     COMBO_VIEW.smallBreakVolume when it lost less than COMBO_VIEW.smallBreakBelow (x2.0). A lapse (no fight on) is
 *     silent. A hit cut has no sound of its own (CD4): the hurt sound plays on that frame.
 *   - Quiet: the sting and the break follow the combo display's gates. The controller passes the source through
 *     shared/view/fx audibleCombo(source, comboQuiet(covered, runOver)) with the predicates ComboController hands
 *     ComboDisplay, so under the stage cover or once the run is over the mapper sees NO_COMBO_EVENTS (no sting, no
 *     break); the kill ladder reads the live score combo and keeps its pitch.
 * Neither combo ID is a jingle or ducks the music; both obey the silent-ID, cooldown and cap rules like any cue.
 *
 * Grazes and parries (docs/GRAZE_PARRY.md GP6) come from the frame's NearMissFrame (shared/view/fx NearMissDirector,
 * stepped once per rendered frame by the client's NearMissController; `undefined`, as with no run, adds nothing and
 * leaves every other cue as before). The director already applies the scored-runs-only scope, the quiet gate (stage
 * cover, run over), the view-player rule and the chain ladder, so the mapper only places the cues:
 *   - Graze (GPD4): `grazeCue` (the view player's, at most one per frame, chained and spaced by the director) ->
 *     sfx.player.graze at exactly `grazeCue.speed` (no pack jitter), volume NEAR_MISS_VIEW.graze.volume, minimum
 *     interval NEAR_MISS_VIEW.graze.minIntervalSec, rank 53: under the player's hurt and the telegraph (a capped frame
 *     never drops those for it), over enemy shots and hits. A teammate's grazes are silent. Silent: nothing.
 *   - Parry (GPD5, GPD6, GPD10): the frame's `parryCues` make at most one sfx.player.parry (the local one wins over a
 *     teammate's, then the higher speed) at the cue's exact `speed` (1, or bigSemitones up for a big guard): the local
 *     (view) player's at full volume, a teammate's at AUDIO_VIEW.teammateVolume ranked TEAMMATE_PRIORITY_DROP
 *     lower; rank 57 (over the kill ladder, under the hurt and the telegraph). The parry REPLACES the deflect: a frame
 *     on which a guard erased bullets (a parry cue, or a PARRY! flash whose count grew: a later erase of the same
 *     guard) plays no sfx.player.deflect for that guard (solo: none; co-op: the deflect's local / teammate side is
 *     dropped when that side guarded). Swing deletes with no guard erase keep the deflect, and so does an unscored run
 *     (no parries).
 *     While sfx.player.parry is silent (SFX_FALLBACK -> the deflect) the mapper ignores parries entirely, so a guard
 *     plays today's deflect exactly (its volume, rank, jitter and co-op guess).
 * Neither ID is a jingle or ducks the music.
 *
 * Co-op moments (docs/RUN_RECAP.md CM4, CMD5): a SYNC! formed this frame (the client's TeamMomentsController.syncs(),
 * NO_SYNC_CUES by default) plays sfx.player.syncparry once per sync (not again when it grows), the view player's at full
 * volume, a teammate pair's quieter; while silent, the parry at +fallbackSemitones (merged with the frame's parry), and
 * nothing with both silent. TEAM PERFECT's jingle is RoomClearController's (roomClearStampJingle /
 * roomClearChipJingle: sfx.room.teamperfect in place of sfx.room.perfect on the stamp, and at the chip's volume on a far
 * client's chip), never a mapper cue.
 *
 * The boon draft reveal's five IDs (docs/DRAFT_REVEAL.md DR4: SFX.draftFlip .. draftPick) are never mapper cues: the
 * client's reveal controller plays them straight through AudioController.play(id, volume, speed) on the reveal's own
 * clock (the world is frozen under the draft). They are ranked, timed (SFX_MIN_INTERVAL) and listed (ALL_SFX, so the
 * pack's minInterval and the preload reach them) like every SFX; the flare ducks the music (DUCKING_SFX) from play().
 *
 * Enemy variants (docs/ENEMY_VARIANTS.md EV9 / EV11) come from the frame's VariantCueSource (shared/view/fx
 * VariantCueEvents, the run view's `variantCues`, every tick of the frame; NO_VARIANT_CUES by default, so every other
 * cue is as before). World sounds, the same for every player of a party (full volume, like the enemy's shot):
 *   - sfx.enemy.blink on an Imp's blink LANDING (the snap to its ring, then its aim line). The wind-up start already
 *     plays sfx.enemy.telegraph, so a blink sound there would only double it; the landing is the surprise to hear.
 *   - sfx.enemy.summon when a Summoner's cast resolves and its swarmers appear (its wind-up plays the telegraph).
 *   - sfx.enemy.split when an Ooze's slimelets appear (the tick it dies; its death sound plays too).
 *   - sfx.affix.shieldbreak on a shield breaking (AffixEvents.shieldBroke).
 *   - sfx.affix.vengeful when a Vengeful corpse fires its ring (AffixEvents.vengefulFired; the ring's bullets also
 *     raise the enemy shot). Arming (the kill) has no sound of its own: the kill plays the death sound.
 *   Quiet: the controller passes the source through shared/view/fx audibleVariantCues(source, comboQuiet(covered,
 *   runOver)), so under the stage cover or once the run is over none of the five plays. None is a jingle, ducks the
 *   music or has a fallback: a silent ID (the placeholder pack's) plays nothing and takes no cap slot.
 *   The second endless set (docs/NEW_ENEMIES.md NE8) rides on the same source and rules: sfx.enemy.fuse (a Bomber's
 *   fuse lit), .blast (its detonation; a fizzle plays the death only), .charge (a Charger leaves its lane), .stun (it
 *   hit a wall), .strike (strike bullets fired: SimEvents.strikes; strikes never raise the enemy shot, like goo),
 *   .spin (a Reaper's spin starts).
 *
 * The new-best celebration (docs/NEW_BEST.md NB5) comes from the frame's NewBestCueSource (shared/view/hud: the
 * client's NewBestTracker frame, stepped BEFORE the mapper in the same frame; NO_NEW_BEST_CUES by default, so every
 * other cue is as before). The tracker already holds its edges under the stage cover and drops them after run over:
 *   - Fanfare: `fanfare` (the shown score passed the best, or the first floor past the deepest at the card's reveal)
 *     -> sfx.best.new, a jingle ranked above the room clear's (NBD7: on a shared frame the CLEAR / PERFECT jingle is
 *     dropped, the stamp still shows). Silent: sfx.room.perfect plays (SFX_FALLBACK).
 *   - Deepest floor: on the frame the run enters the first floor past `recordFloor` (floorChanged, the floor before the
 *     frame at or under it, the floor after past it) sfx.floor.enter is dropped: the fanfare plays at the reveal in its
 *     place. Only while sfx.best.new (or its fallback) can play: with neither, the floor enter stays.
 *   - Run over: a record run (`recordRun`) plays sfx.jingle.record instead of sfx.jingle.gameover (runOverJingle);
 *     silent, the game-over jingle (SFX_FALLBACK). A run with no record keeps the game-over jingle.
 * Build effects (docs/BUILDS.md BU8) come from the frame's BuildFxFrameSource (shared/view/fx BuildFxEvents, the run
 * view's `builds`, every tick of the frame; NO_BUILD_FX_EVENTS by default, so every other cue is as before), passed
 * through audibleBuilds(source, comboQuiet(covered, runOver)) like the variants: silent under the stage cover and once
 * the run is over.
 *   - sfx.build.spark / .burst / .shard / .ember / .nova / .execute / .jackpot: at most one each per frame and per
 *     SFX_MIN_INTERVAL (BU5's releases reuse two: a Thrill Seeker ring or a Flurry release plays .burst, a Momentum
 *     volley or a Ricochet split .shard; a Phantom Step erase and a Lionheart heal play nothing of their own: the roll
 *     and the PERFECT sting already sound), at the exact speed buildGenSpeed(the frame's highest proc
 *     generation of that effect) (BUILD_FX_VIEW.audio: +2 semitones per generation, capped), volume
 *     BUILD_FX_VIEW.audio.volume; an effect only a teammate set off plays at teammateVolume more and
 *     TEAMMATE_PRIORITY_DROP lower. Voice cap: at most BUILD_FX_VIEW.audio.maxVoices of these start within any
 *     voiceWindowSec (counted from the cues that actually started); the rest of the frame's build cues are dropped in
 *     BUILD_VOICE_SFX order (the Overkill streak first, then the spark). A cascade is a climbing handful of sounds,
 *     never a machine gun.
 *   - sfx.build.evolve / .duo on an evolution / duo taken (BuildEvents' takes): the local (view) player's at full
 *     volume, a teammate's at teammateVolume; outside the voice cap, the pack's jitter.
 *   None is a jingle, ducks the music or has a fallback: a silent ID plays nothing and takes no cap slot.
 *   - sfx.build.overkill (docs/LEGENDARIES.md LG6): an Overkill streak struck, under the voice cap like the spark
 *     (first in BUILD_VOICE_SFX: the legendary's signature is the last build sound a busy frame drops), at
 *     buildGenSpeed(the frame's highest overkillGen): a chain climbs +2 semitones per link. Falls back to the spark
 *     while silent (LG5).
 *   - sfx.build.brace (LG6): a Bastion brace that restored a pip or healed (braceFeedbackOf: SPENT plays nothing),
 *     the local (view) player's at full volume, a teammate's at teammateVolume; outside the voice cap like the stings
 *     (it answers the player's own guard). Falls back to the Aegis break while silent (LG5).
 *   - Builds v2, wave 1 (docs/BUILDS_V2.md BV10 registered, BV11 maps them): sfx.build.counter on a counter-wave
 *     spawned (Riposte, Counterstrike, Rebuke: `waves`), sfx.build.pin on a Siege Bolt pin start (`pinStarts`),
 *     sfx.build.slam on its slam (`slams`): the player's own moves and their payoff, so like the brace outside the
 *     voice cap, the local (view) player's at full volume, a teammate's at teammateVolume, the pack's jitter.
 *     sfx.build.beam on a Full Heart beam (`heartBeams`): outside the cap too (one per finisher or heavy release, never
 *     a cascade), at BUILD_FX_VIEW.audio.volume (it rides on the swing / the release), a teammate's quieter.
 *     sfx.build.smash on a Wrecker smash (`smashes`): a cascade (a Demolition chain, Powder Keg), so UNDER the voice cap
 *     (in BUILD_VOICE_SFX right after the spark) at buildGenSpeed(the frame's highest smash generation) (wreckerFx.ts
 *     smashSpeed): a chain climbs +2 semitones a piece. Demolition's blast has no sound of its own (its piece's
 *     smash is the sound). Each falls back one step while silent (SFX_FALLBACK, BV10).
 *   - The parry ladder (BV11, Player experience 1): while the parry has a clip, on every frame the view player's PARRY!
 *     count grew past the guard's first frame (NearMissFrame.flashes: grew, not isNew) and they own Riposte,
 *     sfx.player.parry plays again at riposteParrySpeed(count) (BUILDS_V2_FX.parryLadder: +1 semitone per bullet the
 *     guard ate after the first, capped), at parryLadder.volume, at most once per parryLadder.minIntervalSec; the
 *     guard's first erase keeps its ordinary parry cue. A teammate's guard climbs silently.
 *
 * The Daily's rank layer (docs/DAILY.md DS10) comes from the frame's DailyRankCueSource (the client's
 * DailyRankController, stepped BEFORE the mapper in the same frame; NO_DAILY_RANK_CUES by default, so every other cue is
 * as before). The controller raises its edges only off the stage cover and before run over (the tracker holds and
 * drops them), so neither plays there:
 *   - `rankUp` (the predicted rank entered the top 100 / 10 / 3 / #1, with its floor shout) -> sfx.rank.up, a short
 *     sting ranked under the jingles (never one itself, no duck);
 *   - `friendPassed` (a friend's toast shows) -> sfx.friend.passed, under the rank-up.
 *   One of the three celebration sounds per frame: the new-best fanfare (`newBest.fanfare`) wins over both, the rank-up
 *   over the friend sting (new best > rank threshold > friend, as the floor shout's priorities). Silent: nothing (no
 *   fallback, no cap slot).
 *
 * Treasure rooms (docs/TREASURE.md TR8) come from the frame's TreasureCueSource (shared/view/treasure
 * TreasureCueTracker: the vault look's edges, stepped by the client in the same sound frame from the run view's
 * `treasure` and the sim clock; NO_TREASURE_CUES by default, so every other cue is as before). The edges follow the
 * look, not the ticks: `crack` on the crack's frame -> sfx.treasure.crack; `unlock` when the bars start to sink (0.6 s
 * after the clear, once the room clear's stamp has landed) -> sfx.treasure.unlock; `openTier` on the lid's pop (0.25 s
 * after the open) -> sfx.treasure.open at the exact speed treasureOpenSpeed(tier) (Common 0 / Rare +3 / Legendary +7
 * semitones, TREASURE_VIEW.audio), and for a Legendary sfx.jingle.treasure (a jingle that ducks the music, ranked 73:
 * under the new-best fanfare, over the room clear's jingles). World sounds, the same for every player of a party. The
 * open's boosts (`fromChest` landings, a subset of `dropped`) play no sfx.boost.drop: the sting is their sound (they
 * hop out 0.3 s after the open's tick). Silent: crack -> sfx.combo.break, unlock -> sfx.stairwell.open, open ->
 * sfx.relic.take (still pitched by tier), jingle -> sfx.room.perfect (SFX_FALLBACK, one step each).
 *
 * Every cue carries a playback speed (AudioCueList.speed): 0 = the pack's jitter (every cue but these), > 0 = that
 * exact PlaybackSpeed (the kill ladder, the tier sting, the graze, the parry and the chest's sting).
 *
 * Pacts (docs/FORTUNE.md FO9) come from the frame's collected pact events (shared/view/pacts PactFrameSource, the run
 * view's `pacts`): a pact taken plays sfx.pact.take (Greed split like a pickup, the Horde a party sound), the horde
 * room roused sfx.horde.horn, its second wave telegraphed sfx.horde.wave, its clear sfx.horde.double while the room
 * clear celebration is off (else the celebration plays it with the tally's Horde segment). The classic shrine's
 * sfx.shrine.use (StateWatch.shrineUsed) no longer counts pacts: a silent pact take falls back to it (SFX_FALLBACK).
 *
 * Presentation only: reads sim state, never writes it.
 */
import { VaultTier, floorModifierKey } from "shared/dungeon";
import {
	BOSS_DEMONLORD_ID,
	COMBO_MIN,
	PactKind,
	archetypeIndex,
	partySize,
	type SimEvents,
	type SimState,
} from "shared/sim";
import { AMBIENCE_IDS } from "shared/theme";
import { NO_BOOST_EVENTS, type BoostEventSource } from "../boosts";
import {
	BUILD_FX_VIEW,
	BUILDS_V2_FX,
	NEAR_MISS_VIEW,
	NO_BUILD_FX_EVENTS,
	NO_COMBO_EVENTS,
	braceFeedbackOf,
	buildGenSpeed,
	isRiposteOwner,
	riposteParrySpeed,
	type BuildFxFrameSource,
	type EffectRecord,
	type ComboFrameSource,
	type FxEvent,
	type NearMissFrame,
	type ParryCue,
	NO_VARIANT_CUES,
	TEAM_MOMENTS_VIEW,
	type SyncParryMoment,
	type VariantCueSource,
} from "../fx";
import {
	COMBO_VIEW,
	NO_DAILY_RANK_CUES,
	NO_NEW_BEST_CUES,
	comboTier,
	killPitchSpeed,
	semitonesToSpeed,
	tierStingSpeed,
	type DailyRankCueSource,
	type NewBestCueSource,
} from "../hud";
import { AUDIO_VIEW } from "./config";
import { StateWatch, SwingEdge } from "../watch";
import {
	NO_PELLET_EVENTS,
	PELLETS_VIEW,
	deflectedBullets,
	pelletEatSpeed,
	pelletRoomProgress,
	type PelletFrameSource,
} from "../pellets";
import { TREASURE_VIEW } from "../treasure/config";
import { NO_TREASURE_CUES, NO_TREASURE_OPEN, type TreasureCueSource } from "../treasure/cues";
import { NO_PACT_EVENTS, type PactFrameSource } from "../pacts/events";
import { GOLDEN_VIEW, NO_GOLDEN_EVENTS, goldenFrameHitCount, goldenHitSpeed, type GoldenFrameSource } from "../golden";

/** Every sound effect the game plays, by logical ID (theme manifest). */
export const SFX = {
	playerShoot: "sfx.player.shoot",
	playerSwing: "sfx.player.swing",
	/** The sword's finisher swing (combat.weapons.swing* with SWORD_V_LAST = SWORD_FINISHER), instead of the swing. */
	playerFinisher: "sfx.player.finisher",
	/** The bow's charge reaches full (the local player's). */
	playerCharged: "sfx.player.charged",
	playerRoll: "sfx.player.roll",
	playerFlask: "sfx.player.flask",
	playerSwap: "sfx.player.swap",
	playerHurt: "sfx.player.hurt",
	playerDeath: "sfx.player.death",
	playerDeflect: "sfx.player.deflect",
	ember: "sfx.ember",
	enemyShoot: "sfx.enemy.shoot",
	enemyTelegraph: "sfx.enemy.telegraph",
	enemyHurt: "sfx.enemy.hurt",
	enemyDeath: "sfx.enemy.death",
	bossRoar: "sfx.boss.roar",
	/**
	 * A taunting boss's phase change (BOSS_TAUNT_IDS: the Demon Lord's laugh), instead of the roar; a silent taunt
	 * falls back to the roar (SFX_FALLBACK).
	 */
	bossTaunt: "sfx.boss.taunt",
	bossDeath: "sfx.boss.death",
	victory: "sfx.victory",
	/** Breakable barrels / crates (docs/DECOR.md D4; the theme's BREAKABLE_AUDIO_EVENTS, required in every pack). */
	breakableHit: "sfx.breakable.hit",
	breakableBreak: "sfx.breakable.break",
	/** Endless floors (docs/FX_AUDIO.md A3): a combat room cleared, a relic pedestal taken, the curse shrine used. */
	roomClear: "sfx.room.clear",
	/** docs/ROOM_CLEAR.md RC4: PERFECT's stamp (a jingle; falls back to the CLEAR jingle while silent). */
	roomPerfect: "sfx.room.perfect",
	/** docs/ROOM_CLEAR.md RC4: a tally segment starts counting. */
	scoreTick: "sfx.score.tick",
	/** docs/ROOM_CLEAR.md RC4: the room bonus lands in the score panel. */
	scoreLand: "sfx.score.land",
	relicTake: "sfx.relic.take",
	shrineUse: "sfx.shrine.use",
	/** SimEvents stairwellOpened / floorChanged / depthChanged. */
	stairwellOpen: "sfx.stairwell.open",
	floorEnter: "sfx.floor.enter",
	depthUp: "sfx.depth.up",
	/** The run is over (every player dead): a jingle over the music fading out (X7). */
	gameOver: "sfx.jingle.gameover",
	uiClick: "sfx.ui.click",
	uiConfirm: "sfx.ui.confirm",
	/** Menu back / cancel, and a gamepad focus move (quiet, rate-limited). */
	uiBack: "sfx.ui.back",
	uiMove: "sfx.ui.move",
	/**
	 * Boost drops (docs/BOOSTS.md B7; the theme's PORT_AUDIO_EVENTS): a drop lands, is picked up, a boost's timer runs
	 * out, an Aegis pip absorbs a hit (`aegisbreak`: asset ID segments are lowercase).
	 */
	boostDrop: "sfx.boost.drop",
	boostCollect: "sfx.boost.collect",
	boostExpire: "sfx.boost.expire",
	boostAegisBreak: "sfx.boost.aegisbreak",
	/**
	 * The combo (docs/COMBO.md CB4; the theme's PORT_AUDIO_EVENTS): the tier-up sting (one clip, pitched per tier) and
	 * the break's shatter (a streak end during a fight).
	 */
	comboTier: "sfx.combo.tier",
	comboBreak: "sfx.combo.break",
	/**
	 * Grazes and parries (docs/GRAZE_PARRY.md GP6; the theme's PORT_AUDIO_EVENTS): the view player's graze shimmer (one
	 * clip, pitched by the graze chain) and a guard's parry ring-out (in place of the deflect; the deflect while silent).
	 */
	playerGraze: "sfx.player.graze",
	playerParry: "sfx.player.parry",
	/**
	 * The boon draft reveal (docs/DRAFT_REVEAL.md DR4; the theme's PORT_AUDIO_EVENTS). UI sounds the client's reveal
	 * controller plays itself (AudioController.play with the reveal's per-cue speed), never from sim events: a card
	 * flips (+2 semitones per card), a rare face lands (the chime), a legendary's charge (one hit, played six times as a
	 * rising ladder 0.16 -> 0.07 s apart), the legendary flare (a jingle: it ducks the music), a boon is taken (the stamp).
	 */
	draftFlip: "sfx.draft.flip",
	draftRare: "sfx.draft.rare",
	draftCharge: "sfx.draft.charge",
	draftLegendary: "sfx.draft.legendary",
	draftPick: "sfx.draft.pick",
	/**
	 * Enemy variants (docs/ENEMY_VARIANTS.md EV9 / EV11; the theme's PORT_AUDIO_EVENTS): an Imp's blink landing, a
	 * Summoner's summons appearing, an Ooze's split, a shield breaking (`shieldbreak`: asset ID segments are lowercase)
	 * and a Vengeful corpse firing its ring.
	 */
	enemyBlink: "sfx.enemy.blink",
	enemySummon: "sfx.enemy.summon",
	enemySplit: "sfx.enemy.split",
	affixShieldBreak: "sfx.affix.shieldbreak",
	affixVengeful: "sfx.affix.vengeful",
	/**
	 * The second endless set (docs/NEW_ENEMIES.md NE8; the theme's PORT_AUDIO_EVENTS): a Bomber's fuse lit and its
	 * detonation, a Charger's charge and its stun on a wall, a Stormcaller's strikes landing, a Reaper's spin.
	 */
	enemyFuse: "sfx.enemy.fuse",
	enemyBlast: "sfx.enemy.blast",
	enemyCharge: "sfx.enemy.charge",
	enemyStun: "sfx.enemy.stun",
	enemyStrike: "sfx.enemy.strike",
	enemySpin: "sfx.enemy.spin",
	/**
	 * The new-best celebration (docs/NEW_BEST.md NB5; the theme's PORT_AUDIO_EVENTS): the in-run fanfare (the shown
	 * score passes the best, or the first floor past the deepest; a jingle, the PERFECT jingle while silent) and a
	 * record run's run-over fanfare (in place of the game-over jingle, which plays while it is silent).
	 */
	bestNew: "sfx.best.new",
	jingleRecord: "sfx.jingle.record",
	/**
	 * Build effects (docs/BUILDS.md BU8; the theme's PORT_AUDIO_EVENTS, BUILD_AUDIO_IDS): a spark hop, a Volatile ring, a
	 * Soul Shards volley, an ember dropped, a nova, an execute, an evolution / a duo taken, a Jackpot pop.
	 */
	buildSpark: "sfx.build.spark",
	buildBurst: "sfx.build.burst",
	buildShard: "sfx.build.shard",
	buildEmber: "sfx.build.ember",
	buildNova: "sfx.build.nova",
	buildExecute: "sfx.build.execute",
	buildEvolve: "sfx.build.evolve",
	buildDuo: "sfx.build.duo",
	buildJackpot: "sfx.build.jackpot",
	/**
	 * The legendaries (docs/LEGENDARIES.md LG5; BUILD_AUDIO_IDS' last two): an Overkill streak strikes, a Bastion brace
	 * restores a pip (or heals, Stone Heart). Registered only: LG6 maps them. While silent they fall back to the spark
	 * and the Aegis pip's break (SFX_FALLBACK).
	 */
	buildOverkill: "sfx.build.overkill",
	buildBrace: "sfx.build.brace",
	/**
	 * Builds v2, wave 1 (docs/BUILDS_V2.md BV10; BUILD_AUDIO_IDS' last five): Riposte's counter-wave goes out, Siege
	 * Bolt pins an enemy / slams it into a wall, a Wrecker piece smashes (splinters, Demolition's blast), Full Heart's
	 * beam strikes. Registered only: BV11 maps them. While silent they fall back to the parry, the bow's full charge, a
	 * Charger's wall stun, the breakable break and the spark (SFX_FALLBACK).
	 */
	buildCounter: "sfx.build.counter",
	buildPin: "sfx.build.pin",
	buildSlam: "sfx.build.slam",
	buildSmash: "sfx.build.smash",
	buildBeam: "sfx.build.beam",
	/**
	 * The Daily's rank layer (docs/DAILY.md DS10; the theme's PORT_AUDIO_EVENTS): a predicted rank threshold (top 100 /
	 * 10 / 3 / #1, with the floor shout) and a friend passed (with their toast). Short stings, not jingles.
	 */
	rankUp: "sfx.rank.up",
	friendPassed: "sfx.friend.passed",
	/**
	 * Boosts from breakables (docs/BREAKABLE_DROPS.md BL5 / BL6; the theme's PORT_AUDIO_EVENTS): a loaded barrel / crate
	 * broke and its boost hopped out (BoostEventSource.fromPiece), in place of sfx.boost.drop for that landing, which
	 * plays while this one is silent (SFX_FALLBACK).
	 */
	breakableLoot: "sfx.breakable.loot",
	/**
	 * Pellets (docs/PELLETS.md PL7; the theme's PORT_AUDIO_EVENTS, PELLET_AUDIO_IDS): a pellet eaten (the chomp, two
	 * alternating pitches), a room swept (the sting with the clear), the power pellet taken.
	 */
	pelletEat: "sfx.pellet.eat",
	pelletSweep: "sfx.pellet.sweep",
	pelletPower: "sfx.pellet.power",
	/**
	 * Co-op moments (docs/RUN_RECAP.md CM4; the theme's PORT_AUDIO_EVENTS, TEAM_MOMENT_AUDIO_IDS): a party run's TEAM
	 * PERFECT jingle (in PERFECT's place; sfx.room.perfect while silent) and a SYNC! parry (two or three players' guards
	 * within the sync window; sfx.player.parry while silent). Registered only: the cue mapper's rules come with CM4's
	 * second half.
	 */
	roomTeamPerfect: "sfx.room.teamperfect",
	playerSyncParry: "sfx.player.syncparry",
	/**
	 * Treasure rooms (docs/TREASURE.md TR6; the theme's PORT_AUDIO_EVENTS, TREASURE_AUDIO_IDS): a vault's lock cracks
	 * (a metal snap), its cage unlocks (a rattle), its chest opens (the sting; TR8 pitches it by tier), a Legendary
	 * chest's jingle (ducks the music). The cue mapper plays them from TR8 on.
	 */
	treasureCrack: "sfx.treasure.crack",
	treasureUnlock: "sfx.treasure.unlock",
	treasureOpen: "sfx.treasure.open",
	jingleTreasure: "sfx.jingle.treasure",
	/**
	 * Fortune (docs/FORTUNE.md FO6; the theme's PORT_AUDIO_EVENTS, FORTUNE_AUDIO_IDS): a pact taken at an altar; the
	 * Horde room's horn on entry, its second wave, the x2 landing in the tally; the Goldling appearing, each hit on it,
	 * the jackpot of a catch, its escape. Each plays its SFX_FALLBACK while silent. The pacts' four are mapped from the
	 * run view's pact events (pactCues), the Goldling's four from its golden events (goldenCues; docs/FORTUNE.md FO9).
	 */
	pactTake: "sfx.pact.take",
	hordeHorn: "sfx.horde.horn",
	hordeWave: "sfx.horde.wave",
	hordeDouble: "sfx.horde.double",
	goldenAppear: "sfx.golden.appear",
	goldenHit: "sfx.golden.hit",
	goldenJackpot: "sfx.golden.jackpot",
	goldenEscape: "sfx.golden.escape",
	/**
	 * Floor modifiers (docs/FLOOR_MODIFIERS.md FM7; the theme's PORT_AUDIO_EVENTS, FLOOR_MODIFIER_AUDIO_IDS): one sting
	 * per kind on the floor card banner's stamp (FMD9: a boon's bright, the twist's ominous; asset ID segments are
	 * lowercase). Each plays its SFX_FALLBACK while silent. Registered only: the card plays floorModifierStingId(kind) on
	 * the stamp (FM5).
	 */
	floorModifierGilded: "sfx.floor.modifier.gilded",
	floorModifierHoard: "sfx.floor.modifier.hoard",
	floorModifierFeast: "sfx.floor.modifier.feast",
	floorModifierPlunder: "sfx.floor.modifier.plunder",
	floorModifierBloodMoon: "sfx.floor.modifier.bloodmoon",
} as const;
export type SfxId = (typeof SFX)[keyof typeof SFX];

/** Every SFX ID, in declaration order. */
export const ALL_SFX: ReadonlyArray<SfxId> = [
	SFX.playerShoot,
	SFX.playerSwing,
	SFX.playerFinisher,
	SFX.playerCharged,
	SFX.playerRoll,
	SFX.playerFlask,
	SFX.playerSwap,
	SFX.playerHurt,
	SFX.playerDeath,
	SFX.playerDeflect,
	SFX.ember,
	SFX.enemyShoot,
	SFX.enemyTelegraph,
	SFX.enemyHurt,
	SFX.enemyDeath,
	SFX.bossRoar,
	SFX.bossTaunt,
	SFX.bossDeath,
	SFX.victory,
	SFX.breakableHit,
	SFX.breakableBreak,
	SFX.roomClear,
	SFX.relicTake,
	SFX.shrineUse,
	SFX.stairwellOpen,
	SFX.floorEnter,
	SFX.depthUp,
	SFX.gameOver,
	SFX.uiClick,
	SFX.uiConfirm,
	SFX.uiBack,
	SFX.uiMove,
	SFX.boostDrop,
	SFX.boostCollect,
	SFX.boostExpire,
	SFX.boostAegisBreak,
	SFX.roomPerfect,
	SFX.scoreTick,
	SFX.scoreLand,
	SFX.comboTier,
	SFX.comboBreak,
	SFX.playerGraze,
	SFX.playerParry,
	SFX.draftFlip,
	SFX.draftRare,
	SFX.draftCharge,
	SFX.draftLegendary,
	SFX.draftPick,
	SFX.enemyBlink,
	SFX.enemySummon,
	SFX.enemySplit,
	SFX.affixShieldBreak,
	SFX.affixVengeful,
	SFX.enemyFuse,
	SFX.enemyBlast,
	SFX.enemyCharge,
	SFX.enemyStun,
	SFX.enemyStrike,
	SFX.enemySpin,
	SFX.bestNew,
	SFX.jingleRecord,
	SFX.buildSpark,
	SFX.buildBurst,
	SFX.buildShard,
	SFX.buildEmber,
	SFX.buildNova,
	SFX.buildExecute,
	SFX.buildEvolve,
	SFX.buildDuo,
	SFX.buildJackpot,
	SFX.buildOverkill,
	SFX.buildBrace,
	SFX.buildCounter,
	SFX.buildPin,
	SFX.buildSlam,
	SFX.buildSmash,
	SFX.buildBeam,
	SFX.rankUp,
	SFX.friendPassed,
	SFX.breakableLoot,
	SFX.pelletEat,
	SFX.pelletSweep,
	SFX.pelletPower,
	SFX.roomTeamPerfect,
	SFX.playerSyncParry,
	SFX.treasureCrack,
	SFX.treasureUnlock,
	SFX.treasureOpen,
	SFX.jingleTreasure,
	SFX.pactTake,
	SFX.hordeHorn,
	SFX.hordeWave,
	SFX.hordeDouble,
	SFX.goldenAppear,
	SFX.goldenHit,
	SFX.goldenJackpot,
	SFX.goldenEscape,
	SFX.floorModifierGilded,
	SFX.floorModifierHoard,
	SFX.floorModifierFeast,
	SFX.floorModifierPlunder,
	SFX.floorModifierBloodMoon,
];

/** IDs this port added to the placeholder pack (not in the web contract's AUDIO_EVENTS; theme PORT_AUDIO_EVENTS). */
export const PORT_SFX: ReadonlyArray<SfxId> = [
	SFX.playerSwing,
	SFX.playerFlask,
	SFX.playerSwap,
	SFX.playerDeflect,
	SFX.enemyTelegraph,
	SFX.bossDeath,
	SFX.victory,
	SFX.uiBack,
	SFX.uiMove,
	SFX.playerFinisher,
	SFX.playerCharged,
	SFX.roomClear,
	SFX.relicTake,
	SFX.shrineUse,
	SFX.stairwellOpen,
	SFX.floorEnter,
	SFX.depthUp,
	SFX.gameOver,
	SFX.bossTaunt,
	SFX.boostDrop,
	SFX.boostCollect,
	SFX.boostExpire,
	SFX.boostAegisBreak,
	SFX.roomPerfect,
	SFX.scoreTick,
	SFX.scoreLand,
	SFX.comboTier,
	SFX.comboBreak,
	SFX.playerGraze,
	SFX.playerParry,
	SFX.draftFlip,
	SFX.draftRare,
	SFX.draftCharge,
	SFX.draftLegendary,
	SFX.draftPick,
	SFX.enemyBlink,
	SFX.enemySummon,
	SFX.enemySplit,
	SFX.affixShieldBreak,
	SFX.affixVengeful,
	SFX.enemyFuse,
	SFX.enemyBlast,
	SFX.enemyCharge,
	SFX.enemyStun,
	SFX.enemyStrike,
	SFX.enemySpin,
	SFX.bestNew,
	SFX.jingleRecord,
	SFX.buildSpark,
	SFX.buildBurst,
	SFX.buildShard,
	SFX.buildEmber,
	SFX.buildNova,
	SFX.buildExecute,
	SFX.buildEvolve,
	SFX.buildDuo,
	SFX.buildJackpot,
	SFX.buildOverkill,
	SFX.buildBrace,
	SFX.buildCounter,
	SFX.buildPin,
	SFX.buildSlam,
	SFX.buildSmash,
	SFX.buildBeam,
	SFX.rankUp,
	SFX.friendPassed,
	SFX.breakableLoot,
	SFX.pelletEat,
	SFX.pelletSweep,
	SFX.pelletPower,
	SFX.roomTeamPerfect,
	SFX.playerSyncParry,
	SFX.treasureCrack,
	SFX.treasureUnlock,
	SFX.treasureOpen,
	SFX.jingleTreasure,
	SFX.pactTake,
	SFX.hordeHorn,
	SFX.hordeWave,
	SFX.hordeDouble,
	SFX.goldenAppear,
	SFX.goldenHit,
	SFX.goldenJackpot,
	SFX.goldenEscape,
	SFX.floorModifierGilded,
	SFX.floorModifierHoard,
	SFX.floorModifierFeast,
	SFX.floorModifierPlunder,
	SFX.floorModifierBloodMoon,
];

/**
 * Bosses whose phase changes (FxEvent bossPhase, phase >= 2) play sfx.boss.taunt instead of the roar: the Demon Lord
 * (his phase change is a laugh, the `taunt` animation). Mother Mayhem keeps the roar.
 */
export const BOSS_TAUNT_IDS: ReadonlyArray<string> = [BOSS_DEMONLORD_ID];

/** Music tracks by logical ID. */
export const MUSIC = {
	menu: "music.menu",
	boss: "music.boss",
	/** The first-run tutorial's track (falls back to the floor's biome track while silent). */
	tutorial: "music.tutorial",
	/** The lobby room's track (falls back to music.menu while silent). */
	lobby: "music.lobby",
	biomePrefix: "music.biome.",
} as const;

/** Biome music for biome index 1..5 ("music.biome.<n>"). */
export function biomeMusic(biome: number): string {
	return `${MUSIC.biomePrefix}${biome}`;
}

/** Number of biomes with a music track and an ambience bed (theme contract BIOMES). */
export const BIOME_MUSIC_COUNT = 5;

/** The ambience bed for biome index 1..5 (theme AMBIENCE_IDS, "amb.b<n>"), or undefined. */
export function biomeAmbience(biome: number): string | undefined {
	return biome >= 1 && biome <= BIOME_MUSIC_COUNT ? AMBIENCE_IDS[biome - 1] : undefined;
}

/** Every sound ID the audio layer can play (for the "exists in the pack" specs and the controller's preload). */
export function allAudioIds(): string[] {
	const out: string[] = [];
	for (const id of ALL_SFX) out.push(id);
	out.push(MUSIC.menu, MUSIC.boss, MUSIC.tutorial, MUSIC.lobby);
	for (let b = 1; b <= BIOME_MUSIC_COUNT; b++) out.push(biomeMusic(b));
	for (const id of AMBIENCE_IDS) out.push(id);
	out.sort();
	return out;
}

/**
 * The summed-event table, in play order within a frame: sim event field (summed over the frame's ticks) -> sound ID.
 * An entry fires when the field's frame total is > 0. In a party run the PLAYER_EVENT_FIELDS rows are replaced by the
 * watch's per-player edges.
 */
export const SIM_EVENT_SOUNDS: ReadonlyArray<readonly [keyof SimEvents, SfxId]> = [
	["playerDied", SFX.playerDeath],
	["playerHits", SFX.playerHurt],
	["emberUsed", SFX.ember],
	["rollStarted", SFX.playerRoll],
	["flaskUsed", SFX.playerFlask],
	["weaponSwapped", SFX.playerSwap],
	["shotsFired", SFX.playerShoot],
	["meleeSwings", SFX.playerSwing],
	["bulletsDeleted", SFX.playerDeflect],
	["telegraphs", SFX.enemyTelegraph],
	["bossEngaged", SFX.bossRoar],
	["bossDefeated", SFX.victory],
	["stairwellOpened", SFX.stairwellOpen],
	["floorChanged", SFX.floorEnter],
	["depthChanged", SFX.depthUp],
];

/** Summed events that say nothing about WHICH player: a party run reads these from the per-player edges. */
export const PLAYER_EVENT_FIELDS: ReadonlyArray<keyof SimEvents> = [
	"playerDied",
	"playerHits",
	"rollStarted",
	"flaskUsed",
	"weaponSwapped",
	"shotsFired",
	"meleeSwings",
	"bulletsDeleted",
];

/** Shortest gap between two starts of the same sound, seconds (0 = once per frame at most). A pack's minInterval wins. */
export const SFX_MIN_INTERVAL: Readonly<Partial<Record<SfxId, number>>> = {
	[SFX.playerShoot]: 0.06,
	[SFX.playerSwing]: 0.05,
	[SFX.playerFinisher]: 0.05,
	[SFX.playerDeflect]: 0.08,
	[SFX.enemyShoot]: 0.08,
	[SFX.enemyTelegraph]: 0.15,
	[SFX.enemyHurt]: 0.05,
	[SFX.enemyDeath]: 0.04,
	[SFX.playerHurt]: 0.1,
	[SFX.breakableHit]: 0.06,
	[SFX.breakableBreak]: 0.05,
	[SFX.uiMove]: 0.08,
	[SFX.boostDrop]: 0.1,
	[SFX.boostCollect]: 0.05,
	/** A sting per tier crossing, but a cut-and-re-earn flicker at a tier's edge never machine-guns it. */
	[SFX.comboTier]: 0.5,
	[SFX.comboBreak]: 0.5,
	/** The director already spaces graze cues this far apart (GPD4); the mapper's interval keeps a pack override. */
	[SFX.playerGraze]: NEAR_MISS_VIEW.graze.minIntervalSec,
	/** The flip ladder's cards land >= 0.22 s apart (a skip flips them all on one cue); this only stops a double start. */
	[SFX.draftFlip]: 0.05,
	/**
	 * The charge ladder's hits close in to 0.07 s apart (shared/view/hud DRAFT_REVEAL), so its interval stays under that:
	 * a guard against a doubled start, never a dropped rung.
	 */
	[SFX.draftCharge]: 0.05,
	/** Enemy variants: several imps landing / slimes splitting close together are one sound, not a stutter. */
	[SFX.enemyBlink]: 0.12,
	[SFX.enemySummon]: 0.2,
	[SFX.enemySplit]: 0.1,
	[SFX.affixShieldBreak]: 0.1,
	[SFX.affixVengeful]: 0.15,
	/**
	 * The second endless set (NE8): a pack of Bombers lighting together is one fuse; a two-Reaper room's spins and a
	 * Stormcaller pair's strikes never stutter.
	 */
	[SFX.enemyFuse]: 0.12,
	[SFX.enemyBlast]: 0.1,
	[SFX.enemyCharge]: 0.15,
	[SFX.enemyStun]: 0.15,
	[SFX.enemyStrike]: 0.12,
	[SFX.enemySpin]: 0.3,
	/** Build effects (BU8): a cascade's sparks / rings / volleys are one climbing sound per interval, never a stutter. */
	[SFX.buildSpark]: 0.06,
	[SFX.buildBurst]: 0.08,
	[SFX.buildShard]: 0.08,
	[SFX.buildEmber]: 0.12,
	[SFX.buildNova]: 0.15,
	[SFX.buildExecute]: 0.08,
	[SFX.buildJackpot]: 0.2,
	[SFX.buildEvolve]: 0.5,
	[SFX.buildDuo]: 0.5,
	/** docs/LEGENDARIES.md LG5: a chain's streaks climb like the sparks; one brace sound per brace (once per room). */
	[SFX.buildOverkill]: 0.06,
	[SFX.buildBrace]: 0.3,
	/**
	 * docs/BUILDS_V2.md BV10: one counter per guard (a co-op pair's two waves a moment apart are one); pins and slams
	 * of a volley of charged arrows; a Demolition chain climbs one piece a tick like the sparks; a finisher's beam.
	 */
	[SFX.buildCounter]: 0.15,
	[SFX.buildPin]: 0.1,
	[SFX.buildSlam]: 0.15,
	[SFX.buildSmash]: 0.06,
	[SFX.buildBeam]: 0.1,
	/** The rank layer (DS10): two thresholds a moment apart (or a friend toast each queue step) never stutter. */
	[SFX.rankUp]: 0.5,
	[SFX.friendPassed]: 0.3,
	/** Two loaded pieces broken by one swing / one ring are one sound (the boost drop's interval). */
	[SFX.breakableLoot]: 0.1,
	/** docs/PELLETS.md PL7: a line of pellets is a chomp every interval, never a buzz; two sweeps on one tick one sting. */
	[SFX.pelletEat]: PELLETS_VIEW.audio.eatMinIntervalSec,
	[SFX.pelletSweep]: PELLETS_VIEW.audio.stingMinIntervalSec,
	[SFX.pelletPower]: PELLETS_VIEW.audio.stingMinIntervalSec,
	/** docs/TREASURE.md TR6: one vault a floor, so these only guard a doubled start (a lockstep catch-up frame). */
	[SFX.treasureCrack]: 0.5,
	[SFX.treasureUnlock]: 0.5,
	[SFX.treasureOpen]: 0.5,
	/** docs/FORTUNE.md FO9: a flurry of hits on the Goldling is one climbing coin sound per interval, never a buzz. */
	[SFX.goldenHit]: GOLDEN_VIEW.audio.hitMinIntervalSec,
};

/**
 * Which sounds survive a busy frame (AUDIO_VIEW.maxStartsPerFrame): higher first. The player's hurt and death, the
 * run-over jingle, the telegraph and the Ember lead; enemy hits and shots go last.
 */
export const SFX_PRIORITY: Readonly<Record<SfxId, number>> = {
	[SFX.playerDeath]: 100,
	[SFX.playerHurt]: 95,
	[SFX.gameOver]: 92,
	/** The game-over jingle's slot: it plays in its place on a record run. */
	[SFX.jingleRecord]: 92,
	[SFX.enemyTelegraph]: 90,
	[SFX.ember]: 88,
	/** Above the victory: an endless boss kill plays the depth jingle, not both (JINGLE_SFX). */
	[SFX.depthUp]: 86,
	[SFX.victory]: 85,
	[SFX.bossDeath]: 84,
	[SFX.bossRoar]: 80,
	/** The roar's slot: it plays in the roar's place. */
	[SFX.bossTaunt]: 80,
	[SFX.stairwellOpen]: 75,
	/**
	 * The new-best fanfare (docs/NEW_BEST.md NBD7): above the combo break and the room clear's jingles, so on a shared
	 * frame the clear jingle is dropped (one jingle per frame); under the depth jingle and the victory.
	 */
	[SFX.bestNew]: 74,
	/**
	 * A Legendary chest's jingle (docs/TREASURE.md Design §4): under the new-best fanfare, over the room clear's jingles
	 * (one jingle per frame: an open never shares the clear's frame in play, the unlock waits 0.6 s, but a fanfare
	 * passing the best on the open's points wins).
	 */
	[SFX.jingleTreasure]: 73,
	/** The break: the loss you hear, above the room clear (they do not share a frame in practice). */
	[SFX.comboBreak]: 73,
	[SFX.roomClear]: 72,
	[SFX.roomPerfect]: 72,
	/** docs/RUN_RECAP.md CM4: TEAM PERFECT is PERFECT's jingle in a party run, so it ranks with it. */
	[SFX.roomTeamPerfect]: 72,
	[SFX.scoreLand]: 60,
	[SFX.scoreTick]: 30,
	[SFX.relicTake]: 70,
	[SFX.shrineUse]: 70,
	[SFX.floorEnter]: 68,
	/**
	 * The Daily's rank layer (docs/DAILY.md DS10): a rank threshold's sting under the jingles (the new-best fanfare, the
	 * room clear's) and over the floor enter's neighbours; a friend passed just under it.
	 */
	[SFX.rankUp]: 69,
	[SFX.friendPassed]: 67,
	/** An Aegis pip took the hit (the hurt sound plays too: it still counts as a hit). */
	[SFX.boostAegisBreak]: 66,
	/**
	 * The boon draft reveal (docs/DRAFT_REVEAL.md DR4): above everything else that can play over a frozen draft. The
	 * legendary flare ranks with the room clear's jingles, the charge over the drop / pick-up sounds.
	 */
	[SFX.draftLegendary]: 72,
	/** The tier-up sting: under the jingles and the room clear (a tier up on a room's last kill plays both). */
	[SFX.comboTier]: 65,
	[SFX.draftCharge]: 62,
	[SFX.boostCollect]: 64,
	/**
	 * Pellets (docs/PELLETS.md PL7): the power pellet with the boost pickup; the sweep's sting just over it (it shares
	 * the clear's frame with the jingle, which it never replaces: it is not a jingle); the chomp with the graze, the
	 * smallest rewards (a busy frame keeps the hurt, the telegraph and the kill ladder over it).
	 */
	[SFX.pelletPower]: 64,
	[SFX.pelletSweep]: 65,
	[SFX.pelletEat]: 53,
	/**
	 * Treasure rooms (docs/TREASURE.md TR6): the open's sting with the relic take (it is the reward you walked to); the
	 * unlock's rattle with the tier-up sting (it follows the room clear's stamp); the crack mid-fight under the hurt and
	 * the telegraph but over the kill ladder and the boost sounds, so a busy frame keeps the "so close" moment.
	 */
	[SFX.treasureOpen]: 70,
	[SFX.treasureCrack]: 66,
	[SFX.treasureUnlock]: 65,
	/**
	 * Fortune (docs/FORTUNE.md FO6, settled by FO9). A pact taken ranks with the shrine it replaced (a chosen
	 * reward in a quiet room). The Horde's horn is the room's fight starting: over the room clear's jingles and the
	 * stairwell, under the boss roar. Its second wave is danger information (new bodies at the rings): just under the
	 * telegraph and the Ember, over the jingles. The x2 landing in the tally just over the bonus landing it falls back
	 * to (the RoomClearController plays it, or the mapper while Room clear is Off).
	 */
	[SFX.pactTake]: 70,
	[SFX.hordeHorn]: 77,
	[SFX.hordeWave]: 87,
	[SFX.hordeDouble]: 61,
	/**
	 * The Goldling (docs/FORTUNE.md FO9). Its appearance is a call to act within 10 s: with the floor enter, over the
	 * tier sting and the pickups. Each hit is a small reward: with the graze and the chomp (never over the hurt, the
	 * telegraph or the kill ladder). The jackpot is a jingle (JINGLE_SFX, it ducks the music): over the room clear's
	 * jingles (a catch on a clear's frame keeps the jackpot), under the new-best fanfare (a catch that sets the best
	 * plays the fanfare). It ties a Legendary chest's jingle (73): on the rare frame with both, the chest's wins (the
	 * mapper cues the vault before the Goldling, and a tie keeps the first). The escape is a loss you hear, with the
	 * relic / shrine stings, under the combo break.
	 */
	[SFX.goldenAppear]: 68,
	[SFX.goldenHit]: 53,
	[SFX.goldenJackpot]: 73,
	[SFX.goldenEscape]: 70,
	/**
	 * A floor modifier's sting (docs/FLOOR_MODIFIERS.md FM7): just under the floor enter it follows (0.3 s later, on the
	 * banner's stamp), with the friend passed; over the tier sting and the pickups.
	 */
	[SFX.floorModifierGilded]: 67,
	[SFX.floorModifierHoard]: 67,
	[SFX.floorModifierFeast]: 67,
	[SFX.floorModifierPlunder]: 67,
	[SFX.floorModifierBloodMoon]: 67,
	/**
	 * A boost out of a broken piece (docs/BREAKABLE_DROPS.md BL6): just over a kill drop's landing (the rarer, chosen
	 * reward), under the pickup; over the piece's own break (40), which plays on the same frame.
	 */
	[SFX.breakableLoot]: 63,
	[SFX.boostDrop]: 62,
	[SFX.draftPick]: 60,
	[SFX.playerFlask]: 60,
	[SFX.playerRoll]: 58,
	/**
	 * A guard's parry (GP6): once per guard, over the kill ladder (55), the swing and the deflect it replaces; under the
	 * player's hurt and the telegraph.
	 */
	[SFX.playerParry]: 57,
	/** docs/RUN_RECAP.md CM4: a SYNC! parry, just over the parry it rides on (one per sync cooldown). */
	[SFX.playerSyncParry]: 58,
	[SFX.playerFinisher]: 56,
	[SFX.playerCharged]: 55,
	[SFX.draftRare]: 55,
	[SFX.playerSwing]: 54,
	/**
	 * The view player's graze shimmer (GP6): the smallest reward, under the swing and the kill ladder, over the player's
	 * own shot and every enemy sound (a capped frame never drops the hurt or the telegraph for it).
	 */
	[SFX.playerGraze]: 53,
	[SFX.playerShoot]: 52,
	[SFX.playerSwap]: 50,
	[SFX.playerDeflect]: 50,
	[SFX.draftFlip]: 50,
	/**
	 * Enemy variants (docs/ENEMY_VARIANTS.md): under every player sound, over the enemy's hurt, death and shot. A broken
	 * shield is the player's hit paying off (just under the swap / deflect); a Vengeful ring and an Imp's landing are
	 * danger (a ring and a fan follow; the telegraph itself ranks 90); summons and splits are new bodies.
	 */
	[SFX.affixShieldBreak]: 49,
	[SFX.affixVengeful]: 47,
	[SFX.enemyBlink]: 46,
	[SFX.enemySummon]: 42,
	[SFX.enemySplit]: 41,
	/**
	 * The second endless set (NE8), in the enemy variants' band: a detonation (a ring at point blank) and the strikes
	 * (they hurt where they land) are danger now; the stun is the player's opening; the fuse, charge and spin follow a
	 * telegraph that already sounded (rank 90).
	 */
	[SFX.enemyBlast]: 48,
	[SFX.enemyStrike]: 46,
	[SFX.enemyStun]: 45,
	[SFX.enemyCharge]: 44,
	[SFX.enemyFuse]: 43,
	[SFX.enemySpin]: 42,
	[SFX.boostExpire]: 48,
	/**
	 * Build effects (BU8): the evolve / duo stings with the tier sting; the Jackpot with the drops; an execute with the
	 * finisher; the cascade sounds under the player's own swing and shot (a busy frame keeps the hurt, the telegraph and
	 * the kill ladder over them), spark first, the ember (a quiet floor flame) last.
	 */
	[SFX.buildEvolve]: 64,
	[SFX.buildDuo]: 64,
	[SFX.buildJackpot]: 61,
	[SFX.buildExecute]: 56,
	[SFX.buildNova]: 52,
	[SFX.buildSpark]: 51,
	[SFX.buildBurst]: 48,
	[SFX.buildShard]: 47,
	[SFX.buildEmber]: 44,
	/**
	 * docs/LEGENDARIES.md LG5: an Overkill streak over the spark (the big hit paying off) and under the swing; a brace
	 * (a pip back) over the parry it often rides with, under the Aegis break, the hurt and the telegraph.
	 */
	[SFX.buildOverkill]: 53,
	[SFX.buildBrace]: 60,
	/**
	 * docs/BUILDS_V2.md BV10: the slam (Siege Bolt's payoff) and the counter (the guard's) over the parry they answer,
	 * under the brace, the hurt and the telegraph; the pin with the Overkill streak, under the swing; the beam over the
	 * shot it rides with; a smash over the breakable break and the burst, under the spark.
	 */
	[SFX.buildSlam]: 59,
	[SFX.buildCounter]: 58,
	[SFX.buildPin]: 53,
	[SFX.buildBeam]: 53,
	[SFX.buildSmash]: 49,
	[SFX.uiConfirm]: 45,
	[SFX.uiBack]: 45,
	[SFX.uiClick]: 44,
	[SFX.uiMove]: 43,
	[SFX.breakableBreak]: 40,
	[SFX.enemyDeath]: 35,
	[SFX.breakableHit]: 30,
	[SFX.enemyHurt]: 20,
	[SFX.enemyShoot]: 10,
};

/**
 * sfx.enemy.death's rank while the combo is above x1.0 (CD6; SFX_PRIORITY's 35 otherwise): over the swing (54), the
 * shot (52) and the deflect (50), tied with the bow's full charge, so a busy frame in a streak never drops the kill
 * sound that carries the pitch ladder.
 */
export const COMBO_KILL_PRIORITY = 55;

/** A teammate's cue ranks this much lower than the local player's same sound (never over the local telegraph). */
export const TEAMMATE_PRIORITY_DROP = 50;

/** An empty effect list (buildCue's absent extra lists). */
const NO_EFFECTS: ReadonlyArray<EffectRecord> = table.freeze([] as EffectRecord[]);

/** The build cues under the voice cap (BUILD_FX_VIEW.audio.maxVoices), in the order a busy frame keeps them. */
export const BUILD_VOICE_SFX: ReadonlyArray<SfxId> = [
	SFX.buildOverkill,
	SFX.buildSpark,
	/** docs/BUILDS_V2.md BV11: a Wrecker smash (a Demolition chain is a cascade); under the spark, over the burst. */
	SFX.buildSmash,
	SFX.buildBurst,
	SFX.buildShard,
	SFX.buildNova,
	SFX.buildExecute,
	SFX.buildJackpot,
	SFX.buildEmber,
];

/** AudioCueMapper.guardErased bits: whose guard erased bullets this frame (GP6). */
const GUARD_NONE = 0;
const GUARD_LOCAL = 1;
const GUARD_TEAMMATE = 2;

/** Sounds that dip the music (AUDIO_VIEW.duck) for their length: the jingles and the Ember. */
export const DUCKING_SFX: ReadonlyArray<SfxId> = [
	SFX.victory,
	SFX.depthUp,
	SFX.gameOver,
	SFX.jingleRecord,
	SFX.bestNew,
	SFX.jingleTreasure,
	SFX.roomClear,
	SFX.roomPerfect,
	SFX.roomTeamPerfect,
	SFX.shrineUse,
	SFX.draftLegendary,
	SFX.ember,
	/** docs/FORTUNE.md FO9: the Goldling's jackpot, like the other jingles. */
	SFX.goldenJackpot,
];

/**
 * Jingles (art/audio.json category "jingle"): at most one starts per frame, the highest SFX_PRIORITY (the others are
 * dropped before the cap and start no cooldown). An endless boss kill raises bossDefeated, depthChanged and
 * stairwellOpened on one tick: the depth jingle plays, not the victory over it (depth.up ranks above victory; M1 has
 * no depth, so its boss kill keeps the victory). sfx.relic.take is a short power-up sound, not a jingle. The draft's
 * legendary flare (docs/DRAFT_REVEAL.md DR4) is a jingle too, but the reveal controller plays it itself (the world is
 * frozen under the draft, so no mapper jingle shares its frame). The new-best fanfare outranks the room clear's
 * (docs/NEW_BEST.md NBD7); the record fanfare takes the game-over jingle's place. A Legendary chest's jingle
 * (docs/TREASURE.md TR6) and the Goldling's jackpot (docs/FORTUNE.md FO9) rank between the new-best fanfare and the
 * room clear's (tied at 73: the chest's is cued first and wins a shared frame).
 */
export const JINGLE_SFX: ReadonlyArray<SfxId> = [
	SFX.gameOver,
	SFX.jingleRecord,
	SFX.depthUp,
	SFX.victory,
	SFX.bestNew,
	SFX.jingleTreasure,
	/** docs/FORTUNE.md FO9: the Goldling's catch, in rank order: over the room clear's, under the new-best fanfare. */
	SFX.goldenJackpot,
	SFX.roomClear,
	SFX.roomPerfect,
	SFX.roomTeamPerfect,
	SFX.draftLegendary,
	SFX.shrineUse,
];

/**
 * A silent sound falls back to another ID: a pack without a finisher clip plays the plain swing there, one without a
 * back clip the click, one without a taunt the roar. sfx.ui.move has none on purpose (a click on every gamepad focus
 * move would buzz): it stays silent until it has its own clip.
 */
export const SFX_FALLBACK: Readonly<Partial<Record<SfxId, SfxId>>> = {
	[SFX.playerFinisher]: SFX.playerSwing,
	[SFX.uiBack]: SFX.uiClick,
	[SFX.bossTaunt]: SFX.bossRoar,
	[SFX.roomPerfect]: SFX.roomClear,
	/**
	 * GP6: while the parry is silent a guard sounds as before. The mapper honours this by not replacing the deflect at
	 * all (today's cue: its volume, rank, jitter and co-op attribution), so the entry is what `resolve` / `play` see.
	 */
	[SFX.playerParry]: SFX.playerDeflect,
	/** docs/NEW_BEST.md NB5: a pack without the fanfare plays the PERFECT jingle there (one step: not on to the CLEAR). */
	[SFX.bestNew]: SFX.roomPerfect,
	/** A pack without the record fanfare plays the game-over jingle on a record run's run over. */
	[SFX.jingleRecord]: SFX.gameOver,
	/**
	 * docs/BREAKABLE_DROPS.md BL5: a pack without the loot clip plays the boost drop's landing there (so a frame with a
	 * kill drop and a piece drop is one sfx.boost.drop: `cue` merges by the resolved ID).
	 */
	[SFX.breakableLoot]: SFX.boostDrop,
	/**
	 * docs/PELLETS.md PL7: until the pellet clips are uploaded, the chomp plays the room tally's tick (short and dry, so
	 * the room's ladder still climbs on it: the speed carries over), the Sweep the combo's tier sting and the power
	 * pellet the parry's bonus chime. One step each, like every entry here.
	 */
	[SFX.pelletEat]: SFX.scoreTick,
	[SFX.pelletSweep]: SFX.comboTier,
	[SFX.pelletPower]: SFX.playerParry,
	/**
	 * docs/RUN_RECAP.md CM4 (CMD5): until their clips exist, TEAM PERFECT plays the PERFECT jingle and a SYNC! parry the
	 * parry's ring-out. One step each: a pack where the parry is silent too has no SYNC! sound (the plan's +5 semitone
	 * parry is the mapper's, CM4's second half).
	 */
	[SFX.roomTeamPerfect]: SFX.roomPerfect,
	[SFX.playerSyncParry]: SFX.playerParry,
	/**
	 * docs/TREASURE.md TR6 (Design §5): until the treasure clips are uploaded (TR9), the crack plays the combo break's
	 * shatter, the unlock the stairwell opening, the open the relic take and a Legendary's jingle the PERFECT jingle.
	 * One step each, like every entry here.
	 */
	[SFX.treasureCrack]: SFX.comboBreak,
	[SFX.treasureUnlock]: SFX.stairwellOpen,
	[SFX.treasureOpen]: SFX.relicTake,
	[SFX.jingleTreasure]: SFX.roomPerfect,
	/**
	 * docs/FORTUNE.md FO6: until Fortune's clips are picked (FO10), a pact plays the curse shrine's sound; the Horde's
	 * horn the combo's tier sting, its second wave a Summoner's call, its x2 the bonus landing in the score; the
	 * Goldling's appearance the power pellet's power-up, each hit the tally's tick (short, so a hit ladder still climbs
	 * on it), the jackpot the PERFECT jingle and the escape the combo break's shatter. One step each.
	 */
	[SFX.pactTake]: SFX.shrineUse,
	[SFX.hordeHorn]: SFX.comboTier,
	[SFX.hordeWave]: SFX.enemySummon,
	[SFX.hordeDouble]: SFX.scoreLand,
	[SFX.goldenAppear]: SFX.pelletPower,
	[SFX.goldenHit]: SFX.scoreTick,
	[SFX.goldenJackpot]: SFX.roomPerfect,
	[SFX.goldenEscape]: SFX.comboBreak,
	/**
	 * docs/FLOOR_MODIFIERS.md FM7: until the stings are picked (FM10), a boon plays a Legendary chest's jingle (bright
	 * good news) and the twist the Horde's horn (a fight coming). One step each: while those are silent too (the
	 * placeholder pack; vale until their clips exist) the banner has no sting.
	 */
	[SFX.floorModifierGilded]: SFX.jingleTreasure,
	[SFX.floorModifierHoard]: SFX.jingleTreasure,
	[SFX.floorModifierFeast]: SFX.jingleTreasure,
	[SFX.floorModifierPlunder]: SFX.jingleTreasure,
	[SFX.floorModifierBloodMoon]: SFX.hordeHorn,
	/**
	 * docs/LEGENDARIES.md LG5: until the legendaries' clips are picked (LG8), an Overkill streak plays the spark's zap
	 * and a Bastion brace the Aegis pip's break (the player's armor sound). One step each: while the spark is silent too
	 * (the placeholder pack) a streak has no sound.
	 */
	[SFX.buildOverkill]: SFX.buildSpark,
	[SFX.buildBrace]: SFX.boostAegisBreak,
	/**
	 * docs/BUILDS_V2.md BV10: until wave 1's clips are picked (BV13), the counter plays the parry's chime (the guard it
	 * answers), the pin the bow's full-charge ping (the heavy arrow's own sound), the slam a Charger's wall stun (a body
	 * hitting a wall), a smash the breakable break and the beam the spark's zap. One step each: the placeholder pack's
	 * targets are silent too (no sound); the vale pack has clips for the first four targets, not yet the spark (BU12).
	 */
	[SFX.buildCounter]: SFX.playerParry,
	[SFX.buildPin]: SFX.playerCharged,
	[SFX.buildSlam]: SFX.enemyStun,
	[SFX.buildSmash]: SFX.breakableBreak,
	[SFX.buildBeam]: SFX.buildSpark,
};

/** The floor modifier stings by shared/dungeon floorModifierKey (MODIFIERS.kinds' keys). */
const FLOOR_MODIFIER_STINGS: Readonly<Record<string, SfxId>> = {
	gilded: SFX.floorModifierGilded,
	hoard: SFX.floorModifierHoard,
	feast: SFX.floorModifierFeast,
	plunder: SFX.floorModifierPlunder,
	bloodMoon: SFX.floorModifierBloodMoon,
};

/**
 * The sting of floor modifier `kind` (a shared/dungeon FloorModifier id: EndlessFloorLayout.modifier), played on the
 * floor card banner's stamp (docs/FLOOR_MODIFIERS.md FM5 / FM7); undefined for NONE or an unknown id (no banner, no
 * sting).
 */
export function floorModifierStingId(kind: number): SfxId | undefined {
	const key = floorModifierKey(kind);
	return key !== undefined ? FLOOR_MODIFIER_STINGS[key] : undefined;
}

/**
 * The run-over jingle (docs/NEW_BEST.md NB5): sfx.jingle.record on a record run (`recordSet`: the tracker's recordRun,
 * shared/view/hud isRecordRun), else sfx.jingle.gameover. The mapper plays it on the wipe; a client that plays the
 * run over itself uses the same choice.
 */
export function runOverJingle(recordSet: boolean): SfxId {
	return recordSet ? SFX.jingleRecord : SFX.gameOver;
}

/**
 * The room clear stamp's jingle (docs/ROOM_CLEAR.md RC4; docs/RUN_RECAP.md CM4): a co-op team perfect (CMD1: `team`,
 * only with `perfect`) plays sfx.room.teamperfect in place of sfx.room.perfect (its SFX_FALLBACK while silent, one
 * step: with both silent, nothing); otherwise PERFECT / CLEAR as before. RoomClearController plays it at full volume
 * when the stamp lands.
 */
export function roomClearStampJingle(perfect: boolean, team: boolean): SfxId {
	if (!perfect) return SFX.roomClear;
	return team ? SFX.roomTeamPerfect : SFX.roomPerfect;
}

/**
 * A far co-op clear's corner chip jingle (RCD12; CM4, CMD2): sfx.room.teamperfect when one of the frame's new chips is
 * a team perfect (`teamChips` > 0), else sfx.room.clear as before; RoomClearController plays it at
 * ROOM_CLEAR.chip.jingleVolume (the far-chip rule), every client the same tick.
 */
export function roomClearChipJingle(teamChips: number): SfxId {
	return teamChips > 0 ? SFX.roomTeamPerfect : SFX.roomClear;
}

/** No SYNC! this frame (the mapper's default: every other cue as before). */
export const NO_SYNC_CUES: ReadonlyArray<Pick<SyncParryMoment, "grew" | "points">> = [];

/**
 * sfx.treasure.open's PlaybackSpeed for an opened VaultTier (TREASURE_VIEW.audio.openSemitones: Common 0, Rare +3,
 * Legendary +7 semitones; 1 for a tier out of range).
 */
export function treasureOpenSpeed(tier: number): number {
	return semitonesToSpeed(TREASURE_VIEW.audio.openSemitones[tier] ?? 0);
}

/** Whether a sound ID has a clip in the theme pack (the controller passes `pack.sound(id).assetId !== undefined`). */
export type Playable = (id: string) => boolean;

/** Every ID plays (the specs' default, and musicFor's). */
export const EVERY_ID: Playable = () => true;

/** The FX events the mapper reads (the tracker's pooled buffer satisfies it). */
export interface FxEventSource {
	count(): number;
	/** `kind` (the archetype index; -1 / absent: unknown) picks a boss's taunt over the roar. */
	at(i: number): Pick<FxEvent, "type" | "boss" | "phase"> & Partial<Pick<FxEvent, "kind">>;
}

/**
 * One frame's cues: parallel id / volume-scale / playback-speed lists, reused frame after frame (no allocation once
 * grown).
 */
export class AudioCueList {
	private readonly ids = new Array<string>();
	private readonly volumes = new Array<number>();
	private readonly speeds = new Array<number>();
	private n = 0;

	size(): number {
		return this.n;
	}

	id(i: number): string {
		return this.ids[i];
	}

	/** The cue's volume scale, multiplied into the sound's own volume (1 = as the pack sets it). */
	volume(i: number): number {
		return this.volumes[i];
	}

	/**
	 * The cue's PlaybackSpeed: 0 = the pack's jitter as for any sound (SoundRef.pitch), > 0 = exactly this speed, no
	 * jitter (the kill ladder and the tier sting, docs/COMBO.md CB4).
	 */
	speed(i: number): number {
		return this.speeds[i];
	}

	clear(): void {
		this.n = 0;
	}

	push(id: string, volume: number, speed = 0): void {
		this.ids[this.n] = id;
		this.volumes[this.n] = volume;
		this.speeds[this.n] = speed;
		this.n++;
	}

	/** The IDs in order (specs and logs; allocates). */
	toIds(): string[] {
		const out: string[] = [];
		for (let i = 0; i < this.n; i++) out.push(this.ids[i]);
		return out;
	}
}

function priorityOf(id: string): number {
	return (SFX_PRIORITY as Readonly<Record<string, number>>)[id] ?? 0;
}

function isJingle(id: string): boolean {
	return (JINGLE_SFX as ReadonlyArray<string>).includes(id);
}

/** Archetype indices of BOSS_TAUNT_IDS (an unregistered id is left out). */
function tauntKinds(): number[] {
	const out: number[] = [];
	for (const id of BOSS_TAUNT_IDS) {
		const [ok, index] = pcall(() => archetypeIndex(id));
		if (ok) out.push(index as number);
	}
	return out;
}

/**
 * Turns one frame's events and state into the cues to start. Keeps per-ID cooldowns, the enemy-shot counter and the
 * state watch.
 */
export class AudioCueMapper {
	private readonly lastStart = new Map<string, number>();
	private readonly intervals = new Map<string, number>();
	private lastEnemySpawned = -1;
	readonly watch = new StateWatch();
	/** The room clear celebration plays the jingle itself (docs/ROOM_CLEAR.md RC4; Room clear On). */
	celebratesRoomClears = false;
	// This frame's candidates (parallel lists, reused).
	private readonly pendingIds = new Array<string>();
	private readonly pendingVolumes = new Array<number>();
	private readonly pendingRanks = new Array<number>();
	private readonly pendingSpeeds = new Array<number>();
	private pending = 0;
	private now = 0;
	private readonly tauntKinds = tauntKinds();
	/** Start times of the build cues under the voice cap (oldest first; pruned to the window every frame). */
	private readonly buildStarts = new Array<number>();
	/** Build cues queued this frame (they count against the cap before they start). */
	private buildQueued = 0;
	/** buildCue's scan of its lists: the highest generation, and whether the local player set one off. */
	private scanGen = 0;
	private scanMine = false;
	/** docs/BUILDS_V2.md BV11: the parry ladder's last start (real seconds; -huge: never). */
	private lastLadder = -math.huge;
	/** `playable`: whether an ID has a clip (silent IDs and their fallbacks; default: every ID plays). */
	constructor(private readonly playable: Playable = EVERY_ID) {}

	/**
	 * The ID that starts for `id`: itself when playable, else its SFX_FALLBACK when that one is, else undefined (silent:
	 * no cue, no cap slot, no cooldown).
	 */
	resolve(id: string): string | undefined {
		if (this.playable(id)) return id;
		const fallback = (SFX_FALLBACK as Readonly<Record<string, string>>)[id];
		return fallback !== undefined && this.playable(fallback) ? fallback : undefined;
	}

	/** A new run: forget the enemy-shot counter and the watched state (cooldowns keep running on real time). */
	reset(): void {
		this.lastEnemySpawned = -1;
		this.watch.reset();
	}

	/** A pack's per-sound minimum interval (SoundRef.minInterval), overriding SFX_MIN_INTERVAL; undefined clears it. */
	setMinInterval(id: string, seconds: number | undefined): void {
		if (seconds === undefined) this.intervals.delete(id);
		else this.intervals.set(id, seconds);
	}

	/** The minimum interval of `id`, seconds. */
	intervalOf(id: string): number {
		return this.intervals.get(id) ?? (SFX_MIN_INTERVAL as Readonly<Record<string, number>>)[id] ?? 0;
	}

	private coolingDown(id: string, now: number): boolean {
		const gap = this.intervalOf(id);
		const last = this.lastStart.get(id);
		return last !== undefined && gap > 0 && now - last < gap;
	}

	/**
	 * A menu sound outside the frame (sfx.ui.*): true when it may start now (it, or its fallback, is playable and its
	 * minimum interval has passed); a true answer counts as a start. A gamepad's focus moves go through here so holding
	 * the stick does not buzz.
	 */
	uiCue(now: number, id: string): boolean {
		if (this.resolve(id) === undefined || this.coolingDown(id, now)) return false;
		this.lastStart.set(id, now);
		return true;
	}

	/**
	 * A candidate for this frame (`id` resolved: a silent ID is its fallback or nothing): once per ID (the louder volume
	 * and higher rank win; a set `speed` replaces the earlier one: every kill of a frame carries the same final pitch),
	 * never inside its interval. `speed` 0 = the pack's jitter (AudioCueList.speed).
	 */
	private cue(soundId: SfxId, volume: number, rank: number = priorityOf(soundId), speed = 0): void {
		const id = this.resolve(soundId);
		if (id === undefined) return;
		for (let i = 0; i < this.pending; i++) {
			if (this.pendingIds[i] === id) {
				if (volume > this.pendingVolumes[i]) this.pendingVolumes[i] = volume;
				if (rank > this.pendingRanks[i]) this.pendingRanks[i] = rank;
				if (speed > 0) this.pendingSpeeds[i] = speed;
				return;
			}
		}
		if (this.coolingDown(id, this.now)) return;
		this.pendingIds[this.pending] = id;
		this.pendingVolumes[this.pending] = volume;
		this.pendingRanks[this.pending] = rank;
		this.pendingSpeeds[this.pending] = speed;
		this.pending++;
	}

	/** A player sound of player `i`: full volume for the local player, AUDIO_VIEW.teammateVolume for a teammate. */
	private playerCue(id: SfxId, i: number, localIndex: number): void {
		if (i === localIndex) this.cue(id, 1);
		else this.cue(id, AUDIO_VIEW.teammateVolume, priorityOf(id) - TEAMMATE_PRIORITY_DROP);
	}

	/**
	 * Whose guard erased bullets this frame (GUARD_* bits): a parry cue (a guard's first erase) or a PARRY! flash whose
	 * count grew (a later erase of the same guard). A `local` cue and `localIndex`'s flash (the director's view player,
	 * the same index) are GUARD_LOCAL, anyone else's GUARD_TEAMMATE.
	 */
	private guardErased(frame: Readonly<NearMissFrame> | undefined, localIndex: number): number {
		if (frame === undefined) return GUARD_NONE;
		let bits = GUARD_NONE;
		for (const c of frame.parryCues) bits = bit32.bor(bits, c.local ? GUARD_LOCAL : GUARD_TEAMMATE);
		for (const f of frame.flashes) {
			if (f.grew) bits = bit32.bor(bits, f.player === localIndex ? GUARD_LOCAL : GUARD_TEAMMATE);
		}
		return bits;
	}

	/**
	 * At most one sfx.player.parry per frame: the local (view) player's guard if one started, else the teammate's with
	 * the highest speed (the bigger guard); the local one at full volume, a teammate's at AUDIO_VIEW.teammateVolume and
	 * TEAMMATE_PRIORITY_DROP lower. Its speed is the cue's (1, or bigSemitones up), exact.
	 */
	private parryCue(frame: Readonly<NearMissFrame>): void {
		let best: ParryCue | undefined;
		for (const c of frame.parryCues) {
			if (best === undefined || (c.local && !best.local) || (c.local === best.local && c.speed > best.speed))
				best = c;
		}
		if (best === undefined) return;
		const rank = priorityOf(SFX.playerParry);
		if (best.local) this.cue(SFX.playerParry, 1, rank, best.speed);
		else this.cue(SFX.playerParry, AUDIO_VIEW.teammateVolume, rank - TEAMMATE_PRIORITY_DROP, best.speed);
	}

	/**
	 * The parry ladder (docs/BUILDS_V2.md BV11; see the file comment): the view player's Riposte guard that ate more
	 * bullets this frame (a flash that grew, not on its first frame) plays the parry again at riposteParrySpeed(count),
	 * at most once per parryLadder.minIntervalSec. It merges into the frame's parry cue (one sound: the louder volume,
	 * the ladder's speed).
	 */
	private parryLadderCue(frame: Readonly<NearMissFrame>, state: Readonly<SimState>, localIndex: number): void {
		const l = BUILDS_V2_FX.parryLadder;
		if (this.now - this.lastLadder < l.minIntervalSec) return;
		for (const f of frame.flashes) {
			if (f.player !== localIndex || !f.grew || f.isNew || !isRiposteOwner(state, f.player)) continue;
			this.cue(SFX.playerParry, l.volume, priorityOf(SFX.playerParry), riposteParrySpeed(f.count));
			this.lastLadder = this.now;
			return;
		}
	}

	/**
	 * SYNC! (docs/RUN_RECAP.md CM4, CMD5): at most one sfx.player.syncparry per frame, for a sync FORMED this frame (a
	 * record that `grew` adds a player to an earlier one: no second cue, that player's own parry plays); the view
	 * player's sync (a point of `localIndex`) at full volume, anyone else's at AUDIO_VIEW.teammateVolume and
	 * TEAMMATE_PRIORITY_DROP lower. While silent it resolves to sfx.player.parry at
	 * TEAM_MOMENTS_VIEW.syncAudio.fallbackSemitones up: that merges into the frame's parry cue (one sound, the higher
	 * pitch); with the parry silent too, nothing.
	 */
	private syncCue(syncs: ReadonlyArray<Pick<SyncParryMoment, "grew" | "points">>, localIndex: number): void {
		let found = false;
		let mine = false;
		for (const s of syncs) {
			if (s.grew) continue;
			found = true;
			for (const p of s.points) if (p.player === localIndex) mine = true;
		}
		if (!found) return;
		const id = this.resolve(SFX.playerSyncParry);
		if (id === undefined) return;
		const speed = id === SFX.playerSyncParry ? 0 : semitonesToSpeed(TEAM_MOMENTS_VIEW.syncAudio.fallbackSemitones);
		const rank = priorityOf(SFX.playerSyncParry) - (mine ? 0 : TEAMMATE_PRIORITY_DROP);
		this.cue(SFX.playerSyncParry, mine ? 1 : AUDIO_VIEW.teammateVolume, rank, speed);
	}

	/** Build voices in use: starts within BUILD_FX_VIEW.audio.voiceWindowSec of `now` plus this frame's queued ones. */
	private buildVoices(): number {
		const window = BUILD_FX_VIEW.audio.voiceWindowSec;
		while (this.buildStarts.size() > 0 && this.now - this.buildStarts[0] >= window) this.buildStarts.remove(0);
		return this.buildStarts.size() + this.buildQueued;
	}

	/**
	 * One build effect cue (BU8) for the frame's records of it, from up to three lists (the follow-up's evolution
	 * releases share the burst / shard cues): none -> nothing; else at buildGenSpeed(highest gen),
	 * BUILD_FX_VIEW.audio.volume, quieter and lower when only teammates set it off; under the voice cap.
	 */
	private buildCue(
		id: SfxId,
		localIndex: number,
		a: ReadonlyArray<EffectRecord>,
		b: ReadonlyArray<EffectRecord> = NO_EFFECTS,
		c: ReadonlyArray<EffectRecord> = NO_EFFECTS,
	): void {
		if (a.size() + b.size() + c.size() === 0) return;
		this.scanGen = 0;
		this.scanMine = false;
		this.scanEffects(a, localIndex);
		this.scanEffects(b, localIndex);
		this.scanEffects(c, localIndex);
		this.buildVoiceCue(id, this.scanGen, this.scanMine);
	}

	/** Raises scanGen to the records' highest generation; scanMine when one is `localIndex`'s. */
	private scanEffects(records: ReadonlyArray<EffectRecord>, localIndex: number): void {
		for (const r of records) {
			if (r.gen > this.scanGen) this.scanGen = r.gen;
			if (r.owner === localIndex) this.scanMine = true;
		}
	}

	private buildVoiceCue(id: SfxId, gen: number, mine: boolean): void {
		if (this.buildVoices() >= BUILD_FX_VIEW.audio.maxVoices) return;
		const volume = BUILD_FX_VIEW.audio.volume * (mine ? 1 : AUDIO_VIEW.teammateVolume);
		const rank = priorityOf(id) - (mine ? 0 : TEAMMATE_PRIORITY_DROP);
		const before = this.pending;
		this.cue(id, volume, rank, buildGenSpeed(gen));
		if (this.pending > before) this.buildQueued++;
	}

	/**
	 * The frame's pact cues (docs/FORTUNE.md FO9): sfx.pact.take for each pact taken (Greed is a player's own: a
	 * teammate's quieter, lower-ranked; the Horde arms the whole party's next room: full volume for everyone);
	 * sfx.horde.horn when the horde room is roused; sfx.horde.wave when its second wave is telegraphed (the rings' start,
	 * the warning before the bodies); sfx.horde.double when the horde room clears while the room clear celebration is off
	 * (with it on, RoomClearController plays it as the tally's Horde segment slams in). All world / party sounds but
	 * Greed's take; none ducks the music (the pact take's fallback, the shrine's jingle, ducks as the shrine did).
	 */
	private pactCues(pacts: PactFrameSource, localIndex: number): void {
		for (const t of pacts.taken) {
			if (t.kind === PactKind.GREED) this.playerCue(SFX.pactTake, t.player, localIndex);
			else this.cue(SFX.pactTake, 1);
		}
		if (pacts.roused.size() > 0) this.cue(SFX.hordeHorn, 1);
		if (pacts.telegraphed.size() > 0) this.cue(SFX.hordeWave, 1);
		if (pacts.hordeCleared > 0 && !this.celebratesRoomClears) this.cue(SFX.hordeDouble, 1);
	}

	/**
	 * The frame's pellet cues (docs/PELLETS.md PL7): one chomp for every pellet eaten this frame (full volume when the
	 * local player took one, else a teammate's quieter, lower-ranked cue), pitched up the room's ladder
	 * (pelletEatSpeed: the frame's last pellet, the local player's when they took one, against its room's progress
	 * after the frame's ticks, so a teammate's pellets climb the shared room's ladder too); the sweep sting for any room
	 * swept; the power pellet as a player sound of its picker.
	 */
	private pelletCues(pellets: PelletFrameSource, localIndex: number, state: Readonly<SimState>): void {
		const eaten = pellets.eaten;
		if (eaten.size() > 0) {
			let mine = false;
			let last = eaten[eaten.size() - 1].index;
			for (const e of eaten) {
				if (e.player !== localIndex) continue;
				mine = true;
				last = e.index;
			}
			const progress = pelletRoomProgress(state, last);
			const speed = progress !== undefined ? pelletEatSpeed(progress[0], progress[1]) : 1;
			const rank = priorityOf(SFX.pelletEat) - (mine ? 0 : TEAMMATE_PRIORITY_DROP);
			this.cue(SFX.pelletEat, mine ? 1 : AUDIO_VIEW.teammateVolume, rank, speed);
		}
		if (pellets.swept.size() > 0) this.cue(SFX.pelletSweep, 1);
		for (const p of pellets.power) this.playerCue(SFX.pelletPower, p.player, localIndex);
	}

	/**
	 * The frame's vault cues (docs/TREASURE.md TR8; see the file comment): the crack, the rattle, the sting pitched by
	 * the opened tier and a Legendary's jingle.
	 */
	private treasureCues(treasure: TreasureCueSource): void {
		if (treasure.crack) this.cue(SFX.treasureCrack, 1);
		if (treasure.unlock) this.cue(SFX.treasureUnlock, 1);
		const tier = treasure.openTier;
		if (tier === NO_TREASURE_OPEN) return;
		this.cue(SFX.treasureOpen, 1, priorityOf(SFX.treasureOpen), treasureOpenSpeed(tier));
		if (tier === VaultTier.LEGENDARY) this.cue(SFX.jingleTreasure, 1);
	}

	/**
	 * The frame's Goldling cues (docs/FORTUNE.md FO9; every client sees the same Goldling, so these are world sounds
	 * like the enemy variants' and the pellets', not positional): its appearance; ONE hit sound for the frame's damaging
	 * hits, pitched up the ladder by the highest hit count of the frame (goldenHitSpeed: the hits are the Goldling's, so
	 * a teammate's climb the same ladder), at full volume when the local player landed one, else a teammate's quieter,
	 * lower-ranked cue; the jackpot of a catch (anyone's: a jingle, it ducks the music); its escape.
	 */
	private goldenCues(golden: GoldenFrameSource, localIndex: number): void {
		if (golden.appeared.size() > 0) this.cue(SFX.goldenAppear, 1);
		const hits = golden.hits;
		if (hits.size() > 0) {
			let mine = false;
			for (const h of hits) if (h.player === localIndex) mine = true;
			const rank = priorityOf(SFX.goldenHit) - (mine ? 0 : TEAMMATE_PRIORITY_DROP);
			const speed = goldenHitSpeed(goldenFrameHitCount(golden));
			this.cue(SFX.goldenHit, mine ? 1 : AUDIO_VIEW.teammateVolume, rank, speed);
		}
		if (golden.caught.size() > 0) this.cue(SFX.goldenJackpot, 1);
		if (golden.escaped.size() > 0) this.cue(SFX.goldenEscape, 1);
	}

	/** The frame's build cues (BU8; see the file comment). */
	private buildCues(builds: BuildFxFrameSource, localIndex: number): void {
		const streaks = builds.overkills;
		if (streaks.size() > 0) {
			let gen = 0;
			let mine = false;
			for (const r of streaks) {
				if (r.gen > gen) gen = r.gen;
				if (r.owner === localIndex) mine = true;
			}
			this.buildVoiceCue(SFX.buildOverkill, gen, mine);
		}
		const sparks = builds.sparks;
		if (sparks.size() > 0) {
			let gen = 0;
			let mine = false;
			for (const r of sparks) {
				if (r.gen > gen) gen = r.gen;
				if (r.owner === localIndex) mine = true;
			}
			this.buildVoiceCue(SFX.buildSpark, gen, mine);
		}
		// docs/BUILDS_V2.md BV11: a Wrecker smash, under the cap, climbing with the chain's generation.
		this.smashCue(builds.smashes, localIndex);
		this.buildCue(SFX.buildBurst, localIndex, builds.bursts, builds.thrills, builds.flurries);
		this.buildCue(SFX.buildShard, localIndex, builds.shards, builds.momentum, builds.ricochets);
		this.buildCue(SFX.buildNova, localIndex, builds.novas);
		this.buildCue(SFX.buildExecute, localIndex, builds.executes);
		this.buildCue(SFX.buildJackpot, localIndex, builds.jackpots);
		this.buildCue(SFX.buildEmber, localIndex, builds.embers);
		for (const t of builds.evolved) this.playerCue(SFX.buildEvolve, t.player, localIndex);
		for (const t of builds.duos) this.playerCue(SFX.buildDuo, t.player, localIndex);
		for (const r of builds.braces)
			if (braceFeedbackOf(r.kind).sound) this.playerCue(SFX.buildBrace, r.owner, localIndex);
		// docs/BUILDS_V2.md BV11: the counter, the pin and the slam answer the player's own moves (outside the cap).
		for (const r of builds.waves) this.playerCue(SFX.buildCounter, r.owner, localIndex);
		for (const r of builds.pinStarts) this.playerCue(SFX.buildPin, r.owner, localIndex);
		for (const r of builds.slams) this.playerCue(SFX.buildSlam, r.owner, localIndex);
		for (const r of builds.heartBeams) this.beamCue(r.owner, localIndex);
	}

	/**
	 * BV11: one sfx.build.smash for the frame's smashes, under the voice cap, at buildGenSpeed(the highest generation)
	 * (wreckerFx.ts smashSpeed, the same ladder).
	 */
	private smashCue(smashes: ReadonlyArray<EffectRecord>, localIndex: number): void {
		if (smashes.size() === 0) return;
		let gen = 0;
		let mine = false;
		for (const r of smashes) {
			if (r.gen > gen) gen = r.gen;
			if (r.owner === localIndex) mine = true;
		}
		this.buildVoiceCue(SFX.buildSmash, gen, mine);
	}

	/** BV11: a Full Heart beam at the build volume (a teammate's quieter, lower), outside the voice cap. */
	private beamCue(owner: number, localIndex: number): void {
		const mine = owner === localIndex;
		const volume = BUILD_FX_VIEW.audio.volume * (mine ? 1 : AUDIO_VIEW.teammateVolume);
		this.cue(SFX.buildBeam, volume, priorityOf(SFX.buildBeam) - (mine ? 0 : TEAMMATE_PRIORITY_DROP));
	}

	/**
	 * NB5: this frame entered the first floor past the record (`newBest.recordFloor` > 0; floorChanged, the floor before
	 * the frame's changes at or under it, the floor after past it) and the fanfare can play (sfx.best.new or its
	 * fallback): the floor enter is dropped.
	 */
	private deepestEntered(events: Readonly<SimEvents>, state: Readonly<SimState>, newBest: NewBestCueSource): boolean {
		const record = newBest.recordFloor;
		if (!(record > 0) || !(events.floorChanged > 0) || state.endless === undefined) return false;
		const floor = state.endless.floor;
		if (floor <= record || floor - events.floorChanged > record) return false;
		return this.resolve(SFX.bestNew) !== undefined;
	}

	/** Removes candidate `at`, keeping the order of the rest. */
	private dropPending(at: number): void {
		for (let i = at; i < this.pending - 1; i++) {
			this.pendingIds[i] = this.pendingIds[i + 1];
			this.pendingVolumes[i] = this.pendingVolumes[i + 1];
			this.pendingRanks[i] = this.pendingRanks[i + 1];
			this.pendingSpeeds[i] = this.pendingSpeeds[i + 1];
		}
		this.pending--;
	}

	/** Keeps one jingle (JINGLE_SFX): the highest-ranked (the earlier one on a tie); drops the others. */
	private keepOneJingle(): void {
		let best = -1;
		for (let i = 0; i < this.pending; i++) {
			if (isJingle(this.pendingIds[i]) && (best < 0 || this.pendingRanks[i] > this.pendingRanks[best])) best = i;
		}
		if (best < 0) return;
		let i = 0;
		while (i < this.pending) {
			if (i !== best && isJingle(this.pendingIds[i])) {
				this.dropPending(i);
				if (i < best) best--;
			} else i++;
		}
	}

	/** Drops the lowest-ranked candidates (the later one on a tie) down to the per-frame cap. */
	private applyCap(): void {
		const cap = AUDIO_VIEW.maxStartsPerFrame;
		while (this.pending > cap) {
			let worst = 0;
			for (let i = 1; i < this.pending; i++) {
				if (this.pendingRanks[i] <= this.pendingRanks[worst]) worst = i;
			}
			this.dropPending(worst);
		}
	}

	/**
	 * One rendered frame at real time `now` (seconds): `events` are the frame's summed SimEvents, `fx` the tracker's
	 * events of the frame, `state` the run's state after the frame, `localIndex` this client's player (0 solo; the
	 * watched teammate while spectating, docs/SPECTATE.md: its sounds play at full volume), `boosts` the frame's
	 * boost-drop events (the run view's `boostEvents`; none by default), `combo` the frame's combo events (the run
	 * view's `combo`, docs/COMBO.md CB1; none by default), `nearMiss` the frame's grazes and parries output
	 * (NearMissController's NearMissFrame of THIS frame, docs/GRAZE_PARRY.md GP6; undefined / no run: nothing, today's
	 * cues exactly), `variants` the frame's enemy-variant events (the run view's `variantCues` through
	 * audibleVariantCues, docs/ENEMY_VARIANTS.md; none by default), `newBest` the frame's new-best cues (the client's
	 * NewBestTracker frame of THIS frame, docs/NEW_BEST.md NB5; none by default), `builds` the frame's build effects (the
	 * run view's `builds` through audibleBuilds, docs/BUILDS.md BU8; none by default), `rank` the frame's daily rank cues
	 * (the client's DailyRankController of THIS frame, docs/DAILY.md DS10; none by default), `pellets` the frame's pellet
	 * events (the run view's `pellets`, docs/PELLETS.md PL7; none by default), `syncs` the frame's SYNC! records (the
	 * client's TeamMomentsController.syncs() of THIS near-miss frame, docs/RUN_RECAP.md CM4; none by default),
	 * `treasure` the frame's vault sound edges (the client's TreasureCueTracker of THIS frame, docs/TREASURE.md TR8;
	 * none by default), `pacts` the frame's pact events (the run view's `pacts`, docs/FORTUNE.md FO9; none by default),
	 * `golden` the frame's Goldling events (the run view's `golden`, docs/FORTUNE.md FO9; none by default). Appends the
	 * cues to start to `out` (in table order) and returns it.
	 */
	frame(
		now: number,
		events: Readonly<SimEvents>,
		fx: FxEventSource,
		state: Readonly<SimState>,
		localIndex: number,
		out: AudioCueList,
		boosts: BoostEventSource = NO_BOOST_EVENTS,
		combo: ComboFrameSource = NO_COMBO_EVENTS,
		nearMiss: Readonly<NearMissFrame> | undefined = undefined,
		variants: VariantCueSource = NO_VARIANT_CUES,
		newBest: NewBestCueSource = NO_NEW_BEST_CUES,
		builds: BuildFxFrameSource = NO_BUILD_FX_EVENTS,
		rank: DailyRankCueSource = NO_DAILY_RANK_CUES,
		pellets: PelletFrameSource = NO_PELLET_EVENTS,
		syncs: ReadonlyArray<Pick<SyncParryMoment, "grew" | "points">> = NO_SYNC_CUES,
		treasure: TreasureCueSource = NO_TREASURE_CUES,
		pacts: PactFrameSource = NO_PACT_EVENTS,
		golden: GoldenFrameSource = NO_GOLDEN_EVENTS,
	): AudioCueList {
		this.now = now;
		this.pending = 0;
		this.buildQueued = 0;
		for (let i = 0; i < fx.count(); i++) {
			if (fx.at(i).type === "reset") this.reset();
		}
		const w = this.watch;
		w.update(state, localIndex);
		const party = partySize(state) > 1;
		// Parries (GP6): a guard that erased bullets this frame plays the parry, not the deflect. Only while the parry
		// has a clip: a silent parry leaves today's deflect untouched (SFX_FALLBACK).
		const parries = nearMiss !== undefined && this.playable(SFX.playerParry) ? nearMiss : undefined;
		const guarded = this.guardErased(parries, localIndex);
		// The first floor past the deepest (NB5): its floor enter makes way for the fanfare at the card's reveal.
		const silentFloorEnter = this.deepestEntered(events, state, newBest);

		// The power pellet's erases are in bulletsDeleted but are nobody's deflect (docs/PELLETS.md PL4).
		const deflected = deflectedBullets(events.bulletsDeleted, pellets);
		for (const [field, id] of SIM_EVENT_SOUNDS) {
			if (party && PLAYER_EVENT_FIELDS.includes(field)) continue;
			if (!((field === "bulletsDeleted" ? deflected : events[field]) > 0)) continue;
			// Solo: the frame's deletes were the guard's (the parry plays instead).
			if (id === SFX.playerDeflect && guarded !== GUARD_NONE) continue;
			if (id === SFX.floorEnter && silentFloorEnter) continue;
			// Solo: the swing that was the sword's finisher plays the finisher instead.
			if (id === SFX.playerSwing && w.swingEdge[localIndex] === SwingEdge.finisher)
				this.cue(SFX.playerFinisher, 1);
			else this.cue(id, 1);
		}
		if (party) {
			for (let i = 0; i < w.players(); i++) {
				if (w.deathEdge[i]) {
					this.playerCue(SFX.playerDeath, i, localIndex);
					this.playerCue(SFX.playerHurt, i, localIndex); // the lethal hit, as a solo death plays both
				}
				if (w.hurtEdge[i]) this.playerCue(SFX.playerHurt, i, localIndex);
				if (w.rollEdge[i]) this.playerCue(SFX.playerRoll, i, localIndex);
				if (w.flaskEdge[i]) this.playerCue(SFX.playerFlask, i, localIndex);
				const swing = w.swingEdge[i];
				if (swing === SwingEdge.finisher) this.playerCue(SFX.playerFinisher, i, localIndex);
				else if (swing === SwingEdge.swing) this.playerCue(SFX.playerSwing, i, localIndex);
			}
			if (w.swapEdge[localIndex]) this.cue(SFX.playerSwap, 1);
			if (events.shotsFired > 0 && w.localShot) this.cue(SFX.playerShoot, 1);
			// Deflects: the local player's when they could have made them, else a teammate's (quiet).
			// A guard's erases are the parry's (GP6), never also a deflect.
			if (deflected > 0) {
				if (w.mayDeflect[localIndex]) {
					if ((guarded & GUARD_LOCAL) === 0) this.cue(SFX.playerDeflect, 1);
				} else if ((guarded & GUARD_TEAMMATE) === 0)
					this.cue(
						SFX.playerDeflect,
						AUDIO_VIEW.teammateVolume,
						priorityOf(SFX.playerDeflect) - TEAMMATE_PRIORITY_DROP,
					);
			}
		}
		if (w.localCharged) this.cue(SFX.playerCharged, 1);
		if (w.roomCleared && !this.celebratesRoomClears) this.cue(SFX.roomClear, 1);
		if (w.relicTaken) this.cue(SFX.relicTake, 1);
		if (w.shrineUsed) this.cue(SFX.shrineUse, 1);
		// A record run's run over sounds like a win (NB5); the fanfare on the edges (the tracker's, never after run over).
		if (w.wiped) this.cue(runOverJingle(newBest.recordRun), 1);
		if (newBest.fanfare) this.cue(SFX.bestNew, 1);
		// The Daily's rank layer (DS10): one celebration sound per frame, new best > rank threshold > friend passed.
		else if (rank.rankUp) this.cue(SFX.rankUp, 1);
		else if (rank.friendPassed) this.cue(SFX.friendPassed, 1);

		// The kill ladder (CD5, CD6): the frame's final score combo pitches every regular kill of the frame (one cue).
		const scoreCombo = state.score !== undefined ? state.score.combo : COMBO_MIN;
		const laddered = scoreCombo > COMBO_MIN;
		const killRank = laddered ? COMBO_KILL_PRIORITY : priorityOf(SFX.enemyDeath);
		const killSpeed = laddered ? killPitchSpeed(scoreCombo) : 0;
		for (let i = 0; i < fx.count(); i++) {
			const e = fx.at(i);
			if (e.type === "hit") this.cue(SFX.enemyHurt, 1);
			else if (e.type === "killed" && !e.boss) this.cue(SFX.enemyDeath, 1, killRank, killSpeed);
			else if (e.type === "bossPhase" && e.phase >= 2) {
				const kind = e.kind;
				this.cue(kind !== undefined && this.tauntKinds.includes(kind) ? SFX.bossTaunt : SFX.bossRoar, 1);
			} else if (e.type === "bossDefeated") this.cue(SFX.bossDeath, 1);
		}
		// Breakables (summed over the frame's ticks): a break plays its own sound; the hit sound only for hits that
		// did not break (breakableHits counts the breaking hit too).
		if (events.breakablesBroken > 0) this.cue(SFX.breakableBreak, 1);
		if (events.breakableHits > events.breakablesBroken) this.cue(SFX.breakableHit, 1);
		// Boost drops (every tick of the frame): landings, pickups and Aegis breaks by player, the local player's ends.
		// A landing out of a broken piece (fromPiece, a subset of dropped) plays the loot sound instead of the drop's; one
		// out of an opened chest (fromChest, another subset) plays none: the chest's sting is its sound (TR8).
		const fromPieces = boosts.fromPiece.size();
		if (boosts.dropped.size() > fromPieces + boosts.fromChest.size()) this.cue(SFX.boostDrop, 1);
		if (fromPieces > 0) this.cue(SFX.breakableLoot, 1);
		for (const c of boosts.collected) this.playerCue(SFX.boostCollect, c.player, localIndex);
		for (const p of boosts.aegisBroke) this.playerCue(SFX.boostAegisBreak, p, localIndex);
		for (const e of boosts.ended) if (e.player === localIndex) this.cue(SFX.boostExpire, 1);
		const enemySpawned = state.combat.enemySpawned;
		// Goo puddles (docs/ENEMY_VARIANTS.md EVD14) and strikes (docs/NEW_ENEMIES.md NE5 / NE8: sfx.enemy.strike) count
		// in enemySpawned but never play the shot: only a rise beyond the frame's gooSpawned + strikes does.
		if (this.lastEnemySpawned >= 0 && enemySpawned - this.lastEnemySpawned > events.gooSpawned + events.strikes) {
			this.cue(SFX.enemyShoot, 1);
		}
		this.lastEnemySpawned = enemySpawned;
		// Enemy variants (docs/ENEMY_VARIANTS.md EV9 / EV11): world sounds, every tick of the frame.
		if (variants.blinks > 0) this.cue(SFX.enemyBlink, 1);
		if (variants.summons > 0) this.cue(SFX.enemySummon, 1);
		if (variants.splits > 0) this.cue(SFX.enemySplit, 1);
		if (variants.shieldBreaks > 0) this.cue(SFX.affixShieldBreak, 1);
		if (variants.vengefulFired > 0) this.cue(SFX.affixVengeful, 1);
		// The second endless set (NE8): starts from the run view's per-tick transitions, strikes from SimEvents.strikes.
		if (variants.fuses > 0) this.cue(SFX.enemyFuse, 1);
		if (variants.blasts > 0) this.cue(SFX.enemyBlast, 1);
		if (variants.charges > 0) this.cue(SFX.enemyCharge, 1);
		if (variants.stuns > 0) this.cue(SFX.enemyStun, 1);
		if (variants.strikes > 0) this.cue(SFX.enemyStrike, 1);
		if (variants.spins > 0) this.cue(SFX.enemySpin, 1);
		// The combo's tier sting and break (docs/COMBO.md CB4; a cut is silent, CD4).
		const peakTier = comboTier(combo.peak);
		if (peakTier > comboTier(combo.startCombo)) {
			this.cue(SFX.comboTier, 1, priorityOf(SFX.comboTier), tierStingSpeed(peakTier));
		}
		const ended = combo.ended;
		if (ended !== undefined && ended.fight) {
			this.cue(SFX.comboBreak, ended.lost < COMBO_VIEW.smallBreakBelow ? COMBO_VIEW.smallBreakVolume : 1);
		}
		// Grazes and parries (docs/GRAZE_PARRY.md GP6): the director's cues, at their exact speeds.
		const graze = nearMiss?.grazeCue;
		if (graze !== undefined) {
			this.cue(SFX.playerGraze, NEAR_MISS_VIEW.graze.volume, priorityOf(SFX.playerGraze), graze.speed);
		}
		if (parries !== undefined) this.parryCue(parries);
		// The parry ladder (docs/BUILDS_V2.md BV11): a Riposte guard's parry climbs per bullet it eats.
		if (parries !== undefined) this.parryLadderCue(parries, state, localIndex);
		// SYNC! (docs/RUN_RECAP.md CM4): after the parry, so a silent sync's fallback merges into it.
		this.syncCue(syncs, localIndex);
		// Build effects (docs/BUILDS.md BU8): generation pitch, intervals and the voice cap.
		this.buildCues(builds, localIndex);
		// Pellets (docs/PELLETS.md PL7): the chomp, the sweep sting, the power pellet.
		this.pelletCues(pellets, localIndex, state);
		// Treasure rooms (docs/TREASURE.md TR8): the look's edges (the crack, the bars' sink, the lid's pop).
		this.treasureCues(treasure);
		// Pacts (docs/FORTUNE.md FO9): a pact taken, the Horde's horn and second wave (and its x2 while Room clear is Off).
		this.pactCues(pacts, localIndex);
		// The Goldling (docs/FORTUNE.md FO9): its appearance, the hit ladder, the jackpot, the escape.
		this.goldenCues(golden, localIndex);

		this.keepOneJingle();
		this.applyCap();
		for (let i = 0; i < this.pending; i++) {
			const id = this.pendingIds[i];
			this.lastStart.set(id, now);
			if ((BUILD_VOICE_SFX as ReadonlyArray<string>).includes(id)) this.buildStarts.push(now);
			out.push(id, this.pendingVolumes[i], this.pendingSpeeds[i]);
		}
		return out;
	}
}
