/**
 * The theme contract's ID lists (docs/CODEBASE_SCALE.md DX8: a pure move out of contract.ts): classes, enemies, bosses, bullets, items, ui, audio, breakables, boosts and the required asset IDs.
 *
 * @module
 */
import type { DecorFxName } from "./decor";

// ---------------------------------------------------------------------------------------------
// Slot roster (GDD: what every pack fills)

/**
 * The web build's five player classes (its GDD roster). Every pack fills, per class: the asset `class.<id>` (CHARACTER
 * slot), the colour role `class.<id>` and the string `class.<id>.name`. The order only fixes the order of those
 * required lists.
 */
export const CLASS_IDS = ["vanguard", "ranger", "pyromancer", "tinkerer", "hexblade"] as const;
/** A class's name (a CLASS_IDS entry): the segment after `class.` in its asset, colour role and string keys. */
export type ClassId = (typeof CLASS_IDS)[number];

/**
 * The web build's six, then the Roblox port's `dummy` (the tutorial's Training Dummy, sim archetype 'dummy'): every
 * pack fills `enemy.dummy` (asset and colour role) and `enemy.dummy.name` like the others. Then the endless roster's
 * `imp` (the Imp, a flanker) and `slime` (the Ooze, a zone-denier; its slimelets `slime.small` draw `enemy.slime`
 * smaller) of docs/ENEMY_VARIANTS.md EV1: `enemy.imp` / `enemy.slime` and their `.name` the same way (placeholders: a
 * small cone and a low dome). The Summoner fills the web build's existing `summoner`. Then the second endless set of
 * docs/NEW_ENEMIES.md NE1: `bomber`, `charger`, `stormcaller`, `warbanner`, `reaper` (placeholders: a small cone, a
 * long wedge, a tall slim drum, a thin post, a flat disc). Then the Goldling of docs/FORTUNE.md (`golden`, a rare
 * harmless gold runner; placeholder: a small gold block). Then the third endless set of docs/NEW_ENEMIES_2.md NX1
 * (newEnemies2.ts NEW_ENEMY_2_ARCHETYPES): `bulwark`, `chainhook`, `snatcher`, `pyrekeeper` and the Pyre-keeper's
 * brazier `pyre` (placeholders: a disc behind a front plate, a squat drum, a small cone, a tall robe, a low bowl).
 * Then the fourth endless set of docs/NEW_ENEMIES_3.md NT1 (newEnemies3.ts NEW_ENEMY_3_ARCHETYPES): `mortar`, `mender`,
 * `jackal` (placeholders: a thin post, a short robe, a low wedge).
 */
export const ENEMY_ARCHETYPES = [
	"swarmer",
	"sprayer",
	"sniper",
	"bruiser",
	"caster",
	"summoner",
	"dummy",
	"imp",
	"slime",
	"bomber",
	"charger",
	"stormcaller",
	"warbanner",
	"reaper",
	"golden",
	"bulwark",
	"chainhook",
	"snatcher",
	"pyrekeeper",
	"pyre",
	"mortar",
	"mender",
	"jackal",
] as const;
/**
 * An enemy archetype's theme name (an ENEMY_ARCHETYPES entry): the segment after `enemy.` in its asset ID, colour role
 * and `enemy.<name>.name` string.
 */
export type EnemyArchetype = (typeof ENEMY_ARCHETYPES)[number];

/**
 * The web build's loot rarities. Every pack defines the string `rarity.<name>.name` for each. Separate from the boon
 * draft's rarities (BOON_RARITY_ROLES: common, rare, legendary).
 */
export const RARITIES = ["normal", "magic", "rare", "unique", "set", "glyphword"] as const;
/** A loot rarity's name (a RARITIES entry): the segment in its `rarity.<name>.name` string key. */
export type Rarity = (typeof RARITIES)[number];

/**
 * The five biomes, each tied to a Dungeon Forge theme slot. biome.1..4 are Acts I-IV,
 * biome.5 is the endgame.
 */
export const BIOMES = [
	{ id: "biome.1", forgeTheme: "ancient", act: "1" },
	{ id: "biome.2", forgeTheme: "molten", act: "2" },
	{ id: "biome.3", forgeTheme: "frost", act: "3" },
	{ id: "biome.4", forgeTheme: "grim", act: "4" },
	{ id: "biome.5", forgeTheme: "verdant", act: "endgame" },
] as const;
/**
 * A biome's ID (`biome.1` .. `biome.5`): the key of its entry in a manifest's `biomes` and the argument the biome,
 * decor and ambience lookups take.
 */
