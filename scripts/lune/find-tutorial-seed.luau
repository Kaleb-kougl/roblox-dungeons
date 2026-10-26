--!nonstrict
--[[
	Tutorial seed search (docs/TUTORIAL.md T2). Run through `node scripts/find-tutorial-seed.js` (which builds first
	unless --no-build), or directly after `npm run build`:

	  lune run scripts/lune/find-tutorial-seed.luau [--floor 1|2] [--from N] [--to N] [--rooms 10,11] [--top N]
	                                               [--treasure-cap N]

	Floor 1: scores every seed with shared/run analyzeTutorialLayout (lower is better; see tutorialLayout.ts) and
	prints the best `--top` layouts that meet the hard criteria. Floor 2: a small boss floor, scored by the walk from
	the entrance to the boss room (fewer tiles is better) plus a penalty per room that is not the entrance or the boss.

	It requires the compiled modules (out/shared) through the same fake DataModel the spec runner uses.
]]

local process = require("@lune/process")

local RojoTree = require("./lib/rojoTree")
local Realm = require("./lib/realm")
local Services = require("./lib/services")

local args = { floor = 1, from = 0, to = 2000, rooms = { 10, 11 }, top = 10, treasureCap = nil }
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
		elseif k == "--treasure-cap" then
			args.treasureCap = tonumber(v)
		elseif k == "--rooms" then
			args.rooms = {}
			for n in string.gmatch(v, "%d+") do
				table.insert(args.rooms, tonumber(n))
			end
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
local run = realm:require(TS:FindFirstChild("run"))

local FLOOR2_EXTRA_ROOM_PENALTY = 100

-- The tutorial's own Forge params (shared/run tutorialForgeParams: an endless floor's, with this seed and room count).
local function params(seed: number, roomCount: number)
	local p = table.clone(run.tutorialForgeParams(seed, roomCount))
	if args.treasureCap ~= nil then
		p.treasureCap = args.treasureCap
	end
	return p
end

local function ids(list): string
	local out = {}
	for _, v in list do
		table.insert(out, tostring(v))
	end
	return table.concat(out, " ")
end

local function typed(d, list): string
	local out = {}
	for _, id in list do
		table.insert(out, string.format("%d:%s", id, d.rooms[id + 1].type))
	end
	return table.concat(out, " ")
end

local results = {}
local scanned = 0
for _, roomCount in args.rooms do
	for seed = args.from, args.to do
		local ok, d = pcall(dungeon.generateDungeon, params(seed, roomCount))
		scanned += 1
		if ok and d.valid then
			if args.floor == 1 then
				local r = run.analyzeTutorialLayout(d)
				if r.ok then
					table.insert(results, { seed = seed, roomCount = roomCount, score = r.score, d = d, r = r })
				end
			else
				local tour = run.tutorialTour(d, { d.entrance, d.boss })
				local extra = #d.rooms - 2
				if tour.tiles >= 0 then
					local score = tour.tiles + FLOOR2_EXTRA_ROOM_PENALTY * extra
					table.insert(results, { seed = seed, roomCount = roomCount, score = score, d = d, tour = tour })
				end
			end
		end
	end
end

table.sort(results, function(a, b)
	if a.score ~= b.score then
		return a.score < b.score
	end
	if a.roomCount ~= b.roomCount then
		return a.roomCount < b.roomCount
	end
	return a.seed < b.seed
end)

print(string.format("floor %d: %d layouts scanned, %d usable", args.floor, scanned, #results))
for i = 1, math.min(args.top, #results) do
	local x = results[i]
	local d = x.d
	if args.floor == 1 then
		local r = x.r
		local legs = {}
		for _, leg in r.tour.legs do
			table.insert(legs, tostring(leg.tiles))
		end
		print(
			string.format(
				"#%d seed %d rooms %d score %.0f | tour %d tiles (direct %d), extra rooms %d, loops %d, cover %d | %s | legs %s | crit %s",
				i,
				x.seed,
				x.roomCount,
				x.score,
				r.tour.tiles,
				r.directTiles,
				r.extraRooms,
				r.loops,
				r.coverTiles,
				typed(d, r.tour.rooms),
				table.concat(legs, ","),
				ids(r.criticalPath)
			)
		)
	else
		print(
			string.format(
				"#%d seed %d rooms %d score %.0f | entrance %d -> boss %d: %d tiles | boss room %dx%d | %s",
				i,
				x.seed,
				x.roomCount,
				x.score,
				d.entrance,
				d.boss,
				x.tour.tiles,
				d.rooms[d.boss + 1].w,
				d.rooms[d.boss + 1].h,
				typed(d, (function()
					local all = {}
					for k = 0, #d.rooms - 1 do
						table.insert(all, k)
					end
					return all
				end)())
			)
		)
	end
end
