--!nonstrict
--[[
	Turns the DataModel built from default.project.json into something `game:GetService` works on,
	and stubs the services RuntimeLib / Promise touch at load time. The test environment behaves
	like an edit-mode Studio session: not running, not client, not server.
]]

local serde = require("@lune/serde")

local Instance = require("./Instance")

local Services = {}

local function signal()
	local s = {}
	function s.Connect(_self, _fn)
		return {
			Connected = true,
			Disconnect = function(conn)
				conn.Connected = false
			end,
		}
	end
	s.Once = s.Connect
	function s.Wait(_self)
		error("[harness] Signal:Wait() would yield forever headlessly", 2)
	end
	return s
end

local SERVICE_PROPS = {
	RunService = function()
		return {
			Heartbeat = signal(),
			Stepped = signal(),
			RenderStepped = signal(),
			PreRender = signal(),
			PreSimulation = signal(),
			PostSimulation = signal(),
			IsStudio = function()
				return true
			end,
			IsRunning = function()
				return false
			end,
			IsClient = function()
				return false
			end,
			IsServer = function()
				return false
			end,
			IsEdit = function()
				return true
			end,
			IsRunMode = function()
				return false
			end,
		}
	end,
	HttpService = function()
		return {
			JSONDecode = function(_self, text: string)
				return serde.decode("json", text)
			end,
			JSONEncode = function(_self, value: any)
				return serde.encode("json", value)
			end,
		}
	end,
}

function Services.install(game)
	local m = Instance.meta(game)
	m.props.GetService = function(self, name: string)
		local service = self:FindFirstChild(name)
		if service == nil then
			service = Instance.new(name, name, self)
		end
		local props = SERVICE_PROPS[name]
		local sm = Instance.meta(service)
		if props and not sm.props.__installed then
			for key, value in props() do
				sm.props[key] = value
			end
			sm.props.__installed = true
		end
		return service
	end
	m.props.IsLoaded = function()
		return true
	end
	m.props.Loaded = signal()
	m.props.PlaceId = 0
	m.props.GameId = 0
	return game
end

return Services
