-- The sessioniser: lists projects and opens each as a Rex session built from
-- its layout in projects.lua, or switches to it if it's already open.
local util = require("rexkit.util")
local L = require("rexkit.layout")
local ui = require("rexkit.ui")

local M = {}

local fallback = { tabs = { { name = "edit", layout = L.col(L.pane({ cmd = "nvim" }), L.pane(), 0.7) } } }

function M.config()
	local cfg, err = util.load_config(util.config_dir .. "/projects.lua")
	if not cfg then return { groups = {}, projects = {}, default = fallback }, err end
	cfg.groups = cfg.groups or {}
	cfg.projects = cfg.projects or {}
	cfg.default = cfg.default or fallback
	return cfg
end

local function sessions_by_label()
	local out = {}
	for _, s in ipairs(util.call("session.list", {}).sessions or {}) do
		if s.label then out[s.label] = s end
	end
	return out
end

-- Every project: { name, root, def, session }, sorted with open ones first.
function M.list()
	local cfg = M.config()
	local found, by_root = {}, {}

	-- tabs come from the project, else its group's defaults, else `default`
	local function tabs_of(...)
		for i = 1, select("#", ...) do
			local def = select(i, ...)
			if def and def.tabs then return def.tabs end
		end
		return fallback.tabs
	end

	local function add(root, tabs, base)
		root = util.expand(root):gsub("/$", "")
		if by_root[root] then return end
		local item = { base = base or util.basename(root), root = root, tabs = tabs }
		by_root[root] = item
		table.insert(found, item)
	end

	-- named projects with their own root
	for name, def in pairs(cfg.projects) do
		if def.root then add(def.root, tabs_of(def, cfg.default), name) end
	end
	-- every folder in each group; a named project without a root claims its folder by name
	for _, g in ipairs(cfg.groups) do
		local dir = util.expand(g.dir)
		for _, path in ipairs(util.subdirs(dir)) do
			local base = util.basename(path)
			if not util.matches_any(base, g.exclude) then
				local named = cfg.projects[base]
				named = (named and not named.root) and named or nil
				add(path, tabs_of(named, g.defaults, cfg.default), base)
			end
		end
	end

	-- the folder name, or parent/folder when two folders share a name
	local count = {}
	for _, item in ipairs(found) do count[item.base] = (count[item.base] or 0) + 1 end
	local items, names = {}, {}
	for _, item in ipairs(found) do
		item.name = count[item.base] > 1 and (util.basename(util.parent(item.root)) .. "/" .. item.base) or item.base
		names[item.name] = true
		table.insert(items, item)
	end

	-- open sessions that aren't projects are listed too, to switch to
	local live = sessions_by_label()
	for _, item in ipairs(items) do item.session = live[item.name] end
	for label, s in pairs(live) do
		if not names[label] then table.insert(items, { name = label, session = s }) end
	end

	table.sort(items, function(a, b)
		if (a.session ~= nil) ~= (b.session ~= nil) then return a.session ~= nil end
		return a.name:lower() < b.name:lower()
	end)
	return items
end

-- Lines for fzf: name, then what to show.
function M.lines()
	local out = {}
	for _, item in ipairs(M.list()) do
		local mark = item.session and "●" or " "
		local where = item.root and item.root:gsub("^" .. util.home:gsub("%p", "%%%0"), "~") or "(session)"
		table.insert(out, string.format("%s\t%s %-28s %s", item.name, mark, item.name, where))
	end
	return table.concat(out, "\n")
end

local function create(item)
	local tabs = item.tabs or fallback.tabs
	local windows = {}
	for _, tab in ipairs(tabs) do
		table.insert(windows, { window_label = tab.name, layout = L.to_api(tab.layout, item.root) })
	end
	local res = util.call("session.create", { label = item.name, initial_windows = windows })
	-- floats, created after their window exists
	for i, tab in ipairs(tabs) do
		local win = res.initial_windows and res.initial_windows[i]
		for _, f in ipairs(tab.floats or {}) do
			local layer = util.call("session.new_layer", {
				session_id = res.session_id,
				window_id = win and win.window_id,
				bounds = f.bounds or { 0.2, 0.15, 0.6, 0.6 },
				focus = false,
				layout = L.to_api(f.layout, item.root),
			})
			if f.minimized and layer and layer.layer_id then
				util.call("session.set_layer_state", { session_id = res.session_id, layer_id = layer.layer_id, state = "minimized" })
			end
		end
	end
	return res.session_id
end

-- Switches to the project's session, creating it first if needed.
function M.open(name, from_session)
	for _, item in ipairs(M.list()) do
		if item.name == name then
			local sid = item.session and item.session.session_id or create(item)
			ui.select(sid, from_session)
			return sid
		end
	end
	error("no project named " .. tostring(name))
end

-- The session's tabs as a projects.lua entry, to paste in.
function M.snippet(session_id)
	local view = util.call("session.view", { session_id = session_id })
	local restore = require("rexkit.restore")
	local cfg = restore.config()
	local tabs, root = {}, nil
	for _, w in ipairs(view.windows or {}) do
		local tiled
		for _, layer in ipairs(w.layers or {}) do
			if layer.kind == "tiled" then tiled = layer end
		end
		if tiled then
			local panes = {}
			for _, b in ipairs(tiled.blocks or {}) do
				local e = restore.describe(cfg, { session_id = session_id, label = view.label }, b)
				local pwd = util.call("block.method", { session_id = session_id, block_id = b.block_id, method = "pwd" })
				local cwd = pwd and pwd.pwd and pwd.pwd:match("^file://[^/]*(/.*)$")
				root = root or cwd
				panes[b.block_id] = { cmd = e and e.mode == "run" and not e.agent and e.command or (e and e.program), cwd = cwd }
			end
			-- cwd relative to the project root, which is the first pane's
			for _, p in pairs(panes) do
				if p.cwd == root then
					p.cwd = nil
				elseif p.cwd and root and p.cwd:sub(1, #root + 1) == root .. "/" then
					p.cwd = p.cwd:sub(#root + 2)
				end
			end
			table.insert(tabs, string.format("\t\t{ name = %q, layout = %s },", w.label or "tab", L.to_lua(tiled.layout, panes)))
		end
	end
	return string.format("%s = {\n\troot = %q,\n\ttabs = {\n%s\n\t},\n},", string.format("[%q]", view.label or "project"), root or "~", table.concat(tabs, "\n"))
end

return M
