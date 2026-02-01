local wezterm = require("wezterm")
local config = wezterm.config_builder()

config.font_size = 15
config.color_scheme = "Tokyo Night"
config.force_reverse_video_cursor = true
config.use_dead_keys = false

-- Command palette
config.command_palette_rows = 5

-- Tab bar
config.hide_tab_bar_if_only_one_tab = false
config.show_new_tab_button_in_tab_bar = false
config.use_fancy_tab_bar = false
config.tab_max_width = 10000

-- Panes
config.inactive_pane_hsb = {
	saturation = 0.8,
	brightness = 0.7,
}

-- Windows
config.window_padding = {
	left = "0.5cell",
	right = "0.5cell",
	top = "0.2cell",
	bottom = "0.2cell",
}
-- config.macos_force_square_corners = true

config.window_decorations = "RESIZE|MACOS_FORCE_DISABLE_SHADOW"
config.window_background_opacity = 0.9
config.macos_window_background_blur = 90

config.skip_close_confirmation_for_processes_named = {
	"bash",
	"sh",
	"zsh",
	"fish",
	"tmux",
}

-- Hyperlink rules for file paths
config.hyperlink_rules = wezterm.default_hyperlink_rules()

-- File paths with line numbers (e.g., src/app.js:42)
table.insert(config.hyperlink_rules, {
	regex = "([~/]?[\\w\\-./]+[\\w\\-.]+):(\\d+)",
	format = "file://$1:$2",
	highlight = 0,
})

-- Absolute file paths (e.g., /home/user/file.js)
table.insert(config.hyperlink_rules, {
	regex = "(/[\\w\\-./]+[\\w\\-])",
	format = "file://$0",
	highlight = 0,
})

-- Relative file paths (e.g., src/components/Button.svelte)
local extensions =
	"(typescript|javascript|svelte|python|rust|golang|java|cpp|html|json|yaml|toml|markdown|bash|zsh|fish|tsx|jsx|ts|js|py|rs|go|c|h|css|scss|less|yml|lock|md|txt|sh)"

table.insert(config.hyperlink_rules, {
	regex = "([\\w\\-./]+[\\w\\-]\\." .. extensions .. ")",
	format = "file://$0",
	highlight = 0,
})

