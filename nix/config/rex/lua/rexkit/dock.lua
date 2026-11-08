-- Moving panes between a window's tiled layout and floating layers.
--
-- edge() places a pane along one edge of its window, spanning the window's
-- full height (left/right) or width (top/bottom). session.move_block only
-- splits a single pane, so when the layout is already split, edge() first
-- splits the whole layout with a placeholder pane, moves the pane beside the
-- placeholder and closes the placeholder, which leaves the pane in its place.
local util = require("rexkit.util")

local M = {}

local SHELL = "com.superlogical.terminal.shell"

local function view(session_id)
	return util.call("session.view", { session_id = session_id })
end

-- Where a block is: { window = w, layer = layer, tiled = bool }.
local function locate(v, block_id)
	for _, w in ipairs(v.windows or {}) do
		for _, layer in ipairs(w.layers or {}) do
			for _, b in ipairs(layer.blocks or {}) do
				if b.block_id == block_id then
					return { window = w, layer = layer, tiled = layer.kind == "tiled" }
				end
			end
		end
	end
end

local function find_window(v, window_id)
	for _, w in ipairs(v.windows or {}) do
		if w.window_id == window_id then return w end
	end
end

local function tiled_layout(w)
	for _, layer in ipairs(w and w.layers or {}) do
		if layer.kind == "tiled" then return layer.layout end
	end
end

local function count_tiled(node)
	if not node then return 0 end
	if node.block_id then return 1 end
	if node.split then return count_tiled(node.split.before) + count_tiled(node.split.after) end
	return 0
end

local function first_block(node)
	if not node then return nil end
	if node.block_id then return node.block_id end
	if node.split then return first_block(node.split.before) or first_block(node.split.after) end
end

local function clamp(x, lo, hi)
	return math.max(lo, math.min(hi, x))
end

-- Floats a tiled pane. bounds default to a centred 80% box.
function M.float(session_id, block_id, bounds)
	local v = view(session_id)
	local at = locate(v, block_id)
	assert(at, "pane not found: " .. tostring(block_id))
	if not at.tiled then return { layer_id = at.layer.layer_id, already = true } end
	assert(count_tiled(tiled_layout(at.window)) > 1, "can't float the only tiled pane in a tab")
	local res = util.call("session.float_block", {
		session_id = session_id,
		block_id = block_id,
		bounds = bounds or { 0.1, 0.1, 0.8, 0.8 },
	})
	util.call("session.focus_block", { session_id = session_id, block_id = block_id })
	return res
end

-- Places block_id along `side` (left, right, top, bottom) of window_id (by
-- default the block's own window), taking `size` (0-1) of the window. The
-- block may be tiled, floating or detached.
function M.edge(session_id, block_id, opts)
	opts = opts or {}
	local side = opts.side or "right"
	local size = clamp(opts.size or 0.4, 0.05, 0.95)
	local direction = (side == "left" or side == "right") and "horizontal" or "vertical"
	local place = (side == "left" or side == "top") and "before" or "after"
	local ratio = place == "before" and size or 1 - size

	local v = view(session_id)
	local at = locate(v, block_id)
	local window_id = opts.window_id or (at and at.window.window_id)
	assert(window_id, "no window to dock into")

	-- Take the block out first so the layout below doesn't include it.
	if at then
		local root = tiled_layout(at.window)
		if at.tiled and count_tiled(root) <= 1 and at.window.window_id == window_id then
			return { docked = false, reason = "only pane in the tab" }
		end
		util.call("session.detach_block", { session_id = session_id, block_id = block_id })
		v = view(session_id)
	end

	local root = tiled_layout(find_window(v, window_id))
	assert(root and (root.block_id or root.split), "the tab has no tiled pane to dock beside")

	if root.block_id then
		util.call("session.move_block", {
			session_id = session_id,
			block_id = block_id,
			anchor_block_id = root.block_id,
			direction = direction,
			side = place,
			ratio = ratio,
		})
	else
		local split = util.call("session.new_split", {
			session_id = session_id,
			anchor_id = root.split.split_id,
			direction = direction,
			side = place,
			ratio = ratio,
			focus = false,
			layout = { block = { flavor = SHELL, options = { command = { "/bin/sh", "-c", "sleep 60" } } } },
		})
		local placeholder = split.block_ids and split.block_ids[1]
		assert(placeholder, "Rex did not create the placeholder pane")
		util.call("session.move_block", {
			session_id = session_id,
			block_id = block_id,
			anchor_block_id = placeholder,
			direction = direction,
			side = "after",
		})
		util.call("block.close", { session_id = session_id, block_id = placeholder })
	end
	if opts.focus ~= false then
		util.call("session.focus_block", { session_id = session_id, block_id = block_id })
	end
	return { docked = true }
end

-- Docks a floating pane along the window edge it is closest to, keeping its
-- width (left/right) or height (top/bottom).
function M.dock(session_id, block_id)
	local v = view(session_id)
	local at = locate(v, block_id)
	assert(at, "pane not found: " .. tostring(block_id))
	if at.tiled then return { docked = false, reason = "already tiled" } end
	local x, y, w, h = (table.unpack or unpack)(at.layer.bounds or { 0.1, 0.1, 0.8, 0.8 })
	local gaps = {
		{ "left", x, w },
		{ "right", 1 - (x + w), w },
		{ "top", y, h },
		{ "bottom", 1 - (y + h), h },
	}
	table.sort(gaps, function(a, b) return a[2] < b[2] end)
	local side, size = gaps[1][1], gaps[1][3]
	-- A big centred float would take most of the window; keep it a sidebar.
	if size > 0.6 then size = 0.5 end
	return M.edge(session_id, block_id, { side = side, size = size, window_id = at.window.window_id })
end

M.first_block = first_block

return M
