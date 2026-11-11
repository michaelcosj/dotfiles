-- Floating Rex panes for Neovim: create one, find it again by label, show,
-- hide and focus it. Used by the pi agent panel; works only when Neovim runs
-- in a Rex pane (REX_SESSION and REX_BLOCK are set).
local M = {}

M.session = vim.env.REX_SESSION
M.block = vim.env.REX_BLOCK

function M.available()
	return M.session ~= nil and M.block ~= nil and vim.fn.executable("rex") == 1
end

-- Calls a Rex API method; callback(result, err) runs on the main loop.
function M.call(method, params, callback)
	callback = callback or function(_, err)
		if err then vim.notify("Rex: " .. err, vim.log.levels.ERROR) end
	end
	vim.system({ "rex", "--autostart=false", "api", "call", method, vim.json.encode(params or {}) }, { text = true }, function(r)
		vim.schedule(function()
			if r.code ~= 0 then
				callback(nil, vim.trim((r.stderr ~= "" and r.stderr) or r.stdout or (method .. " failed")))
				return
			end
			local ok, value = pcall(vim.json.decode, r.stdout)
			callback(ok and value or {}, nil)
		end)
	end)
end

local function walk_layers(view, fn)
	for _, w in ipairs(view.windows or {}) do
		for _, layer in ipairs(w.layers or {}) do
			if fn(w, layer) then return end
		end
	end
end

-- callback(info): info.window_id is the window this Neovim is in, and
-- info.floats maps each floating pane's label to { layer_id, block_id,
-- window_id, minimized, focused }.
function M.inspect(callback)
	M.call("session.view", { session_id = M.session }, function(view, err)
		if not view then return callback(nil, err) end
		local info = { floats = {}, window_id = view.active_window_id }
		walk_layers(view, function(w, layer)
			for _, b in ipairs(layer.blocks or {}) do
				if b.block_id == M.block then info.window_id = w.window_id end
				if layer.kind ~= "tiled" and b.label then
					info.floats[b.label] = {
						layer_id = layer.layer_id,
						block_id = b.block_id,
						window_id = w.window_id,
						minimized = layer.state == "minimized",
						focused = w.focused_block_id == b.block_id and view.active_window_id == w.window_id,
					}
				end
			end
		end)
		callback(info)
	end)
end

-- Opens a new floating pane in Neovim's window. `cmd` is an argv list run
-- in place of a shell, or nil for a shell; opts.input is typed into it (end
-- with "\r" to run it), so the shell stays when the program quits.
-- opts: label, cwd, input, bounds = { x, y, w, h } as fractions, focus (default true).
function M.open_float(cmd, opts, callback)
	opts = opts or {}
	M.inspect(function(info, err)
		if not info then return (callback or function() end)(nil, err) end
		M.call("session.new_layer", {
			session_id = M.session,
			window_id = info.window_id,
			bounds = opts.bounds or { 0.1, 0.1, 0.8, 0.8 },
			focus = opts.focus ~= false,
			layout = {
				block = {
					flavor = "com.superlogical.terminal.shell",
					label = opts.label,
					options = { command = cmd, initial_input = opts.input, cwd = opts.cwd or vim.uv.cwd() },
				},
			},
		}, callback)
	end)
end

-- Runs an init.lua action (rex.action) with JSON args; callback(result, err).
function M.action(name, args, callback)
	callback = callback or function(_, err)
		if err then vim.notify("Rex: " .. err, vim.log.levels.ERROR) end
	end
	vim.system(
		{ "rex", "--autostart=false", "do", "-s", M.session, name, "--args", vim.json.encode(args or {}), "--json" },
		{ text = true },
		function(r)
			vim.schedule(function()
				if r.code ~= 0 then
					return callback(nil, vim.trim((r.stderr ~= "" and r.stderr) or r.stdout or (name .. " failed")))
				end
				local ok, value = pcall(vim.json.decode, r.stdout)
				callback(ok and value or {}, nil)
			end)
		end
	)
end