export type BiomeId = (typeof BIOMES)[number]["id"];
/**
 * The Dungeon Forge theme slot a biome is tied to (BIOMES `forgeTheme`), by name. Carried on the resolved biome
 * (BiomeTheme.forgeTheme) and named in the validator's contrast messages.
 */
export type ForgeTheme = (typeof BIOMES)[number]["forgeTheme"];

/**
 * Roblox built-in materials (`Enum.Material` names) a biome may give its surfaces (`BiomeDef.materials`, docs/DECOR.md
 * R1): stone for halls and vaults, volcanic rock for molten, ice and snow for frost, earth and grass for verdant, plus
 * pool liquids. Presentation only: a material adds texture and a little lighting variation, `Part.Color` stays the
 * biome hex. **Neon is left out on purpose**: it is the bullets' material (they must glow on every floor), and a
 * glowing floor, wall or pool would compete with them.
 */
export const BIOME_MATERIALS = [
	"SmoothPlastic",
	"Slate",
	"Brick",
	"Cobblestone",
	"Basalt",
	"Limestone",
	"Granite",
	"Rock",
	"Pavement",
	"Concrete",
	"Sandstone",
	"CrackedLava",
	"Ice",
	"Glacier",
	"Snow",
	"Grass",
	"LeafyGrass",
	"Mud",
	"Ground",
	"Glass",
] as const;
/**
 * A material a biome may name (a BIOME_MATERIALS entry): an `Enum.Material` name, the value type of
 * `BiomeDef.materials`.
 */
export type BiomeMaterial = (typeof BIOME_MATERIALS)[number];

/**
 * The surfaces a biome can pick a material for: floor slabs, wall blocks, sunken pools, and (docs/VOID_DECOR.md VD1) the
 * void's rock shoulder along the walls (its top and body) and its cliffs (the lower ledges and the outcrops rising from
 * the abyss).
 */
export const BIOME_MATERIAL_SURFACES = ["floor", "wall", "pool", "shoulder", "cliff"] as const;
/**
 * A surface a biome can pick a material for (a BIOME_MATERIAL_SURFACES entry): the key type of `BiomeDef.materials` and
 * of the resolved BiomeTheme.materials.
 */
export type BiomeMaterialSurface = (typeof BIOME_MATERIAL_SURFACES)[number];

/**
 * The material of a surface whose biome names none (what every Part was drawn in before R1). A repeating
 * `tilesPerImage` texture must not sit on it (validateManifest): at the game camera its sun glint washes the image out.
 */
export const DEFAULT_BIOME_MATERIAL: BiomeMaterial = "SmoothPlastic";

/**
 * The web build's five act bosses (the GDD's list). Every pack fills the asset `boss.<n>` (BOSS slot) and the string
 * `boss.<n>.name` for each. The bosses the port's endless runs draw are ENDLESS_BOSS_IDS, kept apart.
 */
export const BOSS_IDS = ["boss.1", "boss.2", "boss.3", "boss.4", "boss.5"] as const;

/**
 * Roblox port: the endless bosses' sprite IDs (the sim archetype ids). `boss.act1` is Mother Mayhem (the web build's
 * M1 boss); `boss.demonlord` the Demon Lord (docs/BOSS_DEMONLORD.md). Not in REQUIRED_ASSET_IDS (the web contract's
 * list stays as ported, and BOSS_IDS stays the GDD's five): every bundled pack fills both, with `<id>.name`, and
 * placeholder visuals exist for both (theme specs check it).
 */
export const ENDLESS_BOSS_IDS = ["boss.act1", "boss.demonlord"] as const;
/** An endless boss's sprite ID (an ENDLESS_BOSS_IDS entry), equal to its sim archetype id. */
export type EndlessBossId = (typeof ENDLESS_BOSS_IDS)[number];

/**
 * Every bullet visual a pack must define (BULLET slot; all in REQUIRED_ASSET_IDS): the web build's six, then the port's
 * additions, each explained inline. Gameplay never sees these: a renderer picks the ID for a bullet's kind and scales
 * it to the gameplay radius. `bulletArtReport` walks the list in this order.
 */
