--!nonstrict
--[[
	Void census (docs/VOID_DECOR.md VD0). After `npm run build`:

	  lune run scripts/lune/void-census.luau

	Over endless floors (run seeds 1-20 x floors 1-6, 9, 10, 14, 15; endlessFloorParams + generateDungeon, the compiled
	game code), prints: the grid's tile shares; enclosed void pockets; void cells by Chebyshev distance to the nearest
	non-void cell; the average share of the screen that is void with the camera on a floor cell (the 30 x 16.9 tile
	view, cells past the grid counted as void) and how far from a wall that on-screen void lies; greedy-rectangle
	counts (one Part each) for the shoulder bands; and the shoulder cells where a column or a stump passes the decor
	footprint rule (shared/view footprintClear) standing at wall-top height.
]]
local process = require("@lune/process")
local RojoTree = require("./lib/rojoTree")
local Realm = require("./lib/realm")
local Services = require("./lib/services")
local game = Services.install(RojoTree.build("default.project.json"))
local TS = game:GetService("ReplicatedStorage"):FindFirstChild("TS")
local realm = Realm.new(game)
local D = realm:require(TS:FindFirstChild("dungeon"))
local V = realm:require(TS:FindFirstChild("view"))
local rects = { s2 = 0, s3 = 0, mid = 0 }
local legal = { tall = 0, low = 0, tallCand = 0 }

local VOID, FLOOR, WALL, POOL = 0, 1, 2, 3
local floors = { 1, 2, 3, 4, 5, 6, 9, 10, 14, 15 }
local agg = { n = 0, W = 0, H = 0, cells = 0, void = 0, floor = 0, wall = 0, pool = 0, enclosed = 0, enclosedPockets = 0, bigPocket = 0 }
local distHist = {}
local screenVoid, screenSamples = 0, 0
local screenHist = {}
local s2 = math.sqrt(0.5)
local halfW, halfD = 15, (270 / 16 / 2) / math.sin(math.rad(55))
for run = 1, 20 do
	for _, fl in floors do
		local d = D.generateDungeon(D.endlessFloorParams(run, fl))
		local W, H, g = d.W, d.H, d.grid
		agg.n += 1; agg.W += W; agg.H += H; agg.cells += W * H
		-- multi-source BFS chebyshev distance from non-void
		local dist = {}
		local q, qh = {}, 1
		for i = 0, W * H - 1 do
			local t = g[i + 1]
			if t == VOID then agg.void += 1 elseif t == FLOOR then agg.floor += 1 elseif t == WALL then agg.wall += 1 else agg.pool += 1 end
			if t ~= VOID then dist[i] = 0; table.insert(q, i) end
		end
		while qh <= #q do
			local i = q[qh]; qh += 1
			local x, y = i % W, i // W
			for dy = -1, 1 do for dx = -1, 1 do
				local nx, ny = x + dx, y + dy
				if nx >= 0 and ny >= 0 and nx < W and ny < H then
					local j = ny * W + nx
					if dist[j] == nil then dist[j] = dist[i] + 1; table.insert(q, j) end
				end
			end end
		end
		for i = 0, W * H - 1 do
			if g[i + 1] == VOID then
				local k = math.min(dist[i], 9)
				distHist[k] = (distHist[k] or 0) + 1
			end
		end
		-- shoulder masks: greedy rect counts (one Part each)
		local function countRects(lo, hi)
			local m = table.create(W * H, 0)
			for i = 0, W * H - 1 do if g[i + 1] == VOID and dist[i] >= lo and dist[i] <= hi then m[i + 1] = 1 end end
			return #V.greedyRectsOf(m, W, H, 1)
		end
		rects.s2 += countRects(1, 2); rects.s3 += countRects(1, 3); rects.mid += countRects(4, 8)
		-- tall / low piece spots on the shoulder (d 1..3), footprint rule at wall-top height
		for i = 0, W * H - 1 do
			if g[i + 1] == VOID and dist[i] >= 1 and dist[i] <= 3 then
				legal.tallCand += 1
				local x, y = i % W, i // W
				local f = { x0 = x, y0 = y, x1 = x, y1 = y, runX = 0, runZ = 0 }
				if V.footprintClear(d, f, V.DECOR_BOX.column, nil, 1) then legal.tall += 1 end
				if V.footprintClear(d, f, V.DECOR_BOX.columnBroken, nil, 1) then legal.low += 1 end
			end
		end
		-- void components: enclosed (not touching grid edge) vs exterior
		local seen = {}
		for i = 0, W * H - 1 do
			if g[i + 1] == VOID and not seen[i] then
				local stack, size, edge, maxd = { i }, 0, false, 0
				seen[i] = true
				while #stack > 0 do
					local c = table.remove(stack)
					size += 1
					maxd = math.max(maxd, dist[c])
					local x, y = c % W, c // W
					if x == 0 or y == 0 or x == W - 1 or y == H - 1 then edge = true end
					for _, o in { { 1, 0 }, { -1, 0 }, { 0, 1 }, { 0, -1 } } do
						local nx, ny = x + o[1], y + o[2]
						if nx >= 0 and ny >= 0 and nx < W and ny < H then
							local j = ny * W + nx
							if g[j + 1] == VOID and not seen[j] then seen[j] = true; table.insert(stack, j) end
						end
					end
				end
				if not edge then
					agg.enclosed += size; agg.enclosedPockets += 1
					if maxd >= 4 then agg.bigPocket += 1 end
				end
			end
		end
		-- on-screen void share from floor cells (sampled), cells outside the grid count as void
		for i = 0, W * H - 1, 7 do
			if g[i + 1] == FLOOR then
				local cx, cy = i % W, i // W
				local v, tot = 0, 0
				for oy = -22, 22 do for ox = -22, 22 do
					local sx = (ox - oy) * s2 -- screen right
					local sd = -(ox + oy) * s2 -- screen up, on the ground
					if math.abs(sx) <= halfW and math.abs(sd) <= halfD then
						tot += 1
						local x, y = cx + ox, cy + oy
						if x < 0 or y < 0 or x >= W or y >= H then v += 1; screenHist[10] = (screenHist[10] or 0) + 1
						elseif g[y * W + x + 1] == VOID then v += 1; local k = math.min(dist[y * W + x], 9); screenHist[k] = (screenHist[k] or 0) + 1 end
					end
				end end
				screenVoid += v / tot; screenSamples += 1
			end
		end
	end
