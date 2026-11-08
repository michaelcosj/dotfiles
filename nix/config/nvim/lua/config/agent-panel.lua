-- AgentPanel: a coding agent in a Rex pane beside Neovim, shown and hidden
-- with one key. It can float over the tab or be tiled into the layout, on any
-- edge. Works only when Neovim runs in a Rex pane.
--
--   require("config.agent-panel").setup({
--     agent = "pi",          -- key in `agents`
--     layout = "float",      -- "float" or "tile"
--     side = "left",         -- "left", "right", "top" or "bottom"
--     width = 0.3,           -- fractions of the tab
--     height = 1,            -- tiled panels always span the full edge
--     align = "center",      -- float: "start", "center" or "end" along the edge
--   })
--
-- :AgentPanel                 toggle
-- :AgentPanel show|hide|focus
-- :AgentPanel float|tile      switch layout (moves an open panel)
-- :AgentPanel left|right|top|bottom   (left/right <-> top/bottom swaps width and height)
-- :AgentPanel width 0.5 | height 0.8
-- :AgentPanel agent claude    switch agent (each agent has its own panel)
--
-- Inside a floating panel, Ctrl+A m hides it; Ctrl+A Shift+D / Shift+F dock
-- and float any pane.
local rex = require("config.rex")

local M = {}

M.defaults = {
	agent = "pi",
	layout = "float",
	side = "left",
	width = 0.3,
	height = 1,
	align = "center",
	-- Typed into a shell in the panel, so quitting the agent leaves a prompt.
	agents = {
		pi = { cmd = "pi" },
		claude = { cmd = "claude" },
		codex = { cmd = "codex" },
	},
	keys = { toggle = "<leader>at" },
}

M.values = vim.deepcopy(M.defaults)

local sides = { left = true, right = true, top = true, bottom = true }

local function label(agent)
	return "agent-panel:" .. (agent or M.values.agent)
end

local function clamp(x)
	return math.max(0.05, math.min(1, tonumber(x) or 0.4))
end

-- Float bounds { x, y, w, h } from side, width, height and align.
function M.bounds(v)
	v = v or M.values
	local w, h = clamp(v.width), clamp(v.height)
	local function along(len)
		if v.align == "start" then return 0 end
		if v.align == "end" then return 1 - len end
		return (1 - len) / 2
	end
	if v.side == "left" then return { 0, along(h), w, h } end
	if v.side == "top" then return { along(w), 0, w, h } end
	if v.side == "bottom" then return { along(w), 1 - h, w, h } end
	return { 1 - w, along(h), w, h }
end

-- The share of the tab a tiled panel takes.
local function tile_size(v)
	v = v or M.values
	return clamp((v.side == "left" or v.side == "right") and v.width or v.height)
end

local function notify_err(err)
	if err then vim.notify("AgentPanel: " .. tostring(err), vim.log.levels.ERROR) end
end

local function agent_spec(agent)
	local spec = M.values.agents[agent or M.values.agent]
	if not spec then error("unknown agent: " .. tostring(agent or M.values.agent)) end
	return spec
end

-- Opens a new panel for `agent`. callback(block_id, err).
function M.open(opts, callback)
	opts = opts or {}
	callback = callback or function(_, err) notify_err(err) end
	if not rex.available() then return callback(nil, "Neovim is not running inside Rex") end
	local agent = opts.agent or M.values.agent
	local ok, spec = pcall(agent_spec, agent)
	if not ok then return callback(nil, spec) end
	local block = {
		flavor = "com.superlogical.terminal.shell",
		label = label(agent),
		options = { initial_input = spec.cmd .. "\r", cwd = opts.cwd or vim.uv.cwd() },
	}
	local focus = opts.focus ~= false
	local function done(res, err)
		local id = res and res.block_ids and res.block_ids[1]
		callback(id, id == nil and (err or "Rex did not return the new pane") or nil)
	end
	if M.values.layout == "tile" then
		rex.locate(label(agent), function(_, err, here)
			if not here then return callback(nil, err) end
			local root = here.root or {}
			local anchor = root.split and root.split.split_id or root.block_id
			if not anchor then return callback(nil, "no tiled pane to split beside") end
			local before = M.values.side == "left" or M.values.side == "top"
			local size = tile_size()
			rex.call("session.new_split", {
				session_id = rex.session,
				anchor_id = anchor,
				direction = (M.values.side == "left" or M.values.side == "right") and "horizontal" or "vertical",
				side = before and "before" or "after",
				ratio = before and size or 1 - size,
				focus = focus,
				layout = { block = block },
			}, done)
		end)
	else
		rex.locate(label(agent), function(_, err, here)
			if not here then return callback(nil, err) end
			rex.call("session.new_layer", {
				session_id = rex.session,
				window_id = here.window_id,
				bounds = M.bounds(),
				focus = focus,
				layout = { block = block },
			}, done)
		end)
	end