export const BULLET_IDS = [
	"bullet.enemy.small",
	"bullet.enemy.medium",
	"bullet.enemy.large",
	"bullet.enemy.needle",
	"bullet.player.basic",
	"bullet.player.heavy",
	// Roblox port (docs/ENEMY_VARIANTS.md EV1, EVD5): the Ooze's goo puddle (variants.ts GOO_BULLET_ID), drawn flat on
	// the floor under every moving bullet, tinted `enemyGoo`
	"bullet.enemy.goo",
	// Roblox port (docs/NEW_ENEMIES.md NE1): the Stormcaller's lightning strike (variants.ts STRIKE_BULLET_ID,
	// BulletKind.STRIKE), a stationary bullet drawn as a short bolt flash on its marked circle (NE8)
	"bullet.enemy.strike",
	// Roblox port (docs/NEW_ENEMIES_2.md NX1): the Chainhook's hook (newEnemies2.ts HOOK_BULLET_ID, BulletKind.HOOK) and
	// the brazier's fireball look (FLAME_BULLET_ID, NXD12; held to the danger pink like every enemy look)
	"bullet.enemy.hook",
	"bullet.enemy.flame",
	// Roblox port (docs/BUILDS.md BU1): the build effects' player bullets (builds.ts BUILD_BULLET_IDS, the same list):
	// Volatile's bolts, Soul Shards, embers (a flat floor flame), Flurry / Thrill Seeker bolts
	"bullet.player.burst",
	"bullet.player.shard",
	"bullet.player.ember",
	"bullet.player.bolt",
] as const;

/**
 * The web build's item icons, required in every pack (ITEM slot: 16 x 16 stills, placeholders until art exists): one
 * per equipment slot, then potion, gold and glyph.
 */
export const ITEM_IDS = [
	"item.weapon",
	"item.offhand",
	"item.helm",
	"item.armor",
	"item.gloves",
	"item.boots",
	"item.belt",
	"item.ring",
	"item.amulet",
	"item.potion",
	"item.gold",
	"item.glyph",
] as const;

/**
 * The UI assets every pack must define (UI slot): the web build's cursor, panel, three HUD icons and the digit font
 * (DIGIT_FONT). Any other `ui.*` ID is free-form and optional (the port's icons, markers and sliced panels); code that
 * asks for one draws a fallback when the pack lacks it.
 */
export const UI_IDS = [
	"ui.cursor",
	"ui.panel",
	"ui.icon.health",
	"ui.icon.mana",
	"ui.icon.ember",
	"ui.font.digits",
] as const;

/**
 * The pixel digit font (juice: damage numbers, "CAP"). A horizontal strip of equal cells, one per glyph in
 * `glyphs` order, left to right. Each cell is the glyphW x glyphH glyph with `pad` pixels around it (room for a 1 px
 * outline), so a cell is cellW x cellH and the strip is (glyphs.length * cellW) x cellH. Text advances `advance`
 * pixels per glyph (glyph width + 1 px gap; neighbouring outlines overlap by design).
 *   placeholder: { kind: "placeholder" } (the HUD draws the digits as text until a strip is uploaded)
 *   image:       a cellW * glyphs.length x cellH image in the same layout (w: 80, h: 7), glyphs drawn white
 *                so the renderer can tint them per number
 */
export const DIGIT_FONT = {
	id: "ui.font.digits",
	glyphs: "0123456789+-CAP!",
	glyphW: 3,
	glyphH: 5,
	pad: 1,
	cellW: 5,
	cellH: 7,
	advance: 4,
} as const;

/** Asset ID prefix of pixel fonts. */
export const FONT_PREFIX = "ui.font.";

/** Audio event IDs. A pack maps each to a sound or leaves it silent. */
export const AUDIO_EVENTS = [
	"sfx.player.shoot",
	"sfx.player.roll",
	"sfx.player.hurt",
	"sfx.player.death",
	"sfx.enemy.shoot",
	"sfx.enemy.hurt",
	"sfx.enemy.death",
	"sfx.boss.roar",
	"sfx.ember",
	"sfx.loot.drop",
	"sfx.loot.rare",
	"sfx.ui.click",
	"sfx.ui.confirm",
	"music.menu",
	"music.biome.1",
	"music.biome.2",
	"music.biome.3",
	"music.biome.4",
	"music.biome.5",
	"music.boss",
] as const;

/**
 * Roblox port (docs/DECOR.md D4): the breakable clutter kinds (the sim's breakable `kind`). Every pack fills
 * `breakable.<kind>` (asset, a placeholder until art exists), the colour role `breakable.<kind>` and the string
 * `breakable.<kind>.name`, like `enemy.dummy`: a gameplay object must always be drawn.
 *
 * A mirror of shared/dungeon BREAKABLE_KINDS, the source of truth (the sim's kind index is its order; renderers index
 * that list, not this one). The theme imports nothing outside shared/theme, so the list is repeated here and
 * decor.spec.ts asserts both are identical, in order.
 */
export const BREAKABLE_KINDS = ["barrel", "crate"] as const;
/**
 * A breakable kind's name (a BREAKABLE_KINDS entry): the segment after `breakable.` in its asset, colour role and
 * string keys.
 */
