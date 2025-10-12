local wezterm = require("wezterm")
local act = wezterm.action
local mux = wezterm.mux

local M = {}

-- Configuration
local home_dir = os.getenv("HOME")
M.config = {
	directories = {
		home_dir .. "/Projects/Synthally/ally-api",
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
	local choices = {}

	for _, workspace_name in ipairs(workspaces) do
		table.insert(choices, {
			label = workspace_name,
			id = workspace_name,
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
	local workspaces = mux.get_workspace_names()
	if #workspaces > 0 then
		window:perform_action(act.SwitchToWorkspace({ name = workspaces[1] }), pane)
	else
		wezterm.log_info("No active workspaces to switch to")
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