-- callback(info) for the block labelled `label`, or nil if there is none:
-- info = { block_id, kind = "float"|"tile"|"detached", window_id, layer_id,
-- minimized, focused, here (in Neovim's window) }, plus nvim_window_id and
-- nvim_root (the root node of Neovim's tiled layout) for placing a new one.
function M.locate(label, callback)
	M.call("session.view", { session_id = M.session }, function(view, err)
		if not view then return callback(nil, err) end
		local found, nvim_window, nvim_root
		walk_layers(view, function(w, layer)
			for _, b in ipairs(layer.blocks or {}) do
				if b.block_id == M.block then
					nvim_window = w.window_id
				end
				if b.label == label and not found then
					found = {
						block_id = b.block_id,
						kind = layer.kind == "tiled" and "tile" or "float",
						window_id = w.window_id,
						layer_id = layer.layer_id,
						minimized = layer.state == "minimized",
						focused = w.focused_block_id == b.block_id and view.active_window_id == w.window_id,
					}
				end
			end
		end)
		for _, w in ipairs(view.windows or {}) do
			if w.window_id == nvim_window then
				for _, layer in ipairs(w.layers or {}) do
					if layer.kind == "tiled" then nvim_root = layer.layout end
				end
			end
		end
		local function done()
			if found then found.here = found.window_id == nvim_window end
			callback(found, nil, { window_id = nvim_window or view.active_window_id, root = nvim_root })
		end
		if found then return done() end
		-- A hidden tiled panel is detached from every window.
		M.call("session.list_blocks", { session_id = M.session }, function(list)
			for _, b in ipairs(list and list.blocks or {}) do
				if b.label == label and b.placement == "detached" then
					found = { block_id = b.block_id, kind = "detached" }
					break
				end
			end
			done()
		end)
	end)
end

function M.show(float)
	M.call("session.set_layer_state", { session_id = M.session, layer_id = float.layer_id, state = "normal", focus = true })
end

function M.hide(float)
	M.call("session.set_layer_state", { session_id = M.session, layer_id = float.layer_id, state = "minimized" })
end

-- Focuses a block; if it is in a floating pane, restores and raises that first.
function M.reveal(block_id)
	M.call("session.view", { session_id = M.session }, function(view)
		local layer_id
		walk_layers(view or {}, function(_, layer)
			for _, b in ipairs(layer.blocks or {}) do
				if b.block_id == block_id and layer.kind ~= "tiled" then layer_id = layer.layer_id end
			end
			return layer_id ~= nil
		end)
		if layer_id then
			M.call("session.set_layer_state", { session_id = M.session, layer_id = layer_id, state = "normal", focus = true })
		else
			M.focus_block(block_id)
		end
	end)
end

function M.focus_block(block_id)
	M.call("session.focus_block", { session_id = M.session, block_id = block_id })
end

-- Names the Rex tab after the current file ("nvim flake.nix"), like Claude
-- Code names it after its task. Special buffers (pickers, help, terminals)
-- keep the last file's name. On exit the tab gets its old label back.
function M.setup_tab_label()
	if not M.available() then return end
	local window_id, last, timer
	local originals = {} -- window_id -> label before Neovim changed it
	local quiet = function() end

	local function wanted()
		local buf = vim.api.nvim_get_current_buf()
		if vim.bo[buf].buftype ~= "" then return nil end
		local name = vim.fn.fnamemodify(vim.api.nvim_buf_get_name(buf), ":t")
		return name ~= "" and ("nvim " .. name) or "nvim"
	end

	local function apply()
		-- a Neovim with no UI is not what the user looks at
		if #vim.api.nvim_list_uis() == 0 then return end
		local label = wanted()
		if not label then return end
		M.call("session.view", { session_id = M.session }, function(view)
			local win
			walk_layers(view or {}, function(w, layer)
				for _, b in ipairs(layer.blocks or {}) do
					if b.block_id == M.block then win = w return true end
				end
			end)
			-- a hidden (detached) pane has no tab
			if not win then return end
			if win.window_id ~= window_id then window_id, last = win.window_id, nil end
			if label == last and win.label == label then return end
			if originals[window_id] == nil then originals[window_id] = win.label or "" end
			last = label
			M.call("session.set_window_label", { session_id = M.session, window_id = window_id, label = label }, quiet)
		end)
	end

	local group = vim.api.nvim_create_augroup("rex_tab_label", { clear = true })
	vim.api.nvim_create_autocmd({ "VimEnter", "UIEnter", "BufEnter", "BufFilePost", "FocusGained" }, {
		group = group,
		callback = function()
			if timer then timer:stop() end
			timer = vim.defer_fn(apply, 150)
		end,
	})
	vim.api.nvim_create_autocmd("VimLeavePre", {
		group = group,
		callback = function()
			if timer then timer:stop() end
			local original = window_id and originals[window_id]
			if original == nil then return end
			-- synchronous: Neovim exits right after this
			pcall(function()
				vim.system({
					"rex", "--autostart=false", "api", "call", "session.set_window_label",
					vim.json.encode({ session_id = M.session, window_id = window_id, label = original }),
				}):wait(1000)
			end)
		end,
	})
end

-- Shows and focuses the float labelled `label`, creating it with `cmd` if
-- needed, or hides it when it is showing. Inside the float, Ctrl+A m (Rex's
-- pane.minimize_floating) hides it again.
function M.toggle(label, cmd, opts)
	M.inspect(function(info, err)
		if not info then return vim.notify("Rex: " .. tostring(err), vim.log.levels.ERROR) end
		local float = info.floats[label]
		if not float then
			M.open_float(cmd, vim.tbl_extend("force", opts or {}, { label = label }))
		elseif float.minimized then
			M.show(float)
		else
			M.hide(float)
		end
	end)
end

return M
