--!nonstrict
--[[
	The numbers docs/FACTS.md reports, read from the compiled game (docs/CODEBASE_SCALE.md DX10), as one JSON
	object on stdout. Run by scripts/facts.js (npm run facts / facts:check); NEEDS A BUILD FIRST.
]]

local fs = require("@lune/fs")
local process = require("@lune/process")
local serde = require("@lune/serde")

local RojoTree = require("./lib/rojoTree")
local Realm = require("./lib/realm")
local Services = require("./lib/services")

if not fs.isDir("out/shared") then
	io.stderr:write("out/shared does not exist. Run `npm run build` first.\n")
	process.exit(1)
end

local game = Services.install(RojoTree.build("default.project.json"))
local TS = game:GetService("ReplicatedStorage"):FindFirstChild("TS")
local realm = Realm.new(game)
local function shared(name: string)
	local inst = TS:FindFirstChild(name)
	assert(inst, "out/shared/" .. name .. " missing (stale build?)")
	return realm:require(inst)
end

local theme = shared("theme")
local sim = shared("sim")
local daily = shared("daily")
local codex = shared("codex")
local onboarding = shared("onboarding")

local function list(values): { string }
	local out = {}
	for _, v in values do
		table.insert(out, tostring(v))
	end
	return out
end

local customEvents = 0
local funnels = 0
for _, e in onboarding.ANALYTICS_CATALOG do
	if e.kind == "custom" then
		customEvents += 1
	elseif e.kind == "funnel" or e.kind == "onboarding" then
		funnels += 1
	end
end

print(serde.encode("json", {
	dailyRuleset = daily.DAILY.ruleset,
	simButtons = sim.SIM_BUTTONS,
	archetypes = list(sim.archetypeIds()),
	codexEntries = #codex.CODEX_CATALOG,
	analyticsCustomEvents = customEvents,
	analyticsFunnels = funnels,
	analyticsCombinations = onboarding.analyticsCatalogCombinations(),
	portAudioEvents = #theme.PORT_AUDIO_EVENTS,
	requiredAssetIds = #theme.REQUIRED_ASSET_IDS,
	requiredStringKeys = #theme.REQUIRED_STRING_KEYS,
	colorRoles = #theme.COLOR_ROLES,
	enemyArchetypeSlots = #theme.ENEMY_ARCHETYPES,
	boons = if sim.BOON_COUNT ~= nil then sim.BOON_COUNT else -1,
}))