export type BreakableKind = (typeof BREAKABLE_KINDS)[number];

/** Asset (and colour role) ID of a breakable kind: `breakable.crate`. */
export function breakableId(kind: BreakableKind): `breakable.${BreakableKind}` {
	return `breakable.${kind}`;
}

/**
 * Roblox port (docs/DECOR.md R13): breakable audio events, required in every pack (silent in the placeholder pack).
 * Kept apart from AUDIO_EVENTS, which stays the web build's list.
 */
export const BREAKABLE_AUDIO_EVENTS = ["sfx.breakable.hit", "sfx.breakable.break"] as const;

/** Sprite-set animation a breakable plays once when it breaks (optional; `idle` is required). */
export const BREAKABLE_SHATTER_ANIMATION = "shatter";

// ---------------------------------------------------------------------------------------------
// Boosts (Roblox port, docs/BOOSTS.md B5): the pickups killed enemies sometimes drop

/**
 * The boost kinds, in the sim's Boost index order (shared/sim drops: the kind index is the position here; a cross-check
 * spec asserts both lists are identical, like BREAKABLE_KINDS). Every pack fills, per kind: the asset `boost.<kind>`
 * (BOOST slot, a placeholder gem until art exists), the colour role `boost.<kind>` (BOOST_ROLES) and the strings
 * `boost.<kind>.name` / `.desc` / `.icon` (BOOST_STRING_FIELDS); plus `hud.toast.boost` and the four `sfx.boost.*`
 * IDs in PORT_AUDIO_EVENTS.
 */
export const BOOST_KINDS = ["fury", "quickstep", "frenzy", "aegis"] as const;
/**
 * A boost kind's name (a BOOST_KINDS entry): the segment after `boost.` in its asset, colour role and string keys, and
 * in its aura effect's ID.
 */
export type BoostKind = (typeof BOOST_KINDS)[number];

/** Asset (and colour role) ID of a boost kind: `boost.fury`. */
export function boostId(kind: BoostKind): `boost.${BoostKind}` {
	return `boost.${kind}`;
}

/** Is `id` a boost drop's asset ID (`boost.<kind>` for a BOOST_KINDS entry)? */
export function isBoostId(id: string): id is `boost.${BoostKind}` {
	return BOOST_KINDS.some((k) => boostId(k) === id);
}

/**
 * The strings every boost kind has: `name` ("Fury"), `desc` (what it does, e.g. "+50% damage for 30 s") and `icon`
 * (a short label the HUD's boost row draws until it has icon art, like the boons' `.icon`).
 */
export const BOOST_STRING_FIELDS = ["name", "desc", "icon"] as const;
/**
 * One of the strings every boost kind has (a BOOST_STRING_FIELDS entry): the last segment of `boost.<kind>.<field>`.
 */
export type BoostStringField = (typeof BOOST_STRING_FIELDS)[number];

/** String-table key of a boost kind's field: boostStringKey("fury", "desc") = "boost.fury.desc". */
export function boostStringKey(kind: BoostKind, field: BoostStringField): string {
	return `${boostId(kind)}.${field}`;
}

/** The toast shown when the local player picks a boost up: `{name}` and `{desc}` are the kind's strings. */
export const BOOST_TOAST_KEY = "hud.toast.boost";

/** Every boost string key a pack must define: each kind's BOOST_STRING_FIELDS (kind order), then BOOST_TOAST_KEY. */
function boostStringKeys(): Array<string> {
	const out = new Array<string>();
	for (const k of BOOST_KINDS) {
		for (const f of BOOST_STRING_FIELDS) {
			out.push(boostStringKey(k, f));
		}
	}
	out.push(BOOST_TOAST_KEY);
	return out;
}
/**
 * Every boost string key a pack must define: each kind's three fields in BOOST_KINDS order, then BOOST_TOAST_KEY.
 * Spread into REQUIRED_STRING_KEYS.
 */
export const BOOST_STRING_KEYS: ReadonlyArray<string> = boostStringKeys();

/**
 * The boost drops' optional sprite effects (fx.* rules: one-facing `sprites`, `play`, at most FX_SPRITE_MAX_TILES):
 * the pickup burst, then one aura per kind in BOOST_KINDS order (boostAuraFxId).
 */
export const BOOST_FX_IDS = [
	"fx.boost.collect",
	"fx.boost.aura.fury",
	"fx.boost.aura.quickstep",
	"fx.boost.aura.frenzy",
	"fx.boost.aura.aegis",
] as const;
/**
 * A boost sprite effect's ID (a BOOST_FX_IDS entry). The vale pack fills these apart from its other effects, so its
 * types separate them from the rest of FxId.
 */