end
print(string.format("floors %d  avg grid %.0fx%.0f  cells %.0f", agg.n, agg.W / agg.n, agg.H / agg.n, agg.cells / agg.n))
print(string.format("share void %.1f%% floor %.1f%% wall %.1f%% pool %.1f%%", 100 * agg.void / agg.cells, 100 * agg.floor / agg.cells, 100 * agg.wall / agg.cells, 100 * agg.pool / agg.cells))
print(string.format("enclosed void per floor %.0f cells in %.1f pockets (%.1f with a cell >=4 from any wall)", agg.enclosed / agg.n, agg.enclosedPockets / agg.n, agg.bigPocket / agg.n))
local line = "void by chebyshev distance to nearest wall/floor (per floor):"
for k = 1, 9 do line ..= string.format(" d%d%s=%.0f", k, k == 9 and "+" or "", (distHist[k] or 0) / agg.n) end
print(line)
print(string.format("avg on-screen void share (camera on a floor cell) %.1f%%  (view %.0f x %.1f ground tiles)", 100 * screenVoid / screenSamples, halfW * 2, halfD * 2))
local tot = 0
for k = 1, 10 do tot += screenHist[k] or 0 end
local l2 = "on-screen void by distance (share of on-screen void):"
for k = 1, 10 do l2 ..= string.format(" %s=%.1f%%", k == 10 and "offgrid" or (k == 9 and "d9+" or "d" .. k), 100 * (screenHist[k] or 0) / tot) end
print(l2)
print(string.format("greedy rects per floor: shoulder d1-2 %.0f, d1-3 %.0f, mid d4-8 %.0f", rects.s2 / agg.n, rects.s3 / agg.n, rects.mid / agg.n))
print(string.format("shoulder cells d1-3 %.0f; footprint-legal at wall top: column (20x55) %.0f, stump (19x22) %.0f", legal.tallCand / agg.n, legal.tall / agg.n, legal.low / agg.n))
