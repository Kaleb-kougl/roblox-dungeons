/**
 * Sprite renderer logic (docs/ART.md S4), in plain numbers so it runs headlessly: the sim's world facing -> one of a
 * sprite set's screen facings, the animation and frame from sim state (the theme's SpriteSet.frame maps a frame to its
 * cell), the billboard's size and offset, floor / upright image sizes, the animation clock's step and the actor looks
 * (tints, blink, corpse fade) both render paths share. The client SpriteView only copies the results onto a
 * BillboardGui / ImageLabel. Presentation only: nothing here feeds `step()` (trig is fine).
 *
 * Facing. A SpriteSetAsset's facings are SCREEN directions (theme/types.ts: facing d points at zeroDeg + d * 360 /
 * count degrees, 0 = screen right, 90 = screen up). So the sim's ground facing is projected the way the camera
 * actually frames it: right component = g . right, up component = g . up (isoBasis), angle = atan2(up, right). That is
 * NOT the yaw-rotated ground angle: the pitch foreshortens the screen-up axis by sin(pitch), so at pitch 55 a world
 * diagonal relative to the camera shows at atan(sin 55) = 39.3 degrees from the screen's horizontal, not 45 (up to 5.7
 * degrees off, a quarter of a 16-facing bin). The true on-screen angle is the one the player reads: the mouse aim
 * points at the cursor on screen, and movement is seen as motion on screen. The camera's narrow FOV (7 degrees) makes
 * the perspective error negligible next to that.
 *
 * Animation. Choices follow a fixed priority, each rule skipped when the set lacks its animation (ending at idle):
 *   player: death > roll > attack (sword swings attack.1/2/3, else attack; the Archer's bow, below) > hit > run > idle
 *   actor:  death > special (a boss's intro / taunt roar, the Demon Lord's summon) > attack (a named one, else
 *           `attack`) > hit (multi-frame only; a 1-frame stand-in leaves it to the tint; over the view-side hit clip
 *           when the renderer gives one, docs/DUMMY_ART.md DD1) > move > idle
 * An actor's attack comes from its archetype's own states (ACTOR_SPRITE_INPUTS): the swarmer's wind-up + lunge, the
 * sniper's line telegraph, the bruiser's leap + slam, Mother Mayhem's phased attacks, the Demon Lord's swings
 * (demonlordSpriteInput); a turret (turret.sniper, and the M1 turrets turret.sprayer / turret.caster of
 * docs/DEMON_ART.md Phase 2) never attacks or moves (idle loop), and its corpse is the one dead spell before it
 * respawns alive (turretShared.ts).
 * Death beats everything; the roll beats attacks because the sim cancels a wind-up and pauses the combo while rolling;
 * attacks beat the hit flinch because a hit never interrupts a swing or a lunge in the sim (the tint / blink shows the
 * hit instead). A special is a one-shot that is no attack (the boss is immune or summoning): a set without it (and
 * without the builder's `fallback`) plays what would play without it (move / idle), never an attack swing. One-shots driven by a gameplay timer (roll, swing,
 * hit, corpse, a boss's roar and attacks) are STRETCHED over that timer:
 * frame = floor(progress * frames), clamped (last frame held). Loops (idle, run / move) and one-shots without a timer
 * (the player's death) advance a per-view clock at the animation's fps; run / move scale it by speed / reference speed.
 *
 * The Archer (docs/ARCHER.md AR12; player visual ARCHER_SPRITE.visualId, class.ranger, through playerSpriteInputFor):
 * the bow's state takes the attack's place. The charge (V_CHARGE > 0) plays `attack.2`'s draw [0, release) stretched
 * over the charge and holds the anchor while fully charged; the heavy arrow (V_HEAVY_TICK) its release [release, end)
 * over the stream's wait after it (BOW_DATA.heavyRecoverTicks); a stream arrow (the bow's cooldown running) one of
 * `attack.1`'s two draw-and-loose cycles over its cooldown, alternating by V_SHOT; while moving at run speed the
 * stream yields to `run` (ARCHER_SPRITE.streamYieldsToRun). Every other visual (the Knight) never reads the bow, so
 * its choices are exactly as before.
 *
 * Boss machinery (docs/BRAMBLE_ART.md BR4, BD7; shared with docs/BOSS_DEMONLORD.md D6). An actor attack may name its
 * animation (`attack.2`; `attack` when the set lacks it) and play only a SEGMENT of it (AnimSegment, fractions of its
 * frames from SPRITE_ANIM_MARKS): the wind-up stretched over the telegraph, the release over a volley, a looped release
 * (the spiral's channel, at the animation's fps), the leap's airborne and landing parts. A `special` is a one-shot with
 * its own gameplay timer (the bosses' roars, the Demon Lord's summon; ActorSpecial.fallback names a stand-in: Mother
 * Mayhem's `intro` falls back to `taunt`); it beats attacks because a roar never overlaps one. `flinch: false`
 * (Mother Mayhem, BD3) never plays `hit`: the tint carries the hits. `deathTicks` / `corpseFadeFrom` (the Demon Lord)
 * stretch the death over part of the corpse time and start the fade after it.
 *
 * @module
 */
export {
	screenAngleFromBasis,
	screenAngleDeg,
	facingIndex,
	spriteFacing,
	tickSpeed,
	type SpriteAnimSource,
	type SpriteAnimChoice,
	type AnimSegment,
} from "./facing";
export {
	SWORD_TIMING,
	swordTimingOf,
	swordSwing,
	swordSwingOf,
	playerSpriteInput,
	BOW_TIMING,
	bowTimingOf,
	bowShot,
	bowShotOf,
	archerSpriteInput,
	playerSpriteInputFor,
	choosePlayerAnim,
	type SwordTiming,
	type SwordSwing,
	type PlayerSpriteInput,
	type BowTiming,
	type BowShotKind,
	type BowShot,
} from "./player";
export {
	SPECIAL_INTRO,
	SPECIAL_TAUNT,
	swarmerAttack,
	swarmerSpriteInput,
	sniperAttack,
	sniperSpriteInput,
	turretSpriteInputOf,
	turretSniperSpriteInput,
	turretSprayerSpriteInput,
	turretCasterSpriteInput,
	impAttack,
	impSpriteInput,
	slimeSpriteInputOf,
	slimeSpriteInput,
	slimeSmallSpriteInput,
	summonerAttack,
	summonerSpriteInput,
	actorSpriteScale,
	scaledSpriteLayout,
	demonlordAttack,
	demonlordSpecial,
	demonlordSpriteInput,
	bruiserAttack,
	bruiserSpriteInput,
	bossAct1AttackAnim,
	bossAct1Attack,
	bossAct1Special,
	bossAct1SpriteInput,
	chooseActorAnim,
	type ActorAttack,
	type ActorSpecial,
	type ActorSpriteInput,
	type ActorHitClip,
} from "./actors";
export {
	stretchedFrame,
	segmentStart,
	segmentLength,
	segmentFrame,
	spriteFrame,
	floorClearanceStuds,
	spriteBillboard,
	floorImageOffset,
	floorImageSize,
	uprightImageBillboard,
	animDtSec,
	actorLook,
	playerLook,
	playerBlinkVisible,
	corpseTransparency,
	bossSpriteLayout,
	type SpriteClock,
	type SpritePick,
	type SpriteLayout,
	type SpriteBillboard,
	type ActorLook,
} from "./frames";
export { ACTOR_SPRITE_INPUTS } from "./registry";
