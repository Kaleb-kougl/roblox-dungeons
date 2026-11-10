--[[
	Rollback spike: pull captures and probe rows out of the game's DataStores from Studio, without Open Cloud
	(docs/ROLLBACK_SPIKE.md Design 5 "Logged, not only shown", Design 6, task R4).

	The server (RollbackSpikeService, Workspace attribute KV_RollbackCapture) writes:
	  KV_RollbackCapture_v1   <runId>/meta (a table) and <runId>/<i> (base64 chunk strings), one per co-op run
	  KV_RollbackProbe_v1     <writerId>/<n> (a table: one player's summaries of up to a minute), at most one a
	                          minute per player (the receiver splits each into a line per summary)
	The "Pull rollback captures" button lists both stores with Studio's own API access, reads every capture (meta and
	its chunks) and every probe row, and posts them as JSON to the receiver on this computer:
	  node scripts/rollback/receive-captures.js        (writes gitignored captures/)

	Needs: the place published, Game Settings > Security > "Enable Studio Access to API Services" on, the receiver
	running, and this plugin allowed to reach localhost (Studio asks the first time). Read-only: nothing is deleted;
	pulling again rewrites the same capture files and skips probe rows the receiver already has.

	The store names and the port repeat shared/spikes ROLLBACK_CAPTURE (captureStore, probeStore, receiverPort);
	scripts/rollback/receive-captures.test.js checks they match.

	Install: npm run rollback:plugin
	  (rojo build rollback-plugin.project.json -o "$HOME/Documents/Roblox/Plugins/KalebValeRollbackCapture.rbxm")
	Then restart Studio, open the published place and click "Pull rollback captures".
]]

local DataStoreService = game:GetService("DataStoreService")
local HttpService = game:GetService("HttpService")
local RunService = game:GetService("RunService")

-- Edit mode only (one toolbar button; play sessions load plugins again).
if plugin == nil or not RunService:IsStudio() or RunService:IsRunning() then
	return
end

local CAPTURE_STORE = "KV_RollbackCapture_v1" -- ROLLBACK_CAPTURE.captureStore
local PROBE_STORE = "KV_RollbackProbe_v1" -- ROLLBACK_CAPTURE.probeStore
local RECEIVER_PORT = 34880 -- ROLLBACK_CAPTURE.receiverPort
local RECEIVER_URL = "http://localhost:" .. tostring(RECEIVER_PORT) .. "/"
local META_SUFFIX = "/meta"
local PAGE_SIZE = 100
local ROWS_PER_POST = 50
local LOG = "[RollbackPull] "

local function say(message)
	print(LOG .. message)
end

local function complain(message)
	warn(LOG .. message)
end

-- pcall(fn) with a warning naming `what` on failure; returns ok, result.
local function try(what, fn)
	local ok, result = pcall(fn)
	if not ok then
		complain(what .. " failed: " .. tostring(result))
	end
	return ok, result
end

local function endsWith(s, suffix)
	return #s >= #suffix and string.sub(s, -#suffix) == suffix
end

