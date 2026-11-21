--!nonstrict
--[[
	Headless spec runner: runs every compiled `*.spec` module under ReplicatedStorage.TS
	(`out/shared/**`) with real JestCircus + Expect, inside Lune. No Roblox Studio needed.

	  lune run scripts/lune/run-tests.luau [filter ...] [--project default.project.json] [--census] [--flag name ...]
	                                       [--shard i/n] [--list]

	`npm test` builds first (gen fixtures -> rbxtsc) and then runs this. A filter keeps the spec
	files whose source path contains it (e.g. `sim/rng`). Exit code is 1 when any test or suite
	fails, or when no spec matched. `--census` sets the Workspace attribute `KV_Census` (true), which
	opt-in census specs read (shared/run/testing censusRequested) to run their full sample instead of
	the small default one (docs/ARCHER.md AR13). `--flag name` (repeatable) turns on an opt-in spec
	switch: every spec realm gets `_G.KV_SPEC_FLAGS[name] = true` (absent in Studio and without the flag).
	`--shard i/n` (1 <= i <= n) keeps the spec files whose source path hashes into shard i of n (FNV-1a of the
	path, so adding a spec never moves another one; docs/CI.md): CI runs one shard per job, and the same flag
	reproduces a shard locally. `--list` prints the spec files that would run, one per line, and exits.

	How it works (details in the lib/ headers):
	  1. lib/rojoTree   builds a fake DataModel from default.project.json, mirroring the filesystem
	                    the way Rojo would (so roblox-ts's `TS.import(script, ...)` paths resolve)
	  2. lib/realm      a fresh module world per spec file: own _G, own module cache, own RuntimeLib
	  3. lib/jestRuntime loads JestCircus + Expect into the realm and redirects
	                    `@rbxts/jest-globals` to them
	  4. the spec module is required (registers its tests), then circus runs them
]]

local fs = require("@lune/fs")
local process = require("@lune/process")
local stdio = require("@lune/stdio")

local Instance = require("./lib/Instance")
local JestRuntime = require("./lib/jestRuntime")
local Realm = require("./lib/realm")
local RojoTree = require("./lib/rojoTree")
local Services = require("./lib/services")

local MAX_ERROR_CHARS = 6000

local function color(name: string, text: string): string
	return stdio.color(name :: any) .. text .. stdio.color("reset")
end

local function bold(text: string): string
	return stdio.style("bold") .. text .. stdio.style("reset")
end

-- args
local projectPath = "default.project.json"
local filters: { string } = {}
local census = false
local specFlags: { [string]: boolean } = {}
local shardIndex, shardCount = 1, 1
local listOnly = false
do
	local i = 1
	local args = process.args
	while i <= #args do
		local arg = args[i]
		if arg == "--project" or arg == "--flag" then
			local value = args[i + 1]
			if value == nil or string.sub(value, 1, 2) == "--" then
				stdio.ewrite(arg .. " needs a value (e.g. " .. arg .. " name)\n")
				process.exit(2)
			end
			if arg == "--project" then
				projectPath = value
			else
				specFlags[value] = true
			end
			i += 2
		elseif arg == "--census" then
			census = true
			i += 1
		elseif arg == "--list" then
			listOnly = true
			i += 1
		elseif arg == "--shard" then
			local a, b = string.match(args[i + 1] or "", "^(%d+)/(%d+)$")
			shardIndex, shardCount = tonumber(a) or 0, tonumber(b) or 0
			if shardCount < 1 or shardIndex < 1 or shardIndex > shardCount then
				stdio.ewrite("--shard needs i/n with 1 <= i <= n (e.g. --shard 2/8)\n")
				process.exit(2)
			end
			i += 2
		else
			table.insert(filters, arg)
			i += 1
		end
	end
end

-- ./out/shared/sim/foo.spec.luau -> src/shared/sim/foo.spec.ts (what a human wants to open)
local function sourcePath(compiledPath: string): string
	local rel = string.gsub(compiledPath, "^%./", "")
	local src = string.gsub(string.gsub(rel, "^out/", "src/"), "%.luau$", "")
	if fs.isFile(src .. ".ts") then
		return src .. ".ts"
	elseif fs.isFile(src .. ".tsx") then
		return src .. ".tsx"
	end
	return rel
end

local function matchesFilters(path: string): boolean
	if #filters == 0 then
		return true
	end
	for _, filter in filters do
		if string.find(path, filter, 1, true) then
			return true
		end
	end
	return false
end

-- 32-bit FNV-1a of the source path: a spec's shard depends on its own path only.
local function pathHash(path: string): number
	local h = 0x811c9dc5
	for i = 1, #path do
		h = bit32.bxor(h, string.byte(path, i))
		-- h * 0x01000193 mod 2^32, split so every product stays exact in a double
		h = (bit32.band(h, 0xffff) * 0x01000193 + bit32.lshift(bit32.band(bit32.rshift(h, 16) * 0x0193, 0xffff), 16)) % 0x100000000
	end
	return h
end

local function inShard(path: string): boolean
	return shardCount == 1 or pathHash(path) % shardCount == shardIndex - 1
end

local function formatError(err: any): string
	local text = tostring(err)
	if type(err) == "table" and err.message ~= nil then
		text = tostring(err.message)
		if err.stack ~= nil then
			text ..= "\n" .. tostring(err.stack)
		end
	end
	if #text > MAX_ERROR_CHARS then
		text = string.sub(text, 1, MAX_ERROR_CHARS) .. "\n... (truncated)"
	end
	return text
end

local function indent(text: string, prefix: string): string
	return prefix .. string.gsub(text, "\n", "\n" .. prefix)
end

-- discover
if not fs.isDir("out/shared") then
	stdio.ewrite(color("red", "out/shared does not exist. Run `npm run build` (or `npm test`) first.\n"))
	process.exit(1)
end

local game = Services.install(RojoTree.build(projectPath))
if census then
	Instance.meta(game:GetService("Workspace")).attributes = { KV_Census = true }
end
local sharedRoot = game:GetService("ReplicatedStorage"):FindFirstChild("TS")
assert(sharedRoot, "ReplicatedStorage.TS missing from " .. projectPath)

local specs = {}
for _, inst in sharedRoot:GetDescendants() do
	if inst.ClassName == "ModuleScript" and string.match(inst.Name, "%.spec$") then
		local path = sourcePath(Instance.meta(inst).path)
		if matchesFilters(path) and inShard(path) then
			table.insert(specs, { inst = inst, path = path })
		end
	end
end
table.sort(specs, function(a, b)
	return a.path < b.path
end)

if listOnly then
	for _, spec in specs do
		stdio.write(spec.path .. "\n")
	end
	process.exit(0)
end

if #specs == 0 then
	stdio.ewrite(color("red", "No spec files found under out/shared" .. (#filters > 0 and " matching the filters" or "") .. ".\n"))
	process.exit(1)
end

-- run
local totals = { suitesPassed = 0, suitesFailed = 0, passed = 0, failed = 0, skipped = 0, todo = 0 }
local failureReports: { string } = {}
local startedAt = os.clock()

for _, spec in specs do
	local suiteStart = os.clock()
	local realm = Realm.new(game)
	realm.G.KV_SPEC_FLAGS = table.freeze(table.clone(specFlags))
	local lines: { string } = {}
	local suiteFailed = false

	local ok, result = pcall(function()
		local run = JestRuntime.install(realm, game)
		realm:require(spec.inst)
		return run()
	end)

	if not ok then
		suiteFailed = true
		table.insert(failureReports, bold(color("red", "● " .. spec.path .. " (suite failed to run)")) .. "\n\n" .. indent(formatError(result), "    "))
	else
		for _, test in result.testResults do
			local nameParts = table.clone(test.testPath)
			table.remove(nameParts, 1) -- ROOT_DESCRIBE_BLOCK
			local name = table.concat(nameParts, " › ")
			if test.status == "skip" then
				totals.skipped += 1
				table.insert(lines, color("yellow", "  ○ skipped " .. name))
			elseif test.status == "todo" then
				totals.todo += 1
				table.insert(lines, color("purple", "  ✎ todo " .. name))
			elseif #test.errors == 0 then
				totals.passed += 1
				table.insert(lines, color("green", "  ✓ ") .. name .. color("blue", string.format(" (%d ms)", test.duration or 0)))
			else
				totals.failed += 1
				suiteFailed = true
				table.insert(lines, color("red", "  ✕ " .. name))
				local messages = {}
				for _, err in test.errors do
					table.insert(messages, indent(formatError(err), "    "))
				end
				table.insert(failureReports, bold(color("red", "● " .. spec.path .. " › " .. name)) .. "\n\n" .. table.concat(messages, "\n\n"))
			end
		end
		for _, err in result.unhandledErrors do
			suiteFailed = true
			table.insert(failureReports, bold(color("red", "● " .. spec.path .. " (unhandled error)")) .. "\n\n" .. indent(formatError(err), "    "))
		end
	end

	local elapsed = math.floor((os.clock() - suiteStart) * 1000)
	local badge = if suiteFailed then stdio.style("bold") .. color("red", " FAIL ") else stdio.style("bold") .. color("green", " PASS ")
	print(string.format("%s %s %s", badge, spec.path, color("blue", string.format("(%d ms)", elapsed))))
	for _, line in lines do
		print(line)
	end
	if suiteFailed then
		totals.suitesFailed += 1
	else
		totals.suitesPassed += 1
	end
end

if #failureReports > 0 then
	print("\n" .. bold("Failures:") .. "\n")
	for _, report in failureReports do
		print(report .. "\n")
	end
end

local function part(n: number, label: string, colorName: string): string?
	if n == 0 then
		return nil
	end
	return color(colorName, string.format("%d %s", n, label))
end

local function summary(items: { string? }, total: number): string
	local out = {}
	for _, item in items do
		if item then
			table.insert(out, item)
		end
	end
	table.insert(out, string.format("%d total", total))
	return table.concat(out, ", ")
end

local testTotal = totals.passed + totals.failed + totals.skipped + totals.todo
print(bold("Test Suites: ") .. summary({
	part(totals.suitesFailed, "failed", "red"),
	part(totals.suitesPassed, "passed", "green"),
}, #specs))
print(bold("Tests:       ") .. summary({
	part(totals.failed, "failed", "red"),
	part(totals.skipped, "skipped", "yellow"),
	part(totals.todo, "todo", "purple"),
	part(totals.passed, "passed", "green"),
}, testTotal))
print(bold("Time:        ") .. string.format("%.2f s (Lune, headless)", os.clock() - startedAt))

process.exit(if totals.suitesFailed > 0 then 1 else 0)
