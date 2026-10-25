--!nonstrict
--[[
	A realm is one isolated Roblox-like module world: its own `_G`, its own module cache and its
	own copy of RuntimeLib. Every spec file runs in a fresh realm (like Jest's per-file module
	registry), so module-level state never leaks between spec files.

	`realm:require(moduleScript)` is the harness's `require`: it compiles the file behind the fake
	ModuleScript with `@lune/luau`, runs it with a Roblox-shaped environment whose `script` is
	that ModuleScript, and caches the single return value. Compiled bytecode is shared across
	realms, so only the first realm pays for compilation.

	Determinism guard: modules compiled from `src/shared/sim/**` and `src/shared/dungeon/**`
	(spec files excepted) get a
	stricter environment: no Roblox datatypes, no Instance/Enum/workspace, `game` only resolves
	ReplicatedStorage (needed for roblox-ts's own import line), and the clock / RNG entry points
	(`tick`, `time`, `os.clock`, `os.time`, `os.date`, `math.random`, `math.randomseed`) raise.
	That is CLAUDE.md's "sim is deterministic and Roblox-API-free" rule, enforced headlessly.
]]

local fs = require("@lune/fs")
local luau = require("@lune/luau")
local serde = require("@lune/serde")
local stdio = require("@lune/stdio")
local task = require("@lune/task")
local roblox = require("@lune/roblox")

local Instance = require("./Instance")

local Realm = {}
Realm.__index = Realm

local bytecodeCache: { [string]: buffer | string } = {}

local function compile(path: string): string
	local cached = bytecodeCache[path]
	if cached == nil then
		local source = fs.readFile(path)
		local ok, result = pcall(luau.compile, source, { optimizationLevel = 1, debugLevel = 2 })
		if not ok then
			error(string.format("[harness] failed to compile %s:\n%s", path, tostring(result)), 0)
		end
		cached = result
		bytecodeCache[path] = cached
	end
	return cached :: any
end

local function harnessTypeof(value: any): string
	if Instance.is(value) then
		return "Instance"
	end
	return typeof(value)
end

local function warnFn(...)
	local parts = table.pack(...)
	for i = 1, parts.n do
		parts[i] = tostring(parts[i])
	end
	stdio.ewrite(stdio.color("yellow") .. table.concat(parts, " ") .. stdio.color("reset") .. "\n")
end

local function forbidden(name: string)
	return function()
		error(
			string.format(
				"[determinism] %s is not allowed in src/shared/sim (see CLAUDE.md: the sim is deterministic and Roblox-API-free)",
				name
			),
			2
		)
	end
end

local function makeSimGame(game)
	-- Only the import line roblox-ts emits (`game:GetService("ReplicatedStorage")`) may touch `game`.
	local proxy = {}
	function proxy.GetService(_self, name: string)
		if name ~= "ReplicatedStorage" then
			error(
				string.format(
					"[determinism] game:GetService(%q) from src/shared/sim: the sim may not use Roblox services",
					name
				),
				2
			)
		end
		return game:GetService(name)
	end
	return setmetatable(proxy, {
		__index = function(_, key)
			error(string.format("[determinism] game.%s from src/shared/sim: the sim may not use Roblox APIs", key), 2)
		end,
	})
end

local function baseGlobals(): { [string]: any }
	return {
		assert = assert,
		error = error,
		getmetatable = getmetatable,
		setmetatable = setmetatable,
		ipairs = ipairs,
		pairs = pairs,
		next = next,
		pcall = pcall,
		xpcall = xpcall,
		print = print,
		warn = warnFn,
		rawequal = rawequal,
		rawget = rawget,
		rawset = rawset,
		rawlen = rawlen,
		select = select,
		tonumber = tonumber,
		tostring = tostring,
		type = type,
		typeof = harnessTypeof,
		unpack = unpack,
		newproxy = newproxy,
		gcinfo = gcinfo,
		math = math,
		string = string,
		table = table,
		coroutine = coroutine,
		bit32 = bit32,
		utf8 = utf8,
		buffer = buffer,
		debug = debug,
		os = os,
		task = task,
	}
end

local ROBLOX_DATATYPES = {
	"Axes",
	"BrickColor",
	"CFrame",
	"Color3",
	"ColorSequence",
	"ColorSequenceKeypoint",
	"Enum",
	"Faces",
	"NumberRange",
	"NumberSequence",
	"NumberSequenceKeypoint",
	"Ray",
	"Rect",
	"Region3",
	"UDim",
	"UDim2",
	"Vector2",
	"Vector2int16",
	"Vector3",
	"Vector3int16",
}

local startClock = os.clock()

function Realm.new(game, overrides: { [any]: any }?)
	local self = setmetatable({}, Realm)
	self.game = game
	self.overrides = overrides or {}
	self.cache = {}
	self.loading = {}
	self.G = {}

	local globals = baseGlobals()
	globals._G = self.G
	globals.game = game
	globals.workspace = game:GetService("Workspace")
	globals.tick = os.clock
	globals.time = function()
		return os.clock() - startClock
	end
	globals.require = function(target)
		return self:require(target)
	end
	for _, name in ROBLOX_DATATYPES do
		globals[name] = roblox[name]
	end
	-- Monotonic stand-in for Roblox's DateTime (jest-circus times tests with DateTime.now()).
	local epochMillis = os.time() * 1000
	globals.DateTime = table.freeze({
		now = function()
			local millis = epochMillis + math.floor((os.clock() - startClock) * 1000)
			return table.freeze({ UnixTimestampMillis = millis, UnixTimestamp = millis // 1000 })
		end,
	})
	-- Detached harness Instances (jest's RobloxShared probes `Instance.new("ModuleScript")`).
	globals.Instance = table.freeze({
		new = function(className: string, parent: any?)
			return Instance.new(className, className, parent)
		end,
	})
	self.globals = globals

	-- the restricted environment for src/shared/sim
	local simGlobals = baseGlobals()
	simGlobals._G = self.G
	simGlobals.game = makeSimGame(game)
	simGlobals.require = globals.require
	-- Roblox globals resolve to a value that errors with the reason on any use.
	local robloxGlobals = { "Instance", "workspace", "DateTime" }
	table.move(ROBLOX_DATATYPES, 1, #ROBLOX_DATATYPES, #robloxGlobals + 1, robloxGlobals)
	for _, name in robloxGlobals do
		local fail = forbidden(name)
		simGlobals[name] = setmetatable({}, { __index = fail, __call = fail })
	end
	simGlobals.tick = forbidden("tick()")
	simGlobals.time = forbidden("time()")
	local simMath = table.clone(math)
	simMath.random = forbidden("math.random")
	simMath.randomseed = forbidden("math.randomseed")
	simGlobals.math = table.freeze(simMath)
	simGlobals.os = table.freeze({
		clock = forbidden("os.clock"),
		time = forbidden("os.time"),
		date = forbidden("os.date"),
	})
	self.simGlobals = simGlobals
	return self
end

-- Compiled output of the deterministic folders (CLAUDE.md): they get the restricted environment.
local DETERMINISTIC_ROOTS = { "/out/shared/sim/", "/out/shared/dungeon/" }

local function isSimModule(path: string): boolean
	if string.match(path, "%.spec%.luau?$") then
		return false
	end
	for _, root in DETERMINISTIC_ROOTS do
		if string.find(path, root, 1, true) then
			return true
		end
	end
	return false
end

function Realm:require(target)
	if not Instance.is(target) then
		error("[harness] require() expects a ModuleScript instance, got " .. typeof(target), 2)
	end
	local override = self.overrides[target]
	if override ~= nil then
		return override
	end
	local cached = self.cache[target]
	if cached ~= nil then
		return cached.value
	end
	local m = Instance.meta(target)
	if m.className ~= "ModuleScript" then
		error("[harness] require() of a non-ModuleScript: " .. target:GetFullName(), 2)
	end
	if self.loading[target] then
		error("[harness] Recursive require detected: " .. target:GetFullName(), 2)
	end
	local path = m.path
	assert(path, "[harness] ModuleScript without a backing file: " .. target:GetFullName())

	local value
	if m.kind == "json" then
		value = serde.decode("json", fs.readFile(path))
	else
		self.loading[target] = true
		local env = table.clone(if isSimModule(path) then self.simGlobals else self.globals)
		env.script = target
		local fn = luau.load(compile(path), {
			debugName = target:GetFullName(),
			environment = env,
			injectGlobals = false,
		})
		local results = table.pack(fn())
		self.loading[target] = nil
		-- Roblox's require insists on exactly one value. Spec modules are exempt: Jest loads them
		-- with debug.loadmodule, and roblox-ts emits no `return` for a file without exports.
		local isSpec = string.match(path, "%.spec%.luau?$") ~= nil
		if results.n ~= 1 and not (isSpec and results.n == 0) then
			error(
				string.format(
					"[harness] Module code did not return exactly one value (%d): %s",
					results.n,
					target:GetFullName()
				),
				2
			)
		end
		value = results[1]
	end
	self.cache[target] = { value = value }
	return value
end

return Realm
