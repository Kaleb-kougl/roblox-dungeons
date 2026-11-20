/** The theme contract's required string keys (docs/CODEBASE_SCALE.md DX8: a pure move out of contract.ts). */
import { ENEMY_VARIANT_STRING_KEYS } from "../variants";
import { NEW_BEST_STRING_KEYS } from "../newBest";
import { DAILY_STRING_KEYS } from "../daily";
import { ROSTER_STRING_KEYS } from "../roster";
import { DAILY_RANK_STRING_KEYS } from "../dailyRank";
import { INPUT_KEY_STRING_KEYS } from "../inputKeys";
import { CODEX_STRING_KEYS } from "../codex";
import { silverStringKeys } from "../silver";
import { silverShopStringKeys } from "../silverShop";
import { cosmeticStringKeys } from "../cosmetics";
import {
	BOOST_STRING_KEYS,
	BOSS_IDS,
	BREAKABLE_KINDS,
	CLASS_IDS,
	ENEMY_ARCHETYPES,
	RARITIES,
	breakableId,
} from "./ids";

/**
 * Roblox port (docs/PRELOAD.md P4): the join loading screen's strings (shared/view LOADING_STRINGS): its title, the
 * count under the bar (`{done}` / `{total}`) and the Skip button.
 */
export const LOADING_STRING_KEYS = ["loading.title", "loading.progress", "loading.skip"] as const;

/**
 * Roblox port (docs/STAGE_LOADER.md SL2): the stage loader's cover strings (shared/view STAGE_STRINGS): a ranked run
 * start waiting for the server, floor `{floor}` being generated, the views being rebuilt, the floor-change card's title
 * (`{floor}`) and its boss-floor line. The card's biome line is the pack's `biome.<n>.name`.
 */
export const STAGE_STRING_KEYS = [
	"stage.starting",
	"stage.forging",
	"stage.building",
	"stage.floorCard",
	"stage.bossFloor",
] as const;

/**
 * Roblox port (docs/MOBILE.md MB7): the touch controls' strings (shared/view TOUCH_STRINGS, touchButtonLabelKey): the nine
 * button labels (`touch.<id>`) and the four hint lines that replace the key names on touch. The theme imports nothing
 * outside shared/theme, so the list is repeated here.
 */
export const TOUCH_STRING_KEYS = [
	"touch.attack",
	"touch.alt",
	"touch.roll",
	"touch.ember",
	"touch.flask",
	"touch.swap",
	"touch.shrine",
	"touch.spectateNext",
	"touch.spectatePrev",
	"touch.hint.draft",
	"touch.hint.shrine",
	"touch.hint.spectate",
	"touch.hint.mapClose",
] as const;

/**
 * Roblox port (docs/ROOM_CLEAR.md RC3): the room clear celebration's strings (shared/view ROOM_CLEAR_STRINGS): the
 * two stamps, the stamp for several rooms on one tick (`{stamp}`, `{rooms}`), the tally segments (`{points}`), the
 * running total, the corner chip (`{stamp}`, `{points}`) and the flying bonus (`{points}`). The theme imports nothing
 * outside shared/theme, so the list is repeated here. Then the pellets' two tally segments (docs/PELLETS.md PL6,
 * pellets.ts PELLET_ROOM_CLEAR_KEYS): the pellet points earned in the room and the Sweep bonus. Then the Horde's
 * (docs/FORTUNE.md FO6, fortune.ts HORDE_ROOM_CLEAR_KEY): the last segment that doubles a Horde room's tally.
 */
export const ROOM_CLEAR_STRING_KEYS = [
	"room.clear.stamp.clear",
	"room.clear.stamp.perfect",
	"room.clear.stamp.multi",
	"room.clear.line.kills",
	"room.clear.line.clear",
	"room.clear.line.perfect",
	"room.clear.line.fast",
	"room.clear.total",
	"room.clear.chip",
	"room.clear.fly",
	"room.clear.line.pellets",
	"room.clear.line.sweep",
	"room.clear.line.horde",
] as const;

/**
 * Roblox port (docs/COMBO.md CB3): the combo's strings (shared/view COMBO_STRINGS): the four tier names (x2 RAMPAGE, x3
 * CARNAGE, x4 DOMINATING, x5 UNSTOPPABLE; the tier below x2 has no name), the tier slot's COMBO LOST after a break and
 * its BEST x3.4 after a lapse (`{combo}`, the streak's peak, formatted like `hud.score.combo`), the floor shout around
 * a tier's name (`{name}`, "RAMPAGE!") and the run-over best combo with its tier (`{combo}` `{name}`; docs/LOCALIZATION.md
 * L1). The theme imports nothing outside shared/theme, so the list is repeated here.
 */