-- Keymaps matching tmux configuration
config.leader = { key = "a", mods = "CTRL", timeout_milliseconds = 1000 }
config.keys = {
	-- Disable some default keybinds
	{
		key = "m",
		mods = "CMD",
		action = wezterm.action.DisableDefaultAssignment,
	},
	{
		key = "Enter",
		mods = "ALT",
		action = wezterm.action.DisableDefaultAssignment,
	},
	-- Pane splitting (matching tmux)
	{
		key = "|",
		mods = "LEADER",
		action = wezterm.action.SplitHorizontal({ domain = "CurrentPaneDomain" }),
	},
	{
		key = "-",
		mods = "LEADER",
		action = wezterm.action.SplitVertical({ domain = "CurrentPaneDomain" }),
	},
	{
		key = "_",
		mods = "LEADER|SHIFT",
		action = wezterm.action.SplitVertical({ domain = "CurrentPaneDomain" }),
	},
	-- Pane navigation
	{
		key = "h",
		mods = "LEADER",
		action = wezterm.action.ActivatePaneDirection("Left"),
	},
	{
		key = "l",
		mods = "LEADER",
		action = wezterm.action.ActivatePaneDirection("Right"),
	},
	{
		key = "j",
		mods = "LEADER",
		action = wezterm.action.ActivatePaneDirection("Down"),
	},
	{
		key = "k",
		mods = "LEADER",
		action = wezterm.action.ActivatePaneDirection("Up"),
	},
	-- close pane with confirmation if active process
	{
		key = "w",
		mods = "CMD",
		action = wezterm.action.CloseCurrentPane({ confirm = true }),
	},
	-- Tab navigation (matching tmux window navigation)
	{
		key = "p",
		mods = "LEADER",
		action = wezterm.action.ActivateTabRelative(-1),
	},
	{
		key = "n",
		mods = "LEADER",
		action = wezterm.action.ActivateTabRelative(1),
	},
	-- Tab swapping (matching tmux window swapping)
	{
		key = "<",
		mods = "LEADER|SHIFT",
		action = wezterm.action.MoveTabRelative(-1),
	},
	{
		key = ">",
		mods = "LEADER|SHIFT",
		action = wezterm.action.MoveTabRelative(1),
	},
	-- Last tab/window (matching tmux)
	{
		key = "Space",
		mods = "LEADER",
		action = wezterm.action.ActivateLastTab,
	},
	-- Reload configuration
	{
		key = "r",
		mods = "CMD",
		action = wezterm.action.ReloadConfiguration,
	},
	-- Send leader key to terminal (double press)
	{
		key = "a",
		mods = "LEADER|CTRL",
		action = wezterm.action.SendKey({ key = "a", mods = "CTRL" }),
	},
	-- New tab in current directory (matching tmux)
	{
		key = "c",
		mods = "LEADER",
		action = wezterm.action.SpawnTab("CurrentPaneDomain"),
	},
	-- Enter copy mode
	{
		key = "[",
		mods = "LEADER",
		action = wezterm.action.ActivateCopyMode,
	},
	-- Enter Quick Select Mode
	{
		key = "]",
		mods = "LEADER",
		action = wezterm.action.QuickSelect,
	},
	-- open url with quick select
	{
		key = "p",
		mods = "LEADER|SHIFT",
		action = wezterm.action.QuickSelectArgs({
			label = "open url",
			patterns = {
				"https?://\\S+",
			},
			action = wezterm.action_callback(function(window, pane)
				local url = window:get_selection_text_for_pane(pane)
				wezterm.log_info("opening: " .. url)
				wezterm.open_with(url)
			end),
		}),
	},
	-- Open scrollback with nvim
	{
		key = "f",
		mods = "LEADER|SHIFT",
		action = wezterm.action.EmitEvent("trigger-vim-with-scrollback"),
	},
	-- Let macos handle cmd + arrow keys
	{
		key = "LeftArrow",
		mods = "CMD",
		action = wezterm.action({ SendString = "\x1bOH" }),
	},
	{
		key = "RightArrow",
		mods = "CMD",
		action = wezterm.action({ SendString = "\x1bOF" }),
	},
}

-- Sessionizer
local session_manager = require("session_manager")

table.insert(config.keys, {
	key = "s",
	mods = "LEADER",
	action = wezterm.action_callback(session_manager.list_active_workspaces),
})

table.insert(config.keys, {
	key = ";",
	mods = "LEADER",
	action = wezterm.action_callback(session_manager.list_directories),
})

table.insert(config.keys, {
	key = "Space",
	mods = "LEADER|CTRL",
	action = wezterm.action_callback(session_manager.goto_last_active_workspace),
})

-- Event handling
local mux = wezterm.mux

wezterm.on("gui-attached", function(domain)
	local workspace = mux.get_active_workspace()
	for _, window in ipairs(mux.all_windows()) do
		if window:get_workspace() == workspace then
			window:gui_window():maximize()
		end
	end
end)

local function shorten_tab_title(title)
	if not title or title == "" then
		return "?"
	end

	-- Pattern: cwd: cmd args (e.g., "~/dotfiles: nv file.lua")
	local cwd, cmd = title:match("^(.-):%s+(.+)$")
	if cwd and cmd then
		local program = cmd:match("^(%S+)")
		program = program:match("([^/\\]+)$") or program
		return program
	end

	-- Just a command without cwd (e.g., "nvim some/file")
	local program = title:match("^(%S+)")
	if program then
		program = program:match("([^/\\]+)$") or program
		return program
	end

	return title
end

