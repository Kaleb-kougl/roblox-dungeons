--!nonstrict
--[[
	Real Jest, minus the parts that need Roblox Studio.

	Studio runs specs through `@rbxts/jest`'s runCLI, which needs `debug.loadmodule` (plugin
	capability) to sandbox modules. Lune has no such thing, so instead of jest-core / jest-runtime
	this file wires the two packages that hold Jest's actual semantics straight into a realm:

	  JestCircus  describe / it / test / hooks / .each / .only / .skip / .todo, and the run loop
	  Expect      every matcher, asymmetric matchers, `.never`, `expect.assertions(n)`
	  JestMock    `jest.fn()` / `jest.spyOn()` (the subset of the `jest` object that is pure Luau)

	These are the same Luau modules the Studio runner executes, so a spec that passes here runs
	the identical matcher code in Studio. The adapter below mirrors jestAdapterInit's event
	handler (current test name, suppressed errors, expected-assertion counts).

	Not available headlessly: snapshots (`toMatchSnapshot`), fake timers (`jest.useFakeTimers`),
	module mocking (`jest.mock`), and anything touching real Instances.
]]

local JestRuntime = {}

local function testId(test): string
	local names = {}
	local parent = test.parent
	while parent ~= nil and parent.parent ~= nil do -- skip ROOT_DESCRIBE_BLOCK
		table.insert(names, 1, parent.name)
		parent = parent.parent
	end
	table.insert(names, test.name)
	return table.concat(names, " ")
end

--[[
	Loads Jest into `realm` and points every `@rbxts/jest-globals` import at it.
	Returns a `run()` function that executes the tests the spec registered.
]]
function JestRuntime.install(realm, game)
	local packages = game:GetService("ReplicatedStorage").rbxts_include.node_modules
	local js = packages["@rbxts-js"]

	local expect = realm:require(js.Expect)
	local circus = realm:require(js.JestCircus)
	local circusState = realm:require(js.JestCircus.circus.state)
	local Promise = realm:require(js.Promise)

	local jestObject = {}
	local okMock, mockModule = pcall(function()
		return realm:require(js.JestMock)
	end)
	if okMock and mockModule.ModuleMocker then
		local mocker = mockModule.ModuleMocker.new()
		jestObject.fn = function(implementation)
			return mocker:fn(implementation)
		end
		jestObject.spyOn = function(object, methodName)
			return mocker:spyOn(object, methodName)
		end
		jestObject.isMockFunction = function(fn)
			return mocker:isMockFunction(fn)
		end
		jestObject.clearAllMocks = function()
			mocker:clearAllMocks()
		end
		jestObject.resetAllMocks = function()
			mocker:resetAllMocks()
		end
		jestObject.restoreAllMocks = function()
			mocker:restoreAllMocks()
		end
	end
	setmetatable(jestObject, {
		__index = function(_, key)
			error(string.format("[harness] jest.%s is not available in the headless runner (Studio only)", key), 2)
		end,
	})

	circusState.addEventHandler(function(_self, event)
		return Promise.resolve():andThen(function()
			if event.name == "test_start" then
				expect.setState({ currentTestName = testId(event.test) })
			elseif event.name == "test_done" then
				local suppressed = expect.getState().suppressedErrors
				expect.setState({ suppressedErrors = {} })
				if suppressed and #suppressed > 0 then
					for _, err in suppressed do
						table.insert(event.test.errors, err)
					end
				end
				for _, failure in expect.extractExpectedAssertionsErrors() do
					table.insert(event.test.errors, failure.error)
				end
			end
		end)
	end)

	local describe = circus.describe
	local it = circus.it
	local globals = table.freeze({
		describe = describe,
		fdescribe = describe.only,
		xdescribe = describe.skip,
		it = it,
		fit = it.only,
		xit = it.skip,
		test = circus.test,
		xtest = circus.test.skip,
		beforeAll = circus.beforeAll,
		beforeEach = circus.beforeEach,
		afterAll = circus.afterAll,
		afterEach = circus.afterEach,
		expect = expect,
		jest = jestObject,
	})

	-- `import { describe } from "@rbxts/jest-globals"` compiles to an import of this module.
	realm.overrides[packages["@rbxts"]["jest-globals"].src] = globals
	realm.overrides[js.JestGlobals] = globals

	return function()
		return circus.run():expect()
	end
end

return JestRuntime