export const COMBO_STRING_KEYS = [
	"hud.combo.rampage",
	"hud.combo.carnage",
	"hud.combo.dominating",
	"hud.combo.unstoppable",
	"hud.combo.lost",
	"hud.combo.best",
	"hud.combo.shout",
	"hud.combo.bestNamed",
] as const;

/**
 * Roblox port (docs/GRAZE_PARRY.md GP3): the parry flash's strings (shared/view, GP7): PARRY! and the counted form a
 * guard that erased 3 or more bullets shows (`{text}` PARRY!, `{n}` the guard's erase count: "PARRY! x5"). The theme imports
 * nothing outside shared/theme, so the list is repeated here.
 */
export const NEAR_MISS_STRING_KEYS = ["fx.parry.text", "fx.parry.count"] as const;

/**
 * Every string key a pack must define. Code may rely on these existing. Built inside a function: the spreads' Luau
 * temporaries would otherwise be top-level locals, and this module's compiled Luau sits near the 200-locals-per-function
 * limit (docs/ROOM_CLEAR.md RC3).
 */
export const REQUIRED_STRING_KEYS: ReadonlyArray<string> = ((): string[] => [
	"game.title",
	"ember.name",
	...CLASS_IDS.map((c) => `class.${c}.name`),
	// docs/ARCHER.md AR11: characters.ts characterStringKeys(), written out (an import would be one more top-level
	// local): the character screen's title and Start, the run-over Character button, two summary lines per character
	"character.title",
	"character.start",
	"run.over.character",
	"character.knight.line.1",
	"character.knight.line.2",
	"character.archer.line.1",
	"character.archer.line.2",
	...ENEMY_ARCHETYPES.map((e) => `enemy.${e}.name`),
	...BOSS_IDS.map((b) => `${b}.name`),
	...RARITIES.map((r) => `rarity.${r}.name`),
	"act.1.name",
	"act.2.name",
	"act.3.name",
	"act.4.name",
	"act.endgame.name",
	"hud.health",
	"hud.mana",
	"hud.ember",
	"hud.level",
	"hud.gold",
	"hud.paused",
	"hud.armor",
	"hud.flask",
	"hud.dead",
	"hud.left",
	"menu.play",
	"menu.options",
	"menu.quit",
	...BREAKABLE_KINDS.map((k) => `${breakableId(k)}.name`),
	...BOOST_STRING_KEYS,
	...LOADING_STRING_KEYS,
	...STAGE_STRING_KEYS,
	...TOUCH_STRING_KEYS,
	...ROOM_CLEAR_STRING_KEYS,
	...COMBO_STRING_KEYS,
	...NEAR_MISS_STRING_KEYS,
	...ENEMY_VARIANT_STRING_KEYS,
	// docs/NEW_BEST.md NB4: the target row, the floor shout, the stairwell line, the run-over panel, the menu line
	...NEW_BEST_STRING_KEYS,
	// docs/BUILDS.md BU1: builds.ts BUILD_STRING_KEYS, written out (an import would be one more top-level local)
	"hud.draft.level",
	"hud.draft.evolve",
	"hud.draft.duo",
	"hud.draft.again",
	"hud.toast.evolved",
	"hud.toast.duo",
	"hud.build.title",
	// docs/LEGENDARIES.md LG5: Bastion's brace toasts and floor text (BUILD_STRING_KEYS)
	"hud.toast.brace",
	"hud.toast.braceHeal",
	"fx.brace.text",
	// docs/BUILDS_V2.md BV10 (BUILD_STRING_KEYS): the duo hint, Riposte's counter, Siege Bolt's pin / slam floor texts,
	// Happy Hour's toast
	"hud.draft.duoHint",
	"fx.counter.text",
	"fx.pinned.text",
	"fx.slam.text",
	"hud.toast.happyHour",
	// docs/ITEM_TOOLTIPS.md IT3: shared/view/hud TOOLTIP_STRINGS, written out (tooltip.spec.ts checks they agree): the
	// kind lines, Next / evolves / duo recipe / time left, the "+N" count, the Build list's sections, Build / Map
	"hud.tip.kind.boon",
	"hud.tip.kind.evolved",
	"hud.tip.kind.duo",
	"hud.tip.kind.relic",
	"hud.tip.kind.curse",
	"hud.tip.kind.boost",
	"hud.tip.next",
	"hud.tip.evolves",
	"hud.tip.duoFrom",
	"hud.tip.secondsLeft",
	"hud.tip.more",
	"hud.build.boons",
	"hud.build.duos",
	"hud.build.relics",
	"hud.build.curses",
	"hud.build.boosts",
	"pause.build",
	"pause.map",
	// docs/DAILY.md DS9 / DS11: the main menu's Daily card and podium, the leaderboard tabs, the run-over daily block
	...DAILY_STRING_KEYS,
	// docs/DAILY.md DS2: the stage card's roster line (floor 1's kinds, a floor's new kinds)
	...ROSTER_STRING_KEYS,
	// docs/DAILY.md DS10: new best's "best today" wording, the rank layer's target row, toasts, shouts, run-over row
	...DAILY_RANK_STRING_KEYS,
	// docs/LOCALIZATION.md L1: named keys' labels (`input.key.<name>`) and the key list joiner
	...INPUT_KEY_STRING_KEYS,
	// docs/GAMEPAD_MENUS.md GM7 / GM9: padHints.ts GAMEPAD_MENU_STRING_KEYS, written out (an import would be one more
	// top-level local): the hint bar's labels and the Options vibration row
	"pad.hint.select",
	"pad.hint.back",
	"pad.hint.close",
	"pad.hint.resume",
	"pad.hint.cancel",
	"pad.hint.tabs",
	"pad.hint.subTabs",
	"pad.hint.scroll",
	"pad.hint.holdExit",
	"pad.hint.details",
	"pad.hint.refresh",
	"pad.hint.create",
	"pad.hint.ready",
	"pad.hint.invite",
	"pad.hint.invites",
	"pad.hint.reset",
	"options.controls.vibration",
	// docs/RUN_RECAP.md RR3: runRecap.ts RECAP_STRING_KEYS, written out (an import would be one more top-level local):
	// the near-miss line, the highlight labels, the co-op tags and the Details toggle
	"run.recap.near.boss",
	"run.recap.near.score",
	"run.recap.near.recordFloor",
	"run.recap.near.stairs",
	"run.recap.near.fullClear",
	"run.recap.near.fullClearOne",
	"run.recap.near.nextBoss",
	"run.recap.hl.bossNoHit",
	"run.recap.hl.bosses",
	"run.recap.hl.combo",
	"run.recap.hl.perfect",
	"run.recap.hl.teamPerfect",
	"run.recap.hl.ofTotal",
	"run.recap.hl.points",
	"run.recap.hl.teamStreak",
	"run.recap.hl.duos",
	"run.recap.hl.evolved",
	"run.recap.hl.parries",
	"run.recap.hl.syncParries",
	"run.recap.hl.sweeps",
	"run.recap.hl.chests",
	"run.recap.hl.grazes",
	"run.recap.hl.jackpots",
	"run.recap.hl.speed",
	"run.recap.hl.kills",
	"run.recap.hl.rooms",
	"run.recap.team",
	"run.recap.you",
	"run.recap.details",
	"run.recap.detailsHide",
	// docs/RUN_RECAP.md CM3: runRecap.ts TEAM_MOMENT_STRING_KEYS, written out: the TEAM PERFECT stamp and its streak,
	// SYNC! and its three-player count
	"room.clear.teamPerfect",
	"room.clear.teamStreak",
	"fx.parry.sync",
	"fx.parry.syncCount",
	// docs/RUN_CONTRIBUTION.md CT4: runRecap.ts CONTRIB_STRING_KEYS, written out (an import would be one more top-level
	// local): the You / Team / Party tabs, the You card, the standing line, the Party header, every title and description
	"run.recap.tab.you",
	"run.recap.tab.team",
	"run.recap.tab.party",
	"run.recap.you.header",
	"run.recap.you.shareBar",
	"run.recap.you.damage",
	"run.recap.you.kills",
	"run.recap.you.bossDamage",
	"run.recap.you.parries",
	"run.recap.you.grazes",
	"run.recap.you.hits",
	"run.recap.you.pickups",
	"run.recap.you.share",
	"run.recap.you.pickupsValue",
	"run.recap.you.boosts",
	"run.recap.you.boostOne",
	"run.recap.you.pellets",
	"run.recap.you.pelletOne",
	"run.recap.you.lastToFall",
	"run.recap.you.stood",
	"run.recap.you.fell",
	"run.recap.you.left",
	"run.recap.party.damage",
	"run.recap.party.kills",
	"run.recap.party.parries",
	"run.recap.party.hits",
	"run.recap.party.share",
	"run.recap.title.heavyHitter",
	"run.recap.title.bossBreaker",
	"run.recap.title.finisher",
	"run.recap.title.guardian",
	"run.recap.title.daredevil",
	"run.recap.title.untouchable",
	"run.recap.title.lastStand",
	"run.recap.title.collector",
	"run.recap.title.teammate",
	"run.recap.titleDesc.heavyHitter",
	"run.recap.titleDesc.bossBreaker",
	"run.recap.titleDesc.finisher",
	"run.recap.titleDesc.guardian",
	"run.recap.titleDesc.daredevil",
	"run.recap.titleDesc.untouchable",
	"run.recap.titleDesc.lastStand",
	"run.recap.titleDesc.collector",
	"run.recap.titleDesc.teammate",
	// docs/TREASURE.md TR6: treasure.ts TREASURE_STRING_KEYS, written out (an import would be one more top-level local):
	// the floor-reveal and arm toasts, the lock names, the unlock / open / near-miss lines, the reward cards
	"hud.toast.vault",
	"hud.toast.vaultLock.untouched",
	"hud.toast.vaultLock.untouchedParty",
	"hud.toast.vaultLock.swift",
	"treasure.lock.untouched",
	"treasure.lock.swift",
	"treasure.unlocked",
	"treasure.spareTime",
	"treasure.spareHits",
	"treasure.kept",
	"treasure.nearMiss.time",
	"treasure.nearMiss.hits",
	"treasure.reward.relic",
	"treasure.reward.draft",
	"treasure.reward.boosts",
	"treasure.reward.points",
	// docs/FORTUNE.md FO6: fortune.ts FORTUNE_STRING_KEYS, written out (an import would be one more top-level local):
	// the two altar cards and their accept line, the dimmed altar's lines (fortune.ts PACT_DIM_STRING_KEYS), the Greed
	// deal's draft title, the Horde chip and shouts, the Goldling's shout and escape line, the Horde room's score pop
	"pact.greed.title",
	"pact.greed.take",
	"pact.greed.gain",
	"pact.horde.title",
	"pact.horde.take",
	"pact.horde.gain",
	"pact.accept",
	"pact.dim.taken",
	"pact.dim.noCurse",
	"pact.dim.noLegendary",
	"pact.dim.noRoom",
	"pact.dim.unable",
	"hud.draft.title.greed",
	"hud.chip.horde",
	"fx.horde.shout",
	"fx.horde.wave",
	"fx.golden.shout",
	"fx.golden.escaped",
	// docs/FORTUNE.md FO7: a Horde room kill's score pop (`+{points}` and the x2 mark)
	"hud.score.pop.horde",
	// docs/FLOOR_MODIFIERS.md FM7: floorModifiers.ts FLOOR_MODIFIER_STRING_KEYS, written out (an import would be one
	// more top-level local): each kind's banner name and line, then the pause line (`{name}` · `{line}`)
	"floormod.gilded.name",
	"floormod.gilded.line",
	"floormod.hoard.name",
	"floormod.hoard.line",
	"floormod.feast.name",
	"floormod.feast.line",
	"floormod.plunder.name",
	"floormod.plunder.line",
	"floormod.bloodMoon.name",
	"floormod.bloodMoon.line",
	"hud.pause.floorMod",
	// docs/GOLDLING_RUMOURS.md GR7: fortune.ts GOLDEN_RUMOUR_STRING_KEYS, written out: the rumour chip's two lines
	"hud.chip.golden.rumour",
	"hud.chip.golden.hiding",
	// claude/codex-plan.md CX5: the Codex screen, its states, hints, kind lines and descriptions, the in-run chip / tag /
	// toast lines, the run-over line and the menu button (codex.ts CODEX_STRING_KEYS)
	...CODEX_STRING_KEYS,
	// docs/SECRET_ROOMS.md SR10: secrets.ts SECRET_STRING_KEYS, written out (no new top-level local): the SECRET! shout,
	// the co-op toast, the secret chest's card title, the recap highlight, the Codex entry's name
	"fx.secret.text",
	"hud.toast.secret",
	"treasure.secret.title",
	"run.recap.hl.secrets",
	"secret.room.name",
	// docs/SILVER.md SV7: silver.ts SILVER_STRING_KEYS (built inside its own function): the counter's pop, the run-over
	// rows, the Armory, the main menu's balance, the character screen's lock and the returning-player card
	...silverStringKeys(),
	// docs/SILVER_SHOP.md SH4: silverShop.ts SILVER_SHOP_STRING_KEYS (built inside its own function): the Get Silver
	// panel and the `+` beside a Silver balance
	...silverShopStringKeys(),
	// docs/COSMETICS.md CS3: cosmetics.ts COSMETIC_STRING_KEYS (built inside its own function): the Cosmetics tab's
	// buttons and tag, the slot headers, every cosmetic item's name
	...cosmeticStringKeys(),
])();
