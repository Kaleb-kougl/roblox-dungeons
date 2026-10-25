--!nonstrict
--[[
	Builds a fake DataModel from a Rojo project file, following the subset of Rojo's sync rules
	that compiled roblox-ts output and npm packages rely on:

	  project node    $className / $path / named children; a $path'd directory that holds its own
	                  default.project.json is replaced by that project's tree (named by the parent
	                  key, or by the nested project's "name" when found while scanning a directory)
	  directory       Folder, or the init.luau / init.lua / init.server.* / init.client.* script
	                  with the other entries as its children
	  x.luau / x.lua  ModuleScript "x"     (x.server.* -> Script, x.client.* -> LocalScript)
	  x.json          ModuleScript "x" returning the decoded JSON (Rojo's JSON module rule)
	  everything else ignored (.ts, .d.ts, .md, package.json, tsconfig.json, *.meta.json, ...)

	Every directory is expanded up front (Lune's fs calls yield, and the Instance __index
	metamethod that would trigger a lazy expansion cannot yield).
]]

local fs = require("@lune/fs")
local serde = require("@lune/serde")

local Instance = require("./Instance")

local RojoTree = {}

local function join(a: string, b: string): string
	if string.sub(a, -1) == "/" then
		return a .. b
	end
	return a .. "/" .. b
end

local function dirname(p: string): string
	return string.match(p, "^(.*)/[^/]*$") or "."
end

local IGNORED_FILES = {
	["package.json"] = true,
	["tsconfig.json"] = true,
	["default.project.json"] = true,
}

-- Returns className, instanceName, kind for a file, or nil when Rojo would not sync it.
local function classify(fileName: string): (string?, string?, string?)
	if IGNORED_FILES[fileName] or string.sub(fileName, 1, 1) == "." then
		return nil
	end
	if string.match(fileName, "%.d%.ts$") or string.match(fileName, "%.meta%.json$") then
		return nil
	end
	if string.match(fileName, "%.project%.json$") or string.match(fileName, "%.model%.json$") then
		return nil
	end
	local stem = string.match(fileName, "^(.+)%.server%.luau?$")
	if stem then
		return "Script", stem, "luau"
	end
	stem = string.match(fileName, "^(.+)%.client%.luau?$")
	if stem then
		return "LocalScript", stem, "luau"
	end
	stem = string.match(fileName, "^(.+)%.luau?$")
	if stem then
		return "ModuleScript", stem, "luau"
	end
	stem = string.match(fileName, "^(.+)%.json$")
	if stem then
		return "ModuleScript", stem, "json"
	end
	return nil
end

local INIT_FILES = {
	{ "init.luau", "ModuleScript" },
	{ "init.lua", "ModuleScript" },
	{ "init.server.luau", "Script" },
	{ "init.server.lua", "Script" },
	{ "init.client.luau", "LocalScript" },
	{ "init.client.lua", "LocalScript" },
}

local buildPath
local buildProjectNode

local function populateDirectory(dirPath: string, skip: string?)
	return function(inst)
		local entries = fs.readDir(dirPath)
		table.sort(entries)
		for _, entry in entries do
			if entry ~= skip then
				buildPath(join(dirPath, entry), nil, inst, true)
			end
		end
	end
end

-- `name` overrides the instance name (a project key); nil means derive it from the filesystem.
-- `scanned` is true when we got here by listing a directory (nested projects use their own name).
function buildPath(fsPath: string, name: string?, parent, scanned: boolean)
	if fs.isDir(fsPath) then
		local projectFile = join(fsPath, "default.project.json")
		if fs.isFile(projectFile) then
			local project = serde.decode("json", fs.readFile(projectFile))
			local instanceName = name
			if instanceName == nil then
				instanceName = if scanned then project.name else string.match(fsPath, "([^/]+)/?$")
			end
			return buildProjectNode(project.tree, instanceName, fsPath, parent)
		end

		local dirName = name or string.match(fsPath, "([^/]+)/?$")
		for _, init in INIT_FILES do
			local initPath = join(fsPath, init[1])
			if fs.isFile(initPath) then
				local inst = Instance.new(init[2], dirName, parent)
				local m = Instance.meta(inst)
				m.path = initPath
				m.kind = "luau"
				m.populate = populateDirectory(fsPath, init[1])
				return inst
			end
		end
		local folder = Instance.new("Folder", dirName, parent)
		Instance.meta(folder).populate = populateDirectory(fsPath, nil)
		return folder
	elseif fs.isFile(fsPath) then
		local fileName = string.match(fsPath, "([^/]+)$")
		local className, stem, kind = classify(fileName)
		if className == nil then
			return nil
		end
		local inst = Instance.new(className, name or stem, parent)
		local m = Instance.meta(inst)
		m.path = fsPath
		m.kind = kind
		return inst
	end
	return nil
end

function buildProjectNode(node, name: string, baseDir: string, parent)
	local inst
	local path = node["$path"]
	if path ~= nil then
		local fsPath = join(baseDir, path)
		inst = buildPath(fsPath, name, parent, false)
		if inst == nil then
			-- Rojo errors on a missing $path; a missing optional folder (e.g. out/ before a build)
			-- is more useful as an empty Folder plus a clear message from whoever looks it up.
			inst = Instance.new(node["$className"] or "Folder", name, parent)
		end
	else
		inst = Instance.new(node["$className"] or "Folder", name, parent)
	end
	for key, child in node do
		if string.sub(key, 1, 1) ~= "$" then
			buildProjectNode(child, key, baseDir, inst)
		end
	end
	return inst
end

--[[
	Loads `projectPath` (a Rojo project whose root is a DataModel) and returns the DataModel.
]]
function RojoTree.build(projectPath: string)
	local project = serde.decode("json", fs.readFile(projectPath))
	local root = buildProjectNode(project.tree, project.name, dirname(projectPath), nil)
	Instance.expandAll(root)
	return root
end

return RojoTree
