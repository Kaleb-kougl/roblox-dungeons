--!nonstrict
--[[
	Data dump for pure-move refactors (docs/CODEBASE_SCALE.md DX7).

	  lune run scripts/lune/dump-lists.luau [--out <path>] [module ...]

	NEEDS A BUILD FIRST (`npm run build`). Requires compiled modules under out/shared through the fake DataModel the
	headless spec runner uses (scripts/lune/lib) and writes every value they export as JSON (default
	build/lists.json, gitignored): arrays in their own order, object keys sorted, functions as "<function>", anything
	met twice on one path as "<cycle>". Then the validator's verdict on every bundled pack (`validateManifest`), so a
	split of validate.ts is held to the same problems, word for word.

	Use: dump before a refactor that must not change any list, dump after, and compare the two files byte for byte:

	  lune run scripts/lune/dump-lists.luau --out build/lists.before.json
	  ... move code, npm run build ...
	  lune run scripts/lune/dump-lists.luau --out build/lists.after.json
	  cmp build/lists.before.json build/lists.after.json

	Default modules: the theme barrel (every list of the contract, the packs, the validator's exports) and the view's
	sprites module. Name others by their path under out/shared (`view/audio/cues`, `sim/combat/actors`).
]]

local fs = require("@lune/fs")
local process = require("@lune/process")
local serde = require("@lune/serde")

local RojoTree = require("./lib/rojoTree")
local Realm = require("./lib/realm")
local Services = require("./lib/services")

local DEFAULT_MODULES = { "theme", "view/sprites" }
local MAX_DEPTH = 40

local outPath = "build/lists.json"
local modules: { string } = {}
do
	local i = 1
	local a = process.args
	while i <= #a do
		if a[i] == "--out" and a[i + 1] ~= nil then
			outPath = a[i + 1]
			i += 2
		elseif string.sub(a[i], 1, 2) == "--" then
			error("unknown argument " .. a[i] .. " (usage: dump-lists.luau [--out <path>] [module ...])", 0)
		else
			table.insert(modules, a[i])
			i += 1
		end
	end
end
if #modules == 0 then
	modules = DEFAULT_MODULES
end

if not fs.isDir("out/shared") then
	io.stderr:write("out/shared does not exist. Run `npm run build` first.\n")
	process.exit(1)
end

local game = Services.install(RojoTree.build("default.project.json"))
local TS = game:GetService("ReplicatedStorage"):FindFirstChild("TS")
local realm = Realm.new(game)

local function requireShared(path: string)
	local inst = TS
	for name in string.gmatch(path, "[^/]+") do
		inst = inst:FindFirstChild(name)
		assert(inst, "out/shared/" .. path .. " missing (stale build?)")
	end
	return realm:require(inst)
end

local function isArray(t: { [any]: any }): boolean
	local n = #t
	if n == 0 then
		return false
	end
	local count = 0
	for _ in t do
		count += 1
	end
	return count == n
end

local function keyText(k: any): string
	return if type(k) == "string" then k else "[" .. tostring(k) .. "]"
end

-- JSON text of `value`: arrays in order, object keys sorted (as text), no whitespace choices left to a library.
local function encode(value: any, indent: string, seen: { [any]: boolean }, depth: number): string
	local t = type(value)
	if t == "string" or t == "boolean" then
		return serde.encode("json", value)
	elseif t == "number" then
		if value ~= value then
			return '"<nan>"'
		elseif value == math.huge or value == -math.huge then
			return if value > 0 then '"<inf>"' else '"<-inf>"'
		end
		return string.format("%.17g", value)
	elseif t == "nil" then
		return "null"
	elseif t ~= "table" then
		return '"<' .. t .. '>"'
	end
	if seen[value] or depth > MAX_DEPTH then
		return '"<cycle>"'
	end
	if next(value) == nil then
		return "[]"
	end
	seen[value] = true
	local inner = indent .. "\t"
	local parts = {}
	local text
	if isArray(value) then
		for _, v in ipairs(value) do
			table.insert(parts, inner .. encode(v, inner, seen, depth + 1))
		end
		text = "[\n" .. table.concat(parts, ",\n") .. "\n" .. indent .. "]"
	else
		local keys = {}
		for k in value do
			table.insert(keys, k)
		end
		table.sort(keys, function(a, b)
			return keyText(a) < keyText(b)
		end)
		for _, k in keys do
			table.insert(parts, inner .. serde.encode("json", keyText(k)) .. ": " .. encode(value[k], inner, seen, depth + 1))
		end
		text = "{\n" .. table.concat(parts, ",\n") .. "\n" .. indent .. "}"
	end
	seen[value] = nil
	return text
end

local out = {}
local exported = 0
for _, path in modules do
	local m = requireShared(path)
	assert(type(m) == "table", "out/shared/" .. path .. " does not return a table")
	for _ in m do
		exported += 1
	end
	out[path] = m
end

-- The validator's verdict on every bundled pack, when the theme barrel is among the modules.
local verdicts = {}
local theme = out["theme"]
if theme ~= nil and type(theme.validateManifest) == "function" and type(theme.THEME_PACKS) == "table" then
	for id, manifest in theme.THEME_PACKS do
		local problems = theme.validateManifest(manifest)
		local lines = {}
		for _, p in problems do
			table.insert(lines, if type(p) == "table" then p else tostring(p))
		end
		verdicts[id] = { count = #lines, problems = lines }
	end
end

local text = "{\n\t"
	.. serde.encode("json", "modules")
	.. ": "
	.. encode(out, "\t", {}, 0)
	.. ",\n\t"
	.. serde.encode("json", "validateManifest")
	.. ": "
	.. encode(verdicts, "\t", {}, 0)
	.. "\n}\n"

local dir = string.match(outPath, "^(.*)/[^/]+$")
if dir ~= nil and not fs.isDir(dir) then
	fs.writeDir(dir)
end
fs.writeFile(outPath, text)
print(string.format("dump-lists: %d exports of %d module(s), %d bytes -> %s", exported, #modules, #text, outPath))