end

-- Puts an existing panel where the config says, in Neovim's tab, visible.
-- `moved` means a setting changed, so a panel already tiled here is docked
-- again at its new side and size.
local function place(panel, here, focus, moved)
	local want_tile = M.values.layout == "tile"
	if want_tile then
		if panel.kind == "tile" and panel.here and not moved then
			if focus then rex.focus_block(panel.block_id) end
			return
		end
		rex.action("pane_dock_edge", {
			session_id = rex.session,
			block_id = panel.block_id,
			side = M.values.side,
			size = tile_size(),
			window_id = here.window_id,
			focus = focus,
		}, function(_, err) notify_err(err) end)
		return
	end
	local function to_front()
		rex.call("session.resize_layer", { session_id = rex.session, layer_id = panel.layer_id, bounds = M.bounds() })
		rex.call("session.set_layer_state", {
			session_id = rex.session,
			layer_id = panel.layer_id,
			state = "normal",
			focus = focus,
		})
	end
	if panel.kind == "float" and panel.here then return to_front() end
	local function float_it()
		rex.action("pane_float_block", { session_id = rex.session, block_id = panel.block_id, bounds = M.bounds() }, function(_, err)
			notify_err(err)
			if not err and not focus then rex.focus_block(rex.block) end
		end)
	end
	if panel.kind == "tile" and panel.here then
		float_it()
	else
		-- Detached or in another tab. float_block only takes tiled panes,
		-- so tile it in this tab first.
		rex.action("pane_dock_edge", {
			session_id = rex.session,
			block_id = panel.block_id,
			side = M.values.side,
			size = tile_size(),
			window_id = here.window_id,
			focus = false,
		}, function(_, err)
			if err then return notify_err(err) end
			float_it()
		end)
	end
end

local function hide(panel)
	if panel.kind == "float" then
		rex.call("session.set_layer_state", { session_id = rex.session, layer_id = panel.layer_id, state = "minimized" })
	elseif panel.kind == "tile" then
		-- Detached panes keep running; show puts it back at the edge.
		rex.call("session.detach_block", { session_id = rex.session, block_id = panel.block_id })
		rex.focus_block(rex.block)
	end
end

local function with_panel(agent, fn)
	if not rex.available() then return notify_err("Neovim is not running inside Rex") end
	local l = label(agent)
	rex.locate(l, function(panel, err, here)
		if err and not here then return notify_err(err) end
		if panel then panel.label = l end
		fn(panel, here)
	end)
end

local function visible(panel)
	return panel and panel.here and (panel.kind == "tile" or (panel.kind == "float" and not panel.minimized))
end

function M.toggle(agent)
	with_panel(agent, function(panel, here)
		if not panel then return M.open({ agent = agent }) end
		if visible(panel) then hide(panel) else place(panel, here, true) end
	end)
end

function M.show(agent, focus)
	with_panel(agent, function(panel, here)
		if not panel then return M.open({ agent = agent, focus = focus ~= false }) end
		place(panel, here, focus ~= false)
	end)
end

function M.hide(agent)
	with_panel(agent, function(panel)
		if visible(panel) then hide(panel) end
	end)
end

