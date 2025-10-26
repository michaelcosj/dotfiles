local wezterm = require("wezterm")
local act = wezterm.action
local mux = wezterm.mux

local M = {}

-- Configuration
local home_dir = os.getenv("HOME")
M.config = {
	directories = {
		home_dir .. "/Projects/Synthally/ally-api",
		home_dir .. "/Projects/Synthally/",
		home_dir .. "/Projects/Valutech",
		home_dir .. "/.dotfiles",
		home_dir .. "/.dotfiles/nix/config",
		home_dir .. "/Projects",
	},
	cache_ttl = 60 * 60, -- 1 hour
}

-- Cache system
M.cache = {
	dirs = {},
	timestamp = 0,
}

-- Pre-computed search paths and command
local search_paths = table.concat(M.config.directories, " ")
local fd_command = "fd . --max-depth 1 --type d --exclude node_modules --no-ignore-vcs "
	.. search_paths
	.. " 2>/dev/null"

-- List active workspaces and allow switching
M.list_active_workspaces = function(window, pane)
	local workspaces = mux.get_workspace_names()
	local workspace_data = wezterm.GLOBAL.workspace_data
	if not workspace_data then
		workspace_data = { data = {} }
		wezterm.GLOBAL.workspace_data = workspace_data
	end
	local open_workspaces = workspace_data.data
	local choices = {}
	local current_workspace = mux.get_active_workspace()
	local current_time = os.time()

	-- Create list with timestamps
	local workspace_list = {}
	for _, workspace_name in ipairs(workspaces) do
		local timestamp = 0
		local workspace_time = open_workspaces[workspace_name]
		if workspace_time then
			timestamp = tonumber(tostring(workspace_time)) or 0
		end

		-- Current workspace gets highest priority
		if workspace_name == current_workspace then
			timestamp = current_time
		end

		table.insert(workspace_list, {
			name = workspace_name,
			timestamp = timestamp,
		})
	end

	-- Sort by timestamp (most recent first)
	table.sort(workspace_list, function(a, b)
		return a.timestamp > b.timestamp
	end)

	-- Create choices from sorted list
	for _, workspace in ipairs(workspace_list) do
		local time_str = workspace.timestamp > 0 and os.date("%H:%M:%S", workspace.timestamp) or "unknown"
		local indicator = workspace.name == current_workspace and " [CURRENT]" or ""

		table.insert(choices, {
			label = workspace.name .. indicator .. " (last: " .. time_str .. ")",
			id = workspace.name,
		})
	end

	if #choices == 0 then
		wezterm.log_info("No active workspaces")
		return
	end

	window:perform_action(
		act.InputSelector({
			action = wezterm.action_callback(function(win, _, id, label)
				if id and label then
					-- Update timestamp when switching
					local current_time = os.time()
					M.set_workspace_data(id, current_time)

					win:perform_action(act.SwitchToWorkspace({ name = id }), pane)
				end
			end),
			fuzzy = true,
			title = "Active workspaces",
			choices = choices,
		}),
		pane
	)
end

-- Helper function to get workspace data as proper Lua table
M.get_workspace_data = function()
	local workspace_data = wezterm.GLOBAL.workspace_data
	if not workspace_data then
		workspace_data = { data = {} }
		wezterm.GLOBAL.workspace_data = workspace_data
	end

	-- Convert userdata to proper Lua table if needed
	local result = {}
	for k, v in pairs(workspace_data.data) do
		local time_val = type(v) == "number" and v or tonumber(tostring(v))
		if time_val then
			result[k] = time_val
		end
	end
	return result
end

-- Helper function to set workspace data
M.set_workspace_data = function(key, value)
	local workspace_data = wezterm.GLOBAL.workspace_data
	if not workspace_data then
		workspace_data = { data = {} }
		wezterm.GLOBAL.workspace_data = workspace_data
	end
	workspace_data.data[key] = value
end

-- Helper function to get directories with caching
M.get_directories = function()
	local current_time = os.time()

	-- Check cache validity
	if current_time - M.cache.timestamp < M.config.cache_ttl and #M.cache.dirs > 0 then
		return M.cache.dirs
	end

	local dirs = {}
	local seen = {} -- For deduplication

	local success, stdout, stderr = wezterm.run_child_process({
		os.getenv("SHELL"),
		"-c",
		fd_command,
	})

	if success then
		for line in stdout:gmatch("([^\n]*)\n?") do
			if line and line ~= "" then
				local clean_line = line:gsub("/$", "") -- Remove trailing slash

				-- Skip if already seen (deduplication)
				if not seen[clean_line] then
					seen[clean_line] = true

					local label = clean_line:gsub(home_dir, "~")
					local basename = clean_line:gsub(".*/", ""):gsub("[^%w%-_]", "")
					local id = basename ~= "" and basename or clean_line:gsub("[^%w%-_/]", "")

					table.insert(dirs, { label = label, id = id })
				end
			end
		end
	end

	-- Update cache
	M.cache.dirs = dirs
	M.cache.timestamp = current_time

	return dirs
end

-- List directories and create new workspace
M.list_directories = function(window, pane)
	local dirs = M.get_directories()

	window:perform_action(
		act.InputSelector({
			action = wezterm.action_callback(function(win, _, id, label)
				if id and label then
					local full_path = label:gsub("^~", home_dir)
					win:perform_action(
						act.SwitchToWorkspace({
							name = id,
							spawn = { cwd = full_path },
						}),
						pane
					)

					local current_time = os.time()
					M.set_workspace_data(id, current_time)
				end
			end),
			fuzzy = true,
			title = "Select directory for new workspace",
			choices = dirs,
		}),
		pane
	)
end

-- Go to last active workspace
M.goto_last_active_workspace = function(window, pane)
	local workspace_data = wezterm.GLOBAL.workspace_data
	if not workspace_data or not workspace_data.data then
		wezterm.log_info("No workspace data available")
		return
	end

	local open_workspaces = workspace_data.data
	local current_workspace = mux.get_active_workspace()
	local sorted = {}

	-- Get all workspace names first
	local workspaces = mux.get_workspace_names()

	-- Access values by key directly (like in list_active_workspaces)
	for _, workspace_name in ipairs(workspaces) do
		local workspace_time = open_workspaces[workspace_name]
		if workspace_time then
			local time_val = tonumber(tostring(workspace_time)) or 0

			wezterm.log_info("Workspace: " .. workspace_name .. ", time: " .. tostring(time_val))

			if time_val > 0 then
				table.insert(sorted, { name = workspace_name, time = time_val })
			end
		end
	end

	table.sort(sorted, function(a, b)
		return a.time > b.time
	end)

	if #sorted == 0 then
		wezterm.log_info("No active workspaces to switch to")
		return
	end

	-- Don't switch if we're already on the most recent workspace
	if sorted[1].name == current_workspace then
		if #sorted > 1 then
			local target = sorted[2].name
			local current_time = os.time()
			M.set_workspace_data(target, current_time)
			window:perform_action(act.SwitchToWorkspace({ name = target }), pane)
		else
			wezterm.log_info("Already on the most recent workspace")
		end
	else
		local target = sorted[1].name
		local current_time = os.time()
		M.set_workspace_data(target, current_time)
		window:perform_action(act.SwitchToWorkspace({ name = target }), pane)
	end
end

-- Cache management functions
M.clear_cache = function()
	M.cache.dirs = {}
	M.cache.timestamp = 0
end

M.refresh_directories = function()
	M.clear_cache()
	return M.get_directories()
end

return M