-- Every key of `store` (ListKeysAsync pages), or nil on a failure.
local function listKeys(store, name)
	local ok, pages = try("ListKeysAsync " .. name, function()
		return store:ListKeysAsync("", PAGE_SIZE)
	end)
	if not ok then
		return nil
	end
	local keys = {}
	while true do
		local okPage, page = try("GetCurrentPage " .. name, function()
			return pages:GetCurrentPage()
		end)
		if not okPage then
			return nil
		end
		for _, item in ipairs(page) do
			table.insert(keys, item.KeyName)
		end
		if pages.IsFinished then
			break
		end
		local advanced = try("AdvanceToNextPageAsync " .. name, function()
			pages:AdvanceToNextPageAsync()
		end)
		if not advanced then
			return nil
		end
	end
	say(name .. ": " .. #keys .. " key(s)")
	return keys
end

local function read(store, key)
	local ok, value = try("GetAsync " .. key, function()
		return (store:GetAsync(key))
	end)
	if not ok then
		return nil
	end
	return value
end

-- POSTs `body` as JSON to the receiver; true when it answered 2xx.
local function post(body)
	local okEncode, json = try("JSONEncode", function()
		return HttpService:JSONEncode(body)
	end)
	if not okEncode then
		return false
	end
	local ok = try("PostAsync " .. RECEIVER_URL, function()
		return HttpService:PostAsync(RECEIVER_URL, json, Enum.HttpContentType.ApplicationJson, false)
	end)
	return ok
end

local function pullCaptures(store)
	local keys = listKeys(store, CAPTURE_STORE)
	if keys == nil then
		return 0, 0
	end
	local sent, failed = 0, 0
	for _, key in ipairs(keys) do
		if endsWith(key, META_SUFFIX) then
			local runId = string.sub(key, 1, #key - #META_SUFFIX)
			local meta = read(store, key)
			local count = type(meta) == "table" and meta.chunks or nil
			if type(count) ~= "number" or count < 1 then
				complain(runId .. ": meta missing or without a chunk count, skipped")
				failed += 1
			else
				local chunks = {}
				local whole = true
				for i = 0, count - 1 do
					local chunk = read(store, runId .. "/" .. tostring(i))
					if type(chunk) ~= "string" then
						complain(runId .. ": chunk " .. i .. " missing, skipped")
						whole = false
						break
					end
					table.insert(chunks, chunk)
				end
				if not whole then
					failed += 1
				elseif post({ kind = "capture", runId = runId, meta = meta, chunks = chunks }) then
					say(runId .. ": " .. tostring(meta.ticks) .. " ticks, " .. count .. " chunk(s) sent")
					sent += 1
				else
					failed += 1
				end
			end
		end
	end
	return sent, failed
end

local function pullProbeRows(store)
	local keys = listKeys(store, PROBE_STORE)
	if keys == nil then
		return 0, 0
	end
	local sent, failed = 0, 0
	local batch = {}
	local function flush()
		if #batch == 0 then
			return
		end
		if post({ kind = "probe", rows = batch }) then
			sent += #batch
		else
			failed += #batch
		end
		say("probe rows: " .. sent .. " sent, " .. failed .. " failed")
		batch = {}
	end
	for _, key in ipairs(keys) do
		local value = read(store, key)
		if type(value) == "table" then
			table.insert(batch, { key = key, value = value })
			if #batch >= ROWS_PER_POST then
				flush()
			end
		else
			failed += 1
		end
	end
	flush()
	return sent, failed
end

local toolbar = plugin:CreateToolbar("Kaleb-Vale Rollback")
local button = toolbar:CreateButton(
	"Pull rollback captures",
	"Read KV_RollbackCapture_v1 and KV_RollbackProbe_v1 and post them to scripts/rollback/receive-captures.js",
	""
)
button.ClickableWhenViewportHidden = true
local busy = false

local function pull()
	if busy then
		complain("already pulling")
		return
	end
	busy = true
	button.Enabled = false
	task.spawn(function()
		local ok, err = pcall(function()
			say("receiver " .. RECEIVER_URL)
			local reachable = try("receiver check (is receive-captures.js running?)", function()
				return HttpService:GetAsync(RECEIVER_URL, true)
			end)
			if not reachable then
				return
			end
			local okCapture, captureStore = try("GetDataStore " .. CAPTURE_STORE, function()
				return DataStoreService:GetDataStore(CAPTURE_STORE)
			end)
			local okProbe, probeStore = try("GetDataStore " .. PROBE_STORE, function()
				return DataStoreService:GetDataStore(PROBE_STORE)
			end)
			local captures, captureFailed = 0, 0
			local rows, rowsFailed = 0, 0
			if okCapture then
				captures, captureFailed = pullCaptures(captureStore)
			end
			if okProbe then
				rows, rowsFailed = pullProbeRows(probeStore)
			end
			say(
				"done: "
					.. captures
					.. " capture(s) sent ("
					.. captureFailed
					.. " failed), "
					.. rows
					.. " probe row(s) sent ("
					.. rowsFailed
					.. " failed)"
			)
		end)
		if not ok then
			complain("stopped: " .. tostring(err))
		end
		busy = false
		button.Enabled = true
	end)
end

button.Click:Connect(pull)
say("loaded: click 'Pull rollback captures' (receiver on port " .. RECEIVER_PORT .. ")")
