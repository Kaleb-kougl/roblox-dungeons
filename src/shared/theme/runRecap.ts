/**
 * Roblox port (docs/RUN_RECAP.md RR3 / CM3 / CM4, docs/RUN_CONTRIBUTION.md CT4): the run-over recap's, the co-op
 * moments' and the co-op contribution's theme keys. Pure data with
 * no runtime import. contract.ts writes the string lists out inside REQUIRED_STRING_KEYS (an import would be one more
 * top-level local in contract.luau, which sits near Luau's 200-locals-per-function limit) and the two sounds inside
 * PORT_AUDIO_EVENTS; runRecap.spec.ts checks they stay the same lists.
 */

/**
 * Every run-over recap string (Part A, docs/RUN_RECAP.md RR3), all REQUIRED. The near-miss line's candidates
 * (`run.recap.near.*`: the boss nearly down `{boss}` / `{pct}`, the score just short `{gap}`, one floor from a record, the
 * stairs close `{tiles}` / `{next}`, nearly a full clear `{rooms}` and its one-room form, the next boss `{boss}`), the
 * highlight labels (`run.recap.hl.*`: values are drawn beside them; `ofTotal` is the value "{n} of {total}", `points` a
 * points value "{n} pts"), the co-op
 * row tags `Team` / `You` and the Details toggle (`details` opens the breakdown, `detailsHide` returns to the
 * highlights). The theme imports nothing outside shared/theme, so the view's list (shared/view/hud) repeats these.
 */
export const RECAP_STRING_KEYS: ReadonlyArray<string> = [
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
];

/**
 * Every co-op moment string (Part B, docs/RUN_RECAP.md CM3), all REQUIRED: the party run's stamp in place of PERFECT
 * (`room.clear.teamPerfect`) and with a streak from 2 (`room.clear.teamStreak`, `{n}` the streak), the SYNC! floor text
 * (`fx.parry.sync`) and its three-player form (`fx.parry.syncCount`, `{n}` the players). Already upper-case where the
 * game shows capitals: code never upper-cases text (docs/LOCALIZATION.md).
 */
export const TEAM_MOMENT_STRING_KEYS: ReadonlyArray<string> = [
	"room.clear.teamPerfect",
	"room.clear.teamStreak",
	"fx.parry.sync",
	"fx.parry.syncCount",
];

/**
 * Every co-op contribution string (docs/RUN_CONTRIBUTION.md CT4), all REQUIRED, in contract.ts REQUIRED_STRING_KEYS right
 * after TEAM_MOMENT_STRING_KEYS (written out there, like these lists). The `You | Team | Party` tabs; the You card's
 * header (`{title}` the title's name), share bar (`{pct}`), cell labels, value forms (`share`: `{value}` the formatted
 * number and `{pct}`; `pickupsValue` joins the two parts `{boosts}` / `{pellets}`, each its own string: `boosts` /
 * `pellets` with `{n}` or the singular `boostOne` / `pelletOne`) and standing line (`{floor}`, `{time}` as m:ss); the
 * Party tab's header labels; every title's name (`run.recap.title.<title>`) and description (`run.recap.titleDesc.*`).
 * The view's list (shared/view/hud contributionConfig.ts CONTRIB_STRINGS, contribStringKeys) repeats these.
 */
export const CONTRIB_STRING_KEYS: ReadonlyArray<string> = [
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
];

/**
 * The co-op moments' two optional port audio IDs (docs/RUN_RECAP.md CM4, CMD5; the plan's `sfx.room.teamPerfect` /
 * `sfx.player.syncParry`: asset ID segments are lowercase), in contract.ts PORT_AUDIO_EVENTS (the same list): TEAM
 * PERFECT's jingle (shared/view/audio SFX_FALLBACK: sfx.room.perfect while silent) and a SYNC! parry
 * (sfx.player.parry while silent). SILENT in the placeholder and in vale until clips exist (CM7).
 */
export const TEAM_MOMENT_AUDIO_IDS: ReadonlyArray<string> = ["sfx.room.teamperfect", "sfx.player.syncparry"];
