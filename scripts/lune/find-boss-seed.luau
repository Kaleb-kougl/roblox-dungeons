--!nonstrict
--[[
	Endless boss seed finder (docs/BOSS_DEMONLORD.md D5). Run through `node scripts/find-boss-seed.js` (which builds
	first unless --no-build), or directly after `npm run build`:

	  lune run scripts/lune/find-boss-seed.luau [--floor N] [--from N] [--to N] [--top N]

	Lists, per endless boss (shared/dungeon ENDLESS_BOSSES), the first `--top` run seeds in [--from, --to] whose boss
	floor `--floor` (default 5) holds that boss: shared/dungeon bossKindFor(floorSeed(runSeed, floor)), the compiled
	game code itself (no copy of the pick). Use a listed seed to reach a chosen boss in Studio (start an endless run with
	that seed and skip to the floor with the debug floor skip). dungeon/endless.spec.ts pins the first seeds of floor 5.

	It requires the compiled modules (out/shared) through the same fake DataModel the spec runner uses.
]]

local process = require("@lune/process")

local RojoTree = require("./lib/rojoTree")
local Realm = require("./lib/realm")
local Services = require("./lib/services")

local args = { floor = 5, from = 1, to = 1000, top = 10 }
do
	local i = 1
	local a = process.args
	while i <= #a do
		local k, v = a[i], a[i + 1]
		if k == "--floor" then
			args.floor = tonumber(v)
		elseif k == "--from" then
			args.from = tonumber(v)
		elseif k == "--to" then
			args.to = tonumber(v)
		elseif k == "--top" then
			args.top = tonumber(v)
		else
			error("unknown argument " .. tostring(k), 0)
		end
		i += 2
	end
end

local game = Services.install(RojoTree.build("default.project.json"))
local TS = game:GetService("ReplicatedStorage"):FindFirstChild("TS")
local realm = Realm.new(game)
local dungeon = realm:require(TS:FindFirstChild("dungeon"))

if not dungeon.isBossFloor(args.floor) then
	error(string.format("floor %d is not a boss floor (every %dth floor is)", args.floor, dungeon.BOSS_FLOOR_EVERY), 0)
end

local found = {}
local counts = {}
for _, b in dungeon.ENDLESS_BOSSES do
	found[b.kind] = {}
	counts[b.kind] = 0
end
local scanned = 0
for seed = args.from, args.to do
	local kind = dungeon.bossKindFor(dungeon.floorSeed(seed, args.floor))
	scanned += 1
	counts[kind] += 1
	if #found[kind] < args.top then
		table.insert(found[kind], tostring(seed))
	end
end

print(string.format("floor %d, run seeds %d..%d (%d scanned)", args.floor, args.from, args.to, scanned))
for _, b in dungeon.ENDLESS_BOSSES do
	print(
		string.format(
			"%-16s %5.1f%%  first %d: %s",
			b.kind,
			100 * counts[b.kind] / scanned,
			#found[b.kind],
			table.concat(found[b.kind], ", ")
		)
	)
end