-- Hides the panel only if it floats over Neovim's tab (a tiled one covers
-- nothing). callback(hidden) says whether it did, to show it again later.
function M.hide_float(callback)
	callback = callback or function() end
	if not rex.available() then return callback(false) end
	rex.locate(label(), function(panel)
		if panel and panel.here and panel.kind == "float" and not panel.minimized then
			hide(panel)
			callback(true)
		else
			callback(false)
		end
	end)
end

-- Changes a setting and moves the panel to match, showing it if hidden.
function M.set(key, value)
	if key == "layout" then
		assert(value == "float" or value == "tile", "layout is float or tile")
	elseif key == "side" then
		assert(sides[value], "side is left, right, top or bottom")
	elseif key == "width" or key == "height" then
		value = clamp(value)
	elseif key == "agent" then
		assert(M.values.agents[value], "unknown agent: " .. tostring(value))
	elseif key == "align" then
		assert(value == "start" or value == "center" or value == "end", "align is start, center or end")
	end
	-- Turning between a side edge and top/bottom swaps width and height, so a
	-- 30%-wide full-height side panel becomes a full-width 30%-tall one.
	if key == "side" then
		local function upright(side) return side == "left" or side == "right" end
		if upright(value) ~= upright(M.values.side) then
			M.values.width, M.values.height = M.values.height, M.values.width
		end
	end
	local previous = M.values.agent
	M.values[key] = value
	if key == "agent" then
		-- the new agent's panel takes the old one's place if it was showing
		if value ~= previous then
			with_panel(previous, function(panel)
				if visible(panel) then
					hide(panel)
					M.show(value)
				end
			end)
		end
		return
	end
	if key == "align" then
		local b = M.bounds()
		local along = (M.values.side == "left" or M.values.side == "right") and b[4] or b[3]
		if M.values.layout == "tile" or along >= 1 then
			vim.notify("AgentPanel: align only moves a float shorter than its edge (set width/height below 1)", vim.log.levels.WARN)
		end
	end
	with_panel(nil, function(panel, here)
		if not panel then return end
		-- A panel docked or floated by hand keeps its kind: follow it unless
		-- the command itself is choosing the layout.
		if key ~= "layout" then
			local kind = panel.kind == "float" and "float" or "tile"
			if kind ~= M.values.layout then M.values.layout = kind end
		end
		-- Hidden panels are shown, so the change is visible.
		place(panel, here, false, true)
	end)
end

local subcommands = { "toggle", "show", "hide", "focus", "float", "tile", "left", "right", "top", "bottom", "width", "height", "align", "agent" }

local function command(opts)
	local sub, arg = opts.fargs[1] or "toggle", opts.fargs[2]
	local ok, err = pcall(function()
		if sub == "toggle" then M.toggle()
		elseif sub == "show" or sub == "focus" then M.show()
		elseif sub == "hide" then M.hide()
		elseif sub == "float" or sub == "tile" then M.set("layout", sub)
		elseif sides[sub] then M.set("side", sub)
		elseif sub == "width" or sub == "height" or sub == "align" or sub == "agent" then
			assert(arg, sub .. " needs a value")
			M.set(sub, arg)
		else
			error("unknown subcommand: " .. sub)
		end
	end)
	if not ok then notify_err(err) end
end

function M.setup(opts)
	M.values = vim.tbl_deep_extend("force", vim.deepcopy(M.defaults), opts or {})
	vim.api.nvim_create_user_command("AgentPanel", command, {
		nargs = "*",
		complete = function(arglead, line)
			local words = vim.split(line, "%s+")
			if #words > 2 and words[2] == "agent" then
				return vim.tbl_filter(function(a) return a:find(arglead, 1, true) == 1 end, vim.tbl_keys(M.values.agents))
			end
			return vim.tbl_filter(function(s) return s:find(arglead, 1, true) == 1 end, subcommands)
		end,
	})
	if M.values.keys.toggle and rex.available() then
		vim.keymap.set("n", M.values.keys.toggle, function() M.toggle() end, { desc = "Agent: toggle panel" })
	end
end

return M