export type BoostFxId = (typeof BOOST_FX_IDS)[number];

/** The pickup burst effect (optional). */
export const BOOST_COLLECT_FX_ID: BoostFxId = "fx.boost.collect";

/** A boost kind's aura effect (optional): boostAuraFxId("aegis") = "fx.boost.aura.aegis". */
export function boostAuraFxId(kind: BoostKind): BoostFxId {
	return `fx.boost.aura.${kind}` as BoostFxId;
}

/**
 * Boost drop art (docs/BOOST_ART.md BA2): the layers drawn with a boost's `image` / `sprites` art. They reuse the decor
 * effects rather than adding boost IDs: the halo under the drop is `decor.fx.<BOOST_HALO_FX>` (the soft glow disc),
 * the sparkle over it `decor.fx.<BOOST_GLINT_FX>` (the treasure glint), both tinted by the kind's colour role
 * `boost.<kind>`. The validator requires the halo whenever a pack gives any `boost.<kind>` art (BA-P2: the Lords of Pain
 * props alone are 1.7-3.6:1 on the floor, under MIN_BOOST_CONTRAST; the tinted halo carries the role). The glint is
 * optional. The beam is BOOST_BEAM_IMAGE_ID, an optional free-form ui image like `ui.marker.pedestal` (white, tinted
 * by the role; its `pivot` is its foot). The placeholder gem draws none of them.
 */
export const BOOST_HALO_FX: DecorFxName = "glow";
/**
 * The decor effect drawn as the sparkle over a boost drop with art: `decor.fx.glint`, tinted by the kind's colour role.
 * Optional (see BOOST_HALO_FX's comment for all three layers).
 */
export const BOOST_GLINT_FX: DecorFxName = "glint";
/**
 * The boost drop's beam: an optional free-form ui image, white and tinted by the kind's colour role, its `pivot` at its
 * foot (see BOOST_HALO_FX's comment for all three layers).
 */
export const BOOST_BEAM_IMAGE_ID = "ui.marker.boost";

/**
 * Roblox port (docs/FX_AUDIO.md A2): every other audio ID the port plays, required in every pack (silent in the
 * placeholder pack). Kept apart from AUDIO_EVENTS, which stays the web build's list, like BREAKABLE_AUDIO_EVENTS.
 * First the IDs the audio layer already played before A2 (shared/view/audio PORT_SFX, which only the placeholder pack
 * listed), then the A2 additions: menu back / focus move, the sword finisher, the bow's full charge, room clear, relic
 * and shrine, stairwell, new floor, depth up, the run-over jingle, and the tutorial / lobby tracks. Then the Demon
 * Lord's (docs/BOSS_DEMONLORD.md D6): sfx.boss.taunt, a taunting boss's phase change (the roar plays while it is
 * silent). Then the boost drops' four (docs/BOOSTS.md B5).
 * Then the room clear celebration's three (docs/ROOM_CLEAR.md RC4): PERFECT's jingle, a tally tick, a bonus landing
 * in the score. Then the combo's two (docs/COMBO.md CB3): the tier-up sting (one clip, pitched up per tier) and the
 * break's shatter. Then the near misses' two (docs/GRAZE_PARRY.md GP3): a graze's shimmer and a parry's ring-out.
 * Then the boon draft reveal's five (docs/DRAFT_REVEAL.md DR4): flip, rare chime, legendary charge, legendary flare,
 * pick stamp. Then the enemy variants' five (docs/ENEMY_VARIANTS.md EV1): an Imp's blink, a Summoner's call, an Ooze's
 * split, a Shielded enemy's shield breaking (the plan's `sfx.affix.shieldBreak`: asset ID segments are lowercase) and a
 * Vengeful corpse's ring. Then the new-best celebration's two (docs/NEW_BEST.md NB4): the in-run fanfare (falls back
 * to the PERFECT jingle while silent) and the run-over record fanfare (falls back to the game-over jingle). Then the
 * Daily's rank layer's two (docs/DAILY.md DS10): a rank threshold's sting and a friend passed. Then the breakable
 * drops' one (docs/BREAKABLE_DROPS.md BL5): a boost hops out of a broken barrel / crate (sfx.boost.drop plays while it
 * is silent). Then the new enemies' six (docs/NEW_ENEMIES.md NE1): a Bomber's fuse and blast, a Charger's charge and
 * stun, a Stormcaller's strike, a Reaper's spin. Then the pellets' three (docs/PELLETS.md PL6, pellets.ts
 * PELLET_AUDIO_IDS): a pellet eaten, a room swept, the power pellet taken. Then the co-op moments' two
 * (docs/RUN_RECAP.md CM4, runRecap.ts TEAM_MOMENT_AUDIO_IDS): TEAM PERFECT and a SYNC! parry. Then the treasure rooms'
 * four (docs/TREASURE.md TR6, treasure.ts TREASURE_AUDIO_IDS): a vault's lock cracks, its cage unlocks, its chest
 * opens, a Legendary chest's jingle. Then Fortune's eight (docs/FORTUNE.md FO6, fortune.ts FORTUNE_AUDIO_IDS): a pact
 * taken, the Horde's horn / second wave / doubling, the Goldling's appearance / hit / jackpot / escape (each falls back
 * to an existing clip while silent: shared/view/audio SFX_FALLBACK). Then the floor modifiers' five
 * (docs/FLOOR_MODIFIERS.md FM7, floorModifiers.ts FLOOR_MODIFIER_AUDIO_IDS): one sting per kind on the floor card
 * banner's stamp (a boon falls back to sfx.jingle.treasure, the twist to sfx.horde.horn). Then the Codex's one
 * (claude/codex-plan.md CX5, codex.ts CODEX_AUDIO_IDS): a codex toast's chime (no fallback: silent until a clip is
 * picked, CXD12). Then the secret rooms' three (docs/SECRET_ROOMS.md SR10, secrets.ts SECRET_AUDIO_IDS): the crack's
 * hollow knock, the wall's crumble, the discovery jingle (falling back to sfx.breakable.hit / sfx.breakable.break /
 * sfx.jingle.treasure while silent). Then Silver's four (docs/SILVER.md SV7, silver.ts SILVER_AUDIO_IDS): the counter's
 * tick, a Silver piece's clink, an Armory purchase and a refusal. Then the third endless set's eight (docs/NEW_ENEMIES_2.md NX1, newEnemies2.ts
 * NEW_ENEMY_2_AUDIO_IDS): the Bulwark's block and guard break, the Chainhook's throw and latch, the Snatcher's snatch and
 * swallow, a stolen pellet's return, a brazier lighting (each with a one-step SFX_FALLBACK while silent).
 */
