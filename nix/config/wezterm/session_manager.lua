local wezterm = require("wezterm")
local act = wezterm.action
local mux = wezterm.mux

local M = {}

local home_dir = wezterm.home_dir

M.config = {
	directories = {
		home_dir .. "/Projects",
		home_dir .. "/Projects/oss",
		home_dir .. "/Projects/work",
		home_dir .. "/Projects/work/Valutech",
		home_dir .. "/Projects/work/Synthally",
		home_dir .. "/Projects/work/Synthally/tests",
		home_dir .. "/Projects/personal",
		home_dir .. "/.dotfiles",
		home_dir .. "/.dotfiles/nix/config",
	},
}

M.list_active_workspaces = function(window, pane)
	local current_workspace = mux.get_active_workspace()
	local workspace_list = M._get_sorted_workspaces(current_workspace)

	if #workspace_list == 0 then
		wezterm.log_info("No active workspaces")
		return
	end

	local choices = {}
	for _, workspace in ipairs(workspace_list) do
		local time_str = workspace.timestamp > 0 and os.date("%H:%M:%S", workspace.timestamp) or "unknown"
		local indicator = workspace.name == current_workspace and " [CURRENT]" or ""

		table.insert(choices, {
			label = workspace.name .. indicator .. " (last: " .. time_str .. ")",
			id = workspace.name,
		})
	end

	window:perform_action(
		act.InputSelector({
			action = wezterm.action_callback(function(win, inner_pane, id, label)
				if id and label then
					M._switch_to_workspace(win, inner_pane, id)
				end
			end),
			fuzzy = true,
			title = "Active workspaces",
			choices = choices,
		}),
		pane
	)
end

M.set_workspace_data = function(key, value)
	local workspace_data = M._get_workspace_data_ref()
	workspace_data.data[key] = value
end

M.get_directories = function()
	local dirs = {}
	local seen = {}

	for _, search_dir in ipairs(M.config.directories) do
		local success, entries = pcall(wezterm.read_dir, search_dir)
		if success and entries then
			for _, full_path in ipairs(entries) do
				if not seen[full_path] then
					local basename = full_path:match("([^/]+)$") or "unnamed"

					if basename ~= "node_modules" and M._is_directory(full_path) then
						seen[full_path] = true

						local label = full_path:gsub("^" .. home_dir, "~")
						local id = M._make_workspace_id(basename, full_path)

						table.insert(dirs, {
							label = label,
							id = id,
						})
					end
				end
			end
		end
	end

	return dirs
end

M.list_directories = function(window, pane)
	local dirs = M.get_directories()

	window:perform_action(
		act.InputSelector({
			action = wezterm.action_callback(function(win, inner_pane, id, label)
				if id and label then
					local full_path = label:gsub("^~", home_dir)
					M._switch_to_workspace(win, inner_pane, id, full_path)
				end
			end),
			fuzzy = true,
			title = "Select directory for new workspace",
			choices = dirs,
			fuzzy_description = "Select directory for new workspace: ",
		}),
		pane
	)
end

M.goto_last_active_workspace = function(window, pane)
	local current_workspace = mux.get_active_workspace()
	local sorted = M._get_sorted_workspaces(current_workspace)

	local with_history = {}
	for _, ws in ipairs(sorted) do
		if M._get_workspace_timestamp(ws.name) > 0 or ws.name == current_workspace then
			table.insert(with_history, ws)
		end
	end

	if #with_history == 0 then
		wezterm.log_info("No active workspaces to switch to")
		return
	end

	if #with_history > 1 then
		M._switch_to_workspace(window, pane, with_history[2].name)
	else
		wezterm.log_info("No other workspace to switch to")
	end
end

-- Private helpers
M._get_workspace_data_ref = function()
	local workspace_data = wezterm.GLOBAL.workspace_data
	if not workspace_data then
		workspace_data = { data = {} }
		wezterm.GLOBAL.workspace_data = workspace_data
	end
	return workspace_data
end

M._get_workspace_timestamp = function(workspace_name)
	local workspace_data = M._get_workspace_data_ref()
	return tonumber(workspace_data.data[workspace_name]) or 0
end

M._get_sorted_workspaces = function(current_workspace)
	local workspaces = mux.get_workspace_names()
	local list = {}

	for _, name in ipairs(workspaces) do
		local timestamp = M._get_workspace_timestamp(name)
		if name == current_workspace then
			timestamp = os.time()
		end
		table.insert(list, { name = name, timestamp = timestamp })
	end

	table.sort(list, function(a, b)
		return a.timestamp > b.timestamp
	end)
	return list
end

M._switch_to_workspace = function(win, pane, id, cwd)
	local opts = { name = id }
	if cwd then
		opts.spawn = { cwd = cwd }
	end
	M.set_workspace_data(id, os.time())
	win:perform_action(act.SwitchToWorkspace(opts), pane)
end

M._is_directory = function(path)
	local success, _ = pcall(wezterm.read_dir, path)
	return success
end

-- Simple hash function to generate short unique suffix from path
M._short_hash = function(str)
	local hash = 0
	for i = 1, #str do
		hash = (hash * 31 + string.byte(str, i)) % 0xFFFFFFFF
	end
	return string.format("%04x", hash % 0xFFFF)
end

M._make_workspace_id = function(basename, full_path)
	local sanitized = basename:gsub("[^%w%-_]", "")
	if sanitized == "" then
		sanitized = "workspace"
	end
	local hash = M._short_hash(full_path)
	return sanitized .. "-" .. hash
end

return M
