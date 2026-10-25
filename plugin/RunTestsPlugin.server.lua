--[[
	Studio test runner for Kaleb-Vale (Roblox port).

	Runs every *.spec module under ReplicatedStorage.TS (src/shared) with @rbxts/jest, inside
	Studio. Use it for specs that need real engine behavior; pure specs run headlessly with
	`npm test` (Lune), which is the gate agents rely on.

	This must be a local plugin: @rbxts/jest loads test modules with debug.loadmodule, which
	needs the PluginOrOpenCloud capability (a normal Script or LocalScript cannot run it).

	Install: npm run test:plugin
	  (rojo build test-runner.project.json -o "$HOME/Documents/Roblox/Plugins/KalebValeTestRunner.rbxm")
	Then restart Studio, sync the place with `rojo serve`, and click "Run Tests".
	Under roblox-cli (`--load.model`, no `plugin` global) it starts by itself and prints one
	`[Jest] KV_JEST_RESULT=PASS|FAIL` line.
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

if not RunService:IsStudio() then
	return
end

_G.__ROACT_17_MOCK_SCHEDULER__ = true
_G.__DEV__ = true

local isHeadless = plugin == nil

local runButton = nil
if not isHeadless then
	local toolbar = plugin:CreateToolbar("Kaleb-Vale Tests")
	runButton = toolbar:CreateButton("Run Tests", "Run the @rbxts/jest suite (src/shared specs)", "rbxassetid://4458901886")
end

local isRunning = false

local function setButtonEnabled(enabled)
	if runButton then
		runButton.Enabled = enabled
	end
end

local function finish(succeeded)
	_G.KV_JEST_SUCCESS = succeeded == true
	print("[Jest] KV_JEST_RESULT=" .. (if succeeded then "PASS" else "FAIL"))
	isRunning = false
	setButtonEnabled(true)
end

-- RuntimeLib marks every module it imports with _G[module] = TS. Jest's sandbox brings its own
-- RuntimeLib, which then refuses those modules ("Invalid module access"), so clear the marks.
local function clearOwnershipMarkers(root)
	for _, desc in ipairs(root:GetDescendants()) do
		if desc:IsA("ModuleScript") then
			_G[desc] = nil
		end
	end
end

local function runTests()
	if isRunning then
		warn("[Jest] Tests already running, please wait...")
		return
	end
	isRunning = true
	setButtonEnabled(false)

	task.spawn(function()
		local ok, err = pcall(function()
			local include = ReplicatedStorage:WaitForChild("rbxts_include", 10)
			local sharedTS = ReplicatedStorage:WaitForChild("TS", 10)
			if not include or not sharedTS then
				error("ReplicatedStorage.rbxts_include / ReplicatedStorage.TS missing: is Rojo syncing?")
			end

			local TS = require(include:WaitForChild("RuntimeLib"))
			local runCLI = TS.import(script, ReplicatedStorage, "rbxts_include", "node_modules", "@rbxts", "jest", "src").runCLI

			local original = sharedTS:FindFirstChild("jestConfig")
			if not original then
				error("ReplicatedStorage.TS.jestConfig missing: run `npm run build`")
			end
			local existing = sharedTS:FindFirstChild("jest.config")
			if existing then
				existing:Destroy()
			end
			local config = original:Clone()
			config.Name = "jest.config"
			config.Parent = sharedTS

			clearOwnershipMarkers(include)
			clearOwnershipMarkers(sharedTS)

			print("[Jest] Starting test run...")
			local status = runCLI(sharedTS, { verbose = true, ci = isHeadless }, { sharedTS }):expect()
			return status.results.success == true
		end)
		if not ok then
			warn("[Jest] " .. tostring(err))
			finish(false)
		else
			print("[Jest] Test run finished: " .. (if err then "SUCCESS" else "FAILED"))
			finish(err)
		end
	end)
end

if isHeadless then
	runTests()
else
	runButton.Click:Connect(runTests)
	print("[Jest Plugin] Kaleb-Vale test runner loaded. Click 'Run Tests' in the toolbar.")
end