export const PORT_AUDIO_EVENTS = [
	"sfx.player.swing",
	"sfx.player.flask",
	"sfx.player.swap",
	"sfx.player.deflect",
	"sfx.enemy.telegraph",
	"sfx.boss.death",
	"sfx.victory",
	"sfx.ui.back",
	"sfx.ui.move",
	"sfx.player.finisher",
	"sfx.player.charged",
	"sfx.room.clear",
	"sfx.relic.take",
	"sfx.shrine.use",
	"sfx.stairwell.open",
	"sfx.floor.enter",
	"sfx.depth.up",
	"sfx.jingle.gameover",
	"music.tutorial",
	"music.lobby",
	"sfx.boss.taunt",
	// docs/BOOSTS.md B5: a boost drop lands, is collected, runs out; an Aegis pip absorbs a hit (the plan's
	// `sfx.boost.aegisBreak`: asset ID segments are lowercase, as decor kinds are)
	"sfx.boost.drop",
	"sfx.boost.collect",
	"sfx.boost.expire",
	"sfx.boost.aegisbreak",
	// docs/ROOM_CLEAR.md RC4: PERFECT's jingle, a tally tick, a bonus landing in the score
	"sfx.room.perfect",
	"sfx.score.tick",
	"sfx.score.land",
	// docs/COMBO.md CB3: the combo reaches a named tier (sfx.combo.tier, pitched per tier by the cue mapper); the combo
	// breaks during a fight (sfx.combo.break, the shatter; a lapse with no fight on plays nothing)
	"sfx.combo.tier",
	"sfx.combo.break",
	// docs/GRAZE_PARRY.md GP3: a graze's shimmer (pitched by the cue mapper's chain ladder); a guard that erased bullets (replaces the deflect)
	"sfx.player.graze",
	"sfx.player.parry",
	// docs/DRAFT_REVEAL.md DR4: the boon draft reveal, played by the client's reveal controller (not from sim events):
	// a card flips (pitched up per card), a rare face lands (the chime), a legendary's charge (one short hit played as a
	// rising ladder), the legendary flare (a jingle: it ducks the music), a boon is taken (the stamp)
	"sfx.draft.flip",
	"sfx.draft.rare",
	"sfx.draft.charge",
	"sfx.draft.legendary",
	"sfx.draft.pick",
	// docs/ENEMY_VARIANTS.md EV1: an Imp blinks to its ring, a Summoner calls its swarmers, an Ooze splits, a shield
	// breaks, a Vengeful corpse fires its ring
	"sfx.enemy.blink",
	"sfx.enemy.summon",
	"sfx.enemy.split",
	"sfx.affix.shieldbreak",
	"sfx.affix.vengeful",
	// docs/NEW_BEST.md NB4: the shown score passes the best / the first floor past the deepest (a jingle); a record
	// run's run over, in place of sfx.jingle.gameover (a jingle)
	"sfx.best.new",
	"sfx.jingle.record",
	// docs/BUILDS.md BU1 (builds.ts BUILD_AUDIO_IDS, the same list): a spark arcs, a burst, shards fly, an ember lights,
	// a nova, an execute, an evolution or a duo is taken, a Jackpot pays
	"sfx.build.spark",
	"sfx.build.burst",
	"sfx.build.shard",
	"sfx.build.ember",
	"sfx.build.nova",
	"sfx.build.execute",
	"sfx.build.evolve",
	"sfx.build.duo",
	"sfx.build.jackpot",
	// docs/LEGENDARIES.md LG5 (the same list): an Overkill streak, a Bastion brace
	"sfx.build.overkill",
	"sfx.build.brace",
	// docs/BUILDS_V2.md BV10 (the same list): Riposte's counter-wave, Siege Bolt's pin / slam, a Wrecker smash, Full
	// Heart's beam
	"sfx.build.counter",
	"sfx.build.pin",
	"sfx.build.slam",
	"sfx.build.smash",
	"sfx.build.beam",
	// docs/DAILY.md DS10 / DS12: a daily run's predicted rank enters the top 100 / 10 / 3 / #1 (with the floor shout);
	// the shown score passes a friend's best today (with their toast)
	"sfx.rank.up",
	"sfx.friend.passed",
	// docs/BREAKABLE_DROPS.md BL5: a loaded barrel / crate breaks and its boost hops out (in place of sfx.boost.drop for
	// that landing, which plays while this one is silent)
	"sfx.breakable.loot",
	// docs/NEW_ENEMIES.md NE1: a Bomber's fuse starts / it blasts; a Charger charges / staggers on a wall; lightning
	// strikes a Stormcaller's row; a Reaper starts spinning
	"sfx.enemy.fuse",
	"sfx.enemy.blast",
	"sfx.enemy.charge",
	"sfx.enemy.stun",
	"sfx.enemy.strike",
	"sfx.enemy.spin",
	// docs/PELLETS.md PL6 (pellets.ts PELLET_AUDIO_IDS, the same list): a pellet eaten (the chomp, two alternating
	// pitches from the cue mapper), every pellet of a room taken before its last enemy died (the sweep sting), the power
	// pellet taken (every enemy bullet becomes points)
	"sfx.pellet.eat",
	"sfx.pellet.sweep",
	"sfx.pellet.power",
	// docs/RUN_RECAP.md CM4 (runRecap.ts TEAM_MOMENT_AUDIO_IDS, the same list): a party run's TEAM PERFECT jingle (the
	// PERFECT jingle while silent) and a SYNC! parry (the parry while silent)
	"sfx.room.teamperfect",
	"sfx.player.syncparry",
	// docs/TREASURE.md TR6 (treasure.ts TREASURE_AUDIO_IDS, the same list): a vault's lock cracks (a metal snap), its
	// cage unlocks (a rattle), its chest opens (the sting, pitched per tier by the cue mapper), a Legendary chest opens
	// (a jingle: it ducks the music)
	"sfx.treasure.crack",
	"sfx.treasure.unlock",
	"sfx.treasure.open",
	"sfx.jingle.treasure",
	// docs/FORTUNE.md FO6 (fortune.ts FORTUNE_AUDIO_IDS, the same list): a pact taken at an altar (a low bell); the Horde
	// room's horn on entry, its second wave arriving, the x2 landing in the tally; the Goldling popping out, each hit on
	// it (a ladder), the catch (a jingle), the escape
	"sfx.pact.take",
	"sfx.horde.horn",
	"sfx.horde.wave",
	"sfx.horde.double",
	"sfx.golden.appear",
	"sfx.golden.hit",
	"sfx.golden.jackpot",
	"sfx.golden.escape",
	// docs/FLOOR_MODIFIERS.md FM7 (floorModifiers.ts FLOOR_MODIFIER_AUDIO_IDS, the same list): a floor modifier's sting
	// on the floor card banner's stamp, one per kind (FMD9; asset ID segments are lowercase: `.bloodmoon`): a boon's
	// bright, the twist's ominous
	"sfx.floor.modifier.gilded",
	"sfx.floor.modifier.hoard",
	"sfx.floor.modifier.feast",
	"sfx.floor.modifier.plunder",
	"sfx.floor.modifier.bloodmoon",
	// docs/GOLDLING_RUMOURS.md GR6 (fortune.ts GOLDEN_RUMOUR_AUDIO_IDS, the same list): a Goldling hides on this floor
	// (a soft, far-off coin jingle), its room engaged (the same jingle, closer and brighter)
	"sfx.golden.rumour.floor",
	"sfx.golden.rumour.room",
	// claude/codex-plan.md CX5 (codex.ts CODEX_AUDIO_IDS, the same list): a codex toast's soft chime (CXD12; no fallback)
	"sfx.codex.new",
	// docs/SECRET_ROOMS.md SR10 (secrets.ts SECRET_AUDIO_IDS, the same list): a wrong-way hit on the crack (a hollow
	// knock), the wall bursting open (a crumble), the discovery jingle on the reveal
	"sfx.secret.knock",
	"sfx.secret.open",
	"sfx.jingle.secret",
	// docs/SILVER.md SV7 (silver.ts SILVER_AUDIO_IDS, the same list): the Silver counter ticking, a Silver piece's coin
	// clink, an Armory purchase landing and one refused
	"sfx.silver.gain",
	"sfx.silver.crate",
	"sfx.shop.buy",
	"sfx.shop.deny",
	// docs/NEW_ENEMIES_2.md NX1 (newEnemies2.ts NEW_ENEMY_2_AUDIO_IDS): a shot blocked by a Bulwark's shield / its guard
	// broken; a Chainhook's throw / its hook latching; a Snatcher eating a pellet / swallowing; a stolen pellet back on the
	// floor; a Pyre-keeper's brazier flaring up
	"sfx.enemy.block",
	"sfx.enemy.guardbreak",
	"sfx.enemy.hook",
	"sfx.enemy.hooklatch",
	"sfx.enemy.snatch",
	"sfx.enemy.swallow",
	"sfx.pellet.return",
	"sfx.enemy.pyrelight",
	// docs/NEW_ENEMIES_3.md NT1 (newEnemies3.ts NEW_ENEMY_3_AUDIO_IDS): a Mortar's lob / its shell landing; a Mender's
	// heal pulse / its beam cut; a Jackal's lunge / its spooked hop
	"sfx.enemy.lob",
	"sfx.enemy.shell",
	"sfx.enemy.heal",
	"sfx.enemy.healcut",
	"sfx.enemy.lunge",
	"sfx.enemy.spooked",
] as const;

