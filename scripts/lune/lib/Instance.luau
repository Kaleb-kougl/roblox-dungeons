--!strict
--[[
	A minimal fake Roblox Instance for the headless test harness.

	Only what compiled roblox-ts modules, RuntimeLib and the jest packages touch at load time:
	Name / ClassName / Parent, child lookup by indexing (`script.Parent.Foo`), FindFirstChild,
	WaitForChild (never yields: a missing child is an immediate error, which is what you want
	in a test), GetChildren, GetDescendants, IsA, GetFullName, FindFirstAncestor*, and
	IsDescendantOf. Anything else errors with Roblox's own wording so a module that reaches for
	a real engine API fails loudly instead of silently getting nil.

	Extra harness-only data lives in `Instance.meta(inst)`: for a ModuleScript, the source file
	path and its kind ("luau" | "json").
]]

export type Meta = {
	name: string,
	className: string,
	parent: Instance?,
	children: { Instance },
	-- ModuleScript / Script backing file, if any
	path: string?,
	kind: string?,
	-- extra properties (services put their methods here)
	props: { [string]: any },
	-- attributes GetAttribute answers (the runner's --census flag on Workspace); nil: none
	attributes: { [string]: any }?,
	-- deferred child loader for filesystem-backed folders. Lune's fs calls yield, and a yield
	-- cannot cross the __index metamethod, so RojoTree.build expands every folder eagerly by
	-- calling Instance.expandAll() before handing the tree out.
	populate: ((inst: any) -> ())?,
}

export type Instance = typeof(setmetatable({}, {} :: any))

local Instance = {}

local META: { [any]: Meta } = setmetatable({}, { __mode = "k" }) :: any
local mt = {}

local methods = {}

local CLASS_ANCESTRY: { [string]: { string } } = {
	ModuleScript = { "ModuleScript", "LuaSourceContainer", "Instance" },
	Script = { "Script", "BaseScript", "LuaSourceContainer", "Instance" },
	LocalScript = { "LocalScript", "Script", "BaseScript", "LuaSourceContainer", "Instance" },
	Folder = { "Folder", "Instance" },
	DataModel = { "DataModel", "ServiceProvider", "Instance" },
	StringValue = { "StringValue", "ValueBase", "Instance" },
}

local function meta(inst: any): Meta
	local m = META[inst]
	if m == nil then
		error("not a harness Instance: " .. tostring(inst), 3)
	end
	return m
end

-- Children of `inst`, expanding a lazy filesystem folder on first access.
local function children(inst: any): { any }
	local m = meta(inst)
	local populate = m.populate
	if populate then
		m.populate = nil
		populate(inst)
	end
	return m.children
end

function Instance.meta(inst: any): Meta
	return meta(inst)
end

-- Runs every pending populate() (depth-first), outside any metamethod.
function Instance.expandAll(root: any)
	local stack = { root }
	while #stack > 0 do
		local inst = table.remove(stack)
		local m = meta(inst)
		local populate = m.populate
		if populate then
			m.populate = nil
			populate(inst)
		end
		for _, child in m.children do
			table.insert(stack, child)
		end
	end
end

function Instance.is(value: any): boolean
	return type(value) == "table" and META[value] ~= nil
end

function Instance.new(className: string, name: string?, parent: Instance?): Instance
	local inst = setmetatable({}, mt)
	META[inst] = {
		name = name or className,
		className = className,
		parent = nil,
		children = {},
		props = {},
	}
	if parent then
		Instance.setParent(inst, parent)
	end
	return inst
end

function Instance.setParent(inst: Instance, parent: Instance?)
	local m = meta(inst)
	if m.parent then
		local siblings = meta(m.parent).children
		local index = table.find(siblings, inst)
		if index then
			table.remove(siblings, index)
		end
	end
	m.parent = parent
	if parent then
		table.insert(meta(parent).children, inst)
	end
end

function methods.FindFirstChild(self: Instance, name: string, recursive: boolean?): Instance?
	for _, child in children(self) do
		if meta(child).name == name then
			return child
		end
	end
	if recursive then
		for _, child in children(self) do
			local found = methods.FindFirstChild(child, name, true)
			if found then
				return found
			end
		end
	end
	return nil
end

function methods.WaitForChild(self: Instance, name: string, _timeout: number?): Instance
	local child = methods.FindFirstChild(self, name)
	if child == nil then
		-- Real WaitForChild would yield forever (or return nil after a timeout). In a headless test
		-- the tree is static, so a missing child is always a bug: fail with the full path.
		error(
			string.format("[harness] WaitForChild(%q) on %s: no such child", name, methods.GetFullName(self)),
			2
		)
	end
	return child
end

function methods.FindFirstChildOfClass(self: Instance, className: string): Instance?
	for _, child in children(self) do
		if meta(child).className == className then
			return child
		end
	end
	return nil
end

function methods.FindFirstChildWhichIsA(self: Instance, className: string): Instance?
	for _, child in children(self) do
		if methods.IsA(child, className) then
			return child
		end
	end
	return nil
end

function methods.GetChildren(self: Instance): { Instance }
	return table.clone(children(self))
end

function methods.GetDescendants(self: Instance): { Instance }
	local out = {}
	local function walk(inst: Instance)
		for _, child in children(inst) do
			table.insert(out, child)
			walk(child)
		end
	end
	walk(self)
	return out
end

function methods.IsA(self: Instance, className: string): boolean
	local cls = meta(self).className
	if cls == className then
		return true
	end
	local ancestry = CLASS_ANCESTRY[cls]
	if ancestry then
		return table.find(ancestry, className) ~= nil
	end
	return className == "Instance"
end

function methods.GetFullName(self: Instance): string
	local parts = {}
	local cur: Instance? = self
	while cur ~= nil do
		local m = meta(cur)
		if m.className == "DataModel" then
			break
		end
		table.insert(parts, 1, m.name)
		cur = m.parent
	end
	return table.concat(parts, ".")
end

function methods.FindFirstAncestor(self: Instance, name: string): Instance?
	local cur = meta(self).parent
	while cur ~= nil do
		if meta(cur).name == name then
			return cur
		end
		cur = meta(cur).parent
	end
	return nil
end

function methods.FindFirstAncestorWhichIsA(self: Instance, className: string): Instance?
	local cur = meta(self).parent
	while cur ~= nil do
		if methods.IsA(cur, className) then
			return cur
		end
		cur = meta(cur).parent
	end
	return nil
end

methods.FindFirstAncestorOfClass = function(self: Instance, className: string): Instance?
	local cur = meta(self).parent
	while cur ~= nil do
		if meta(cur).className == className then
			return cur
		end
		cur = meta(cur).parent
	end
	return nil
end

function methods.IsDescendantOf(self: Instance, ancestor: Instance): boolean
	local cur = meta(self).parent
	while cur ~= nil do
		if cur == ancestor then
			return true
		end
		cur = meta(cur).parent
	end
	return false
end

function methods.IsAncestorOf(self: Instance, descendant: Instance): boolean
	return methods.IsDescendantOf(descendant, self)
end

function methods.GetAttribute(self: Instance, name: string): any
	-- Attributes the runner sets (run-tests.luau --census: Workspace KV_Census); none otherwise.
	local attributes = meta(self).attributes
	return if attributes ~= nil then attributes[name] else nil
end

function methods.Clone(_self: Instance): Instance
	error("[harness] Instance:Clone() is not supported headlessly", 2)
end

function methods.Destroy(self: Instance)
	Instance.setParent(self, nil)
end

mt.__index = function(self: Instance, key: string): any
	local m = meta(self)
	if key == "Name" then
		return m.name
	elseif key == "ClassName" then
		return m.className
	elseif key == "Parent" then
		return m.parent
	end
	local method = methods[key]
	if method ~= nil then
		return method
	end
	local prop = m.props[key]
	if prop ~= nil then
		return prop
	end
	local child = methods.FindFirstChild(self, key)
	if child ~= nil then
		return child
	end
	error(string.format("%s is not a valid member of %s %q", key, m.className, methods.GetFullName(self)), 2)
end

mt.__newindex = function(self: Instance, key: string, value: any)
	local m = meta(self)
	if key == "Name" then
		m.name = value
	elseif key == "Parent" then
		Instance.setParent(self, value)
	else
		m.props[key] = value
	end
end

mt.__tostring = function(self: Instance): string
	return meta(self).name
end

return Instance
