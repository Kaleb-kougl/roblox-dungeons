--!nonstrict
--[[
	English string dump for the cloud localization pipeline (docs/LOCALIZATION.md design 4, task L10).

	  npm run l10n:dump        (= lune run scripts/l10n/dump-strings.luau [--out <path>])

	NEEDS A BUILD FIRST (`npm run build`): it requires the compiled modules under out/shared through the same fake
	DataModel the headless spec runner uses (scripts/lune/lib), so the strings are exactly what the game shows, not a
	re-parse of the TypeScript source. `npm run l10n:export` runs it for you (but not the build).

	Writes l10n/build/source.json (gitignored):
	  {
	    "strings":         { "<key>": "<English>" },   -- the placeholder pack's string table; vale inherits it
	    "srcHashes":       { "<key>": <n> },           -- shared/l10n sourceHash of each English string (the game's
	                                                     own hash, so the node scripts can check theirs agrees)
	    "devOnlyPrefixes": [ ... ],                    -- shared/l10n DEV_ONLY_STRING_PREFIXES (never exported)
	    "locales":         [ { "code", "roblox", "script", "pseudo" } ]   -- shared/l10n LOCALES, in order
	  }
	Object keys are written sorted, so the file is stable between runs.
]]

local fs = require("@lune/fs")
local process = require("@lune/process")
local serde = require("@lune/serde")

local RojoTree = require("../lune/lib/rojoTree")
local Realm = require("../lune/lib/realm")
local Services = require("../lune/lib/services")

local outPath = "l10n/build/source.json"
do
	local i = 1
	local a = process.args
	while i <= #a do
		if a[i] == "--out" and a[i + 1] ~= nil then
			outPath = a[i + 1]
			i += 2
		else
			error("unknown argument " .. tostring(a[i]) .. " (usage: dump-strings.luau [--out <path>])", 0)
		end
	end
end

if not fs.isDir("out/shared") then
	io.stderr:write("out/shared does not exist. Run `npm run build` first.\n")
	process.exit(1)
end

local game = Services.install(RojoTree.build("default.project.json"))
local TS = game:GetService("ReplicatedStorage"):FindFirstChild("TS")
local realm = Realm.new(game)
local function child(path: { string })
	local inst = TS
	for _, name in path do
		inst = inst:FindFirstChild(name)
		assert(inst, "out/shared/" .. table.concat(path, "/") .. " missing (stale build?)")
	end
	return inst
end

local l10n = realm:require(child({ "l10n" }))
local placeholder = realm:require(child({ "theme", "packs", "placeholder" }))
local strings = placeholder.PLACEHOLDER_MANIFEST.strings
assert(type(strings) == "table", "PLACEHOLDER_MANIFEST.strings is not a table")

-- JSON with sorted object keys (serde only escapes the scalars).
local function encode(value: any, indent: string): string
	local t = type(value)
	if t == "string" or t == "number" or t == "boolean" then
		return serde.encode("json", value)
	end
	assert(t == "table", "cannot encode a " .. t)
	local inner = indent .. "\t"
	if #value > 0 or next(value) == nil and getmetatable(value) == "array" then
		local parts = {}
		for _, v in ipairs(value) do
			table.insert(parts, inner .. encode(v, inner))
		end
		return "[\n" .. table.concat(parts, ",\n") .. "\n" .. indent .. "]"
	end
	local keys = {}
	for k in value do
		table.insert(keys, k)
	end
	if #keys == 0 then
		return "{}"
	end
	table.sort(keys)
	local parts = {}
	for _, k in keys do
		table.insert(parts, inner .. serde.encode("json", k) .. ": " .. encode(value[k], inner))
	end
	return "{\n" .. table.concat(parts, ",\n") .. "\n" .. indent .. "}"
end

local function array(list: { any }): { any }
	return setmetatable(list, { __metatable = "array" }) :: any
end

local outStrings, hashes, count = {}, {}, 0
for key, text in strings do
	assert(type(key) == "string" and type(text) == "string", "non-string entry in the string table: " .. tostring(key))
	outStrings[key] = text
	hashes[key] = l10n.sourceHash(text)
	count += 1
end

local prefixes = {}
for _, p in l10n.DEV_ONLY_STRING_PREFIXES do
	table.insert(prefixes, p)
end

local locales = {}
for _, def in l10n.LOCALES do
	local ids = {}
	for _, id in def.roblox do
		table.insert(ids, id)
	end
	table.insert(locales, {
		code = def.code,
		roblox = array(ids),
		script = def.script,
		pseudo = def.pseudo == true,
	})
end

local doc = {
	strings = outStrings,
	srcHashes = hashes,
	devOnlyPrefixes = array(prefixes),
	locales = array(locales),
}

local dir = string.match(outPath, "^(.*)/[^/]*$")
if dir ~= nil and dir ~= "" and not fs.isDir(dir) then
	fs.writeDir(dir)
end
fs.writeFile(outPath, encode(doc, "") .. "\n")
print(string.format("l10n:dump: %d strings, %d locales -> %s", count, #locales, outPath))
