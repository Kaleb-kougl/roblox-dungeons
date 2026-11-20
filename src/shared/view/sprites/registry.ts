/** ACTOR_SPRITE_INPUTS: every archetype's sprite input (docs/CODEBASE_SCALE.md DX8: a pure move out of view/sprites.ts). */
import { withNewEnemy2SpriteInputs } from "../newEnemy2Sprites";
import {
	BOSS_ACT1_ID,
	BOSS_DEMONLORD_ID,
	BRUISER,
	IMP,
	SLIME,
	SLIME_SMALL,
	SNIPER,
	SUMMONER,
	SWARMER,
	TURRET_CASTER,
	TURRET_SNIPER,
	TURRET_SPRAYER,
	type ActorState,
} from "shared/sim";
import {
	bomberSpriteInput,
	chargerSpriteInput,
	reaperSpriteInput,
	stormcallerSpriteInput,
	warbannerSpriteInput,
} from "../newEnemySprites";
import { goldenSpriteInput } from "../golden/sprite";
import { dummySpriteInput } from "../dummy/sprite";
import {
	bossAct1SpriteInput,
	bruiserSpriteInput,
	demonlordSpriteInput,
	impSpriteInput,
	slimeSmallSpriteInput,
	slimeSpriteInput,
	sniperSpriteInput,
	summonerSpriteInput,
	swarmerSpriteInput,
	turretCasterSpriteInput,
	turretSniperSpriteInput,
	turretSprayerSpriteInput,
	type ActorSpriteInput,
} from "./actors";

/**
 * Archetypes drawn as sprites when the pack has a sprite set for their spriteId: archetype ID -> input builder. The
 * swarmer, the sniper, the tutorial's turret.sniper (same spriteId "enemy.sniper", docs/SNIPER_ART.md D3), M1's
 * turret.sprayer / turret.caster ("enemy.sprayer" / "enemy.caster", docs/DEMON_ART.md Phase 2), the bruiser, Mother
 * Mayhem (boss.act1), the Demon Lord (boss.demonlord), the enemy variants (docs/ENEMY_VARIANTS.md EV9: imp, slime,
 * slime.small, summoner) and the second endless set (docs/NEW_ENEMIES.md NE8: bomber, charger, stormcaller,
 * warbanner, reaper; their sets land in NE9) and the Goldling (docs/FORTUNE.md FO8: `enemy.golden`, the owner's FO10
 * recolour) and the tutorial's training dummy (docs/DUMMY_ART.md: `enemy.dummy`); every other archetype stays a
 * placeholder. A builder alone draws nothing: ActorRenderController takes the sprite path only when the pack's
 * `sprites(spriteId)` is a set too, so each stays a placeholder until its set lands (docs/DEMON_ART.md DA5 and Phase 2,
 * docs/BRAMBLE_ART.md BR6, docs/BOSS_DEMONLORD.md D7).
 */
export const ACTOR_SPRITE_INPUTS: ReadonlyMap<string, (a: Readonly<ActorState>, alpha: number) => ActorSpriteInput> =
	withNewEnemy2SpriteInputs(
		new Map([
			[SWARMER.id, swarmerSpriteInput],
			[SNIPER.id, sniperSpriteInput],
			[TURRET_SNIPER.id, turretSniperSpriteInput],
			[TURRET_SPRAYER.id, turretSprayerSpriteInput],
			[TURRET_CASTER.id, turretCasterSpriteInput],
			[BRUISER.id, bruiserSpriteInput],
			[BOSS_ACT1_ID, bossAct1SpriteInput],
			[BOSS_DEMONLORD_ID, demonlordSpriteInput],
			[IMP.id, impSpriteInput],
			[SLIME.id, slimeSpriteInput],
			[SLIME_SMALL.id, slimeSmallSpriteInput],
			[SUMMONER.id, summonerSpriteInput],
			// docs/NEW_ENEMIES.md NE8 (newEnemySprites.ts: sprites.luau sits near Luau's 200 top-level locals)
			["bomber", bomberSpriteInput],
			["charger", chargerSpriteInput],
			["stormcaller", stormcallerSpriteInput],
			["warbanner", warbannerSpriteInput],
			["reaper", reaperSpriteInput],
			// docs/FORTUNE.md FO8: the Goldling (golden/sprite.ts, by file: sprites.luau sits near Luau's 200 top-level locals)
			["golden", goldenSpriteInput],
			// docs/DUMMY_ART.md DA3: the tutorial's training dummy (dummy/sprite.ts, by file, as the Goldling)
			["dummy", dummySpriteInput],
		]),
	);