wezterm.on("format-tab-title", function(tab, tabs, panes, config, hover, max_width)
	local title = tab.tab_title
	if not (title and #title > 0) then
		title = tab.active_pane.title
	end

	-- Only shorten when tab is NOT active
	if not tab.is_active then
		title = shorten_tab_title(title)
	end

	local text = tab.tab_index + 1

	local color_scheme = config.resolved_palette

	local fg = color_scheme.background
	local bg = color_scheme.brights[4]

	if not tab.is_active then
		bg = color_scheme.brights[5]
	end

	return wezterm.format({
		{ Background = { Color = bg } },
		{ Foreground = { Color = fg } },
		{ Text = " " .. text .. " " },
		{ Background = { Color = color_scheme.background } },
		{ Foreground = { Color = color_scheme.foreground } },
		{ Text = " " .. title .. " " },
	})
end)

wezterm.on("update-right-status", function(window, pane)
	local color_scheme = window:effective_config().resolved_palette

	window:set_right_status(wezterm.format({
		{ Background = { Color = color_scheme.brights[6] } },
		{ Foreground = { Color = color_scheme.background } },
		{ Text = "   " },
		{ Background = { Color = color_scheme.background } },
		{ Foreground = { Color = color_scheme.foreground } },
		{ Text = " " .. (window:active_workspace() or "") .. " " },
	}))
end)

local function is_shell(foreground_process_name)
	local shell_names = { "bash", "zsh", "fish", "sh", "ksh", "dash" }
	local process = string.match(foreground_process_name, "[^/\\]+$") or foreground_process_name
	for _, shell in ipairs(shell_names) do
		if process == shell then
			return true
		end
	end
	return false
end

wezterm.on("open-uri", function(window, pane, uri)
	local editor = os.getenv("EDITOR") or "nvim"

	if uri:find("^file:") == 1 and not pane:is_alt_screen_active() then
		local url = wezterm.url.parse(uri)
		if is_shell(pane:get_foreground_process_name()) then
			local success, stdout, _ = wezterm.run_child_process({
				"file",
				"--brief",
				"--mime-type",
				url.file_path,
			})
			if success then
				if stdout:find("directory") then
					wezterm.log_info("open-uri: navigating to directory " .. url.file_path)
					pane:send_text(wezterm.shell_join_args({ "cd", url.file_path }) .. "\r")
					pane:send_text(wezterm.shell_join_args({
						"eza",
						"-a",
						"--group-directories-first",
					}) .. "\r")
					return false
				end

				if stdout:find("text") then
					wezterm.log_info("open-uri: opening text file " .. url.file_path)
					if url.fragment then
						pane:send_text(wezterm.shell_join_args({
							editor,
							"+" .. url.fragment,
							url.file_path,
						}) .. "\r")
					else
						pane:send_text(wezterm.shell_join_args({ editor, url.file_path }) .. "\r")
					end
					return false
				end

				wezterm.log_info("open-uri: unhandled mime type " .. stdout)
			end
		else
			-- No shell detected, we're probably connected with SSH, use fallback command
			local edit_cmd = url.fragment and editor .. " +" .. url.fragment .. ' "$_f"' or editor .. ' "$_f"'
			local cmd = '_f="'
				.. url.file_path
				.. '"; { test -d "$_f" && { cd "$_f" ; ls -a -p --hyperlink --group-directories-first; }; } '
				.. '|| { test "$(file --brief --mime-type "$_f" | cut -d/ -f1 || true)" = "text" && '
				.. edit_cmd
				.. "; }; echo"
			pane:send_text(cmd .. "\r")
			return false
		end
	end

	-- without a return value, we allow default actions
end)

wezterm.on("trigger-vim-with-scrollback", function(window, pane)
	local text = pane:get_lines_as_text(pane:get_dimensions().scrollback_rows)

	local name = os.tmpname()
	local f = io.open(name, "w+")

	if f == nil then
		wezterm.log_error("trigger-vim-with-scrollback: failed to create temp file")
		return
	end

	f:write(text)
	f:flush()
	f:close()

	-- Open nvim with the scrollback, then clean up the temp file after nvim exits
	window:perform_action(
		wezterm.action.SpawnCommandInNewWindow({
			args = {
				os.getenv("SHELL"),
				"-c",
				"nvim " .. wezterm.shell_quote_arg(name) .. "; rm -f " .. wezterm.shell_quote_arg(name),
			},
		}),
		pane
	)
end)

return config
