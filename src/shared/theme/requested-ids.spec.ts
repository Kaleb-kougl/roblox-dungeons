// Every ID the web build's gameplay/presentation code asks the theme for must exist in the placeholder
// pack, so porting that code never hits a fallback.
//
// How this list was produced (project-kaleb-vale @ 42897e2, outside src/theme and tests):
//   grep -rnE "useTexture\(|useSpriteSheet\(|useColor\(|useString\(|\.sound\(|\.texture\(|\.spriteSheet\(|\.color\(|\.hex\(|\.str\(|\.biome\(|hasString\(" src --include='*.ts' --include='*.tsx'
// plus the logical IDs those calls receive indirectly: archetype / weapon `spriteId`s
// (swarmer, sniper, bruiser, turret sniper/sprayer/caster, boss.act1, item.weapon.sword/bow/item.weapon),
// PLAYER_SPRITE_ID = class.vanguard, DIGIT_FONT.id, `${id}.name` for the weapon HUD and boss HUD
// (weapon.sword, weapon.bow, boss.act1), particleColorRole(spriteId) (enemy roles), and biome.nameKey
// for BIOMES. The source never calls theme.sound(); the audio events are covered by REQUIRED_ASSET_IDS.
import { describe, expect, it } from "@rbxts/jest-globals";
import { BIOMES } from "./contract";
import { ThemePack } from "./pack";
import { PLACEHOLDER_MANIFEST } from "./packs/placeholder";
import { PLACEHOLDER_VISUALS } from "./placeholders";
import { COLOR_ROLES, type ColorRole } from "./types";

const REQUESTED_ASSET_IDS = [
	"class.vanguard",
	"enemy.swarmer",
	"enemy.sniper",
	"enemy.bruiser",
	"enemy.sprayer",
	"enemy.caster",
	"boss.act1",
	"item.weapon",
	"item.weapon.sword",
	"item.weapon.bow",
	"ui.font.digits",
];

const REQUESTED_COLOR_ROLES: ReadonlyArray<ColorRole> = [
	"background",
	"floor",
	"wall",
	"enemyBullet",
	"enemyBulletOutline",
	"playerBullet",
	"playerBulletOutline",
	"telegraph",
	"boss",
	"ember",
	"uiText",
	"uiTextDim",
	"uiPanel",
	"uiAccent",
	"uiHealth",
	"uiMana",
	"enemyHealth",
	"enemyHealthChip",
	"enemyHealthBack",
	"enemyHealthElite",
	"damageNumber",
	"damageHeavy",
	"damageCapped",
	"particleSpark",
	"enemy.swarmer",
	"enemy.sniper",
	"enemy.bruiser",
	"enemy.sprayer",
	"enemy.caster",
];

const REQUESTED_STRING_KEYS = [
	"game.title",
	"ember.name",
	"hud.health",
	"hud.armor",
	"hud.flask",
	"hud.dead",
	"hud.victory",
	"hud.weaponSet",
	"hud.weaponSwap",
	"weapon.sword.name",
	"weapon.bow.name",
	"boss.act1.name",
	"boss.hud.phase",
	"fx.settings.title",
	"fx.settings.healthBars",
	"fx.settings.healthBars.always",
	"fx.settings.healthBars.onDamage",
	"fx.settings.healthBars.off",
	"fx.settings.damageNumbers",
	"fx.settings.freezeFrame",
	"fx.settings.particles",
	"fx.settings.particles.off",
	"fx.settings.particles.low",
	"fx.settings.particles.normal",
	"fx.settings.particles.high",
	"fx.settings.reducedMotion",
	"fx.settings.on",
	"fx.settings.off",
	"fx.settings.hint",
	"playtest.badge",
	"playtest.run.over",
	"playtest.run.victory",
	"playtest.run.attempt",
	"playtest.run.time",
	"playtest.run.timeVictory",
	"playtest.run.hits",
	"playtest.run.kills",
	"playtest.retry",
	"playtest.quit",
	"playtest.funGate.question",
	"playtest.funGate.yes",
	"playtest.funGate.no",
	"playtest.funGate.thanks",
	"playtest.summary.title",
	"playtest.summary.runs",
	"playtest.summary.deaths",
	"playtest.summary.retries",
	"playtest.summary.best",
	"playtest.summary.funGate",
	"playtest.summary.newRun",
	"playtest.export",
	"playtest.export.saved",
	"playtest.export.downloaded",
	"playtest.export.failed",
];

describe("IDs the web build's code requests", () => {
	const warnings = new Array<string>();
	const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: (m) => warnings.push(m) });

	it("are all asset IDs in the placeholder pack, each with a placeholder visual", () => {
		for (const id of REQUESTED_ASSET_IDS) {
			expect([id, pack.has(id)]).toEqual([id, true]);
			expect([id, PLACEHOLDER_VISUALS[id] !== undefined]).toEqual([id, true]);
			pack.spriteSheet(id);
			pack.placeholder(id);
		}
		expect(warnings).toEqual([]);
	});

	it("are all colour roles the pack fills", () => {
		const roles = new Set<string>(COLOR_ROLES);
		for (const r of REQUESTED_COLOR_ROLES) {
			expect([r, roles.has(r)]).toEqual([r, true]);
			pack.color(r);
		}
		expect(warnings).toEqual([]);
	});

	it("are all string keys in the table, and every biome resolves with a name", () => {
		for (const key of REQUESTED_STRING_KEYS) {
			expect([key, pack.hasString(key)]).toEqual([key, true]);
		}
		for (const b of BIOMES) {
			const biome = pack.biome(b.id);
			expect([
				b.id,
				pack.hasString(biome.nameKey),
				pack.has(biome.tiles.floor),
				pack.has(biome.tiles.wall),
			]).toEqual([b.id, true, true, true]);
		}
		expect(warnings).toEqual([]);
	});
});