/**
 * Roblox port (docs/FX_AUDIO.md A2): one ambience loop per biome, `amb.b<n>` (b1..b5 = biome.1..5, the decor biome
 * keys). Required, sound or silent (AMBIENCE slot); any other `amb.` ID is an error.
 */
export const AMBIENCE_IDS = ["amb.b1", "amb.b2", "amb.b3", "amb.b4", "amb.b5"] as const;
/** A biome's ambience loop ID (an AMBIENCE_IDS entry, `amb.b<n>`); `ambienceId` builds it from a biome ID. */
export type AmbienceId = (typeof AMBIENCE_IDS)[number];

/**
 * Every asset ID a pack must define (biome tile IDs are required through the biome entries). Built inside a function
 * like REQUIRED_STRING_KEYS: the spreads' Luau temporaries were about 25 of this module's top-level locals, which sit
 * near Luau's 200-per-function limit (docs/NEW_BEST.md NB4).
 */
export const REQUIRED_ASSET_IDS: ReadonlyArray<string> = ((): string[] => [
	...CLASS_IDS.map((c) => `class.${c}`),
	...ENEMY_ARCHETYPES.map((e) => `enemy.${e}`),
	...BOSS_IDS,
	...BULLET_IDS,
	...ITEM_IDS,
	...UI_IDS,
	...AUDIO_EVENTS,
	...BREAKABLE_KINDS.map((k) => breakableId(k)),
	...BREAKABLE_AUDIO_EVENTS,
	...PORT_AUDIO_EVENTS,
	...AMBIENCE_IDS,
	...BOOST_KINDS.map((k) => boostId(k)),
	// docs/PELLETS.md PL6: pellets.ts PELLET_IDS, written out (an import would be one more top-level local)
	"pellet.normal",
	"pellet.power",
	// docs/TREASURE.md TR6: treasure.ts TREASURE_IDS, written out (an import would be one more top-level local)
	"treasure.chest",
	"treasure.chestopen",
	"treasure.cage",
	// docs/FORTUNE.md FO6: fortune.ts PACT_ALTAR_ID, written out
	"pact.altar",
])();
