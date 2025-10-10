local wezterm = require("wezterm")
local config = wezterm.config_builder()

config.font_size = 13
config.color_scheme = "Kanagawa Dragon"
config.force_reverse_video_cursor = true

-- Command pallete
config.command_palette_rows = 5

-- Tab bar
config.hide_tab_bar_if_only_one_tab = true
config.show_new_tab_button_in_tab_bar = false
config.use_fancy_tab_bar = false
config.tab_max_width = 10000

-- Panes
config.inactive_pane_hsb = {
	saturation = 0.8,
	brightness = 0.7,
}

-- Windows
config.window_decorations = "RESIZE"
config.window_background_opacity = 0.8
config.macos_window_background_blur = 80
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
	regex = "([~/]?[\\w\\-./]+[\\w\\-]):(\\d+)",
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
	"(js|ts|jsx|tsx|svelte|vue|py|rs|go|java|cpp|c|h|css|scss|less|html|json|yaml|yml|toml|lock|md|txt|sh|bash|zsh|fish)"
table.insert(config.hyperlink_rules, {
	regex = "([\\w\\-./]+[\\w\\-]\\." .. extensions .. ")",
	format = "file://$0",
	highlight = 0,
})

-- Keymaps matching tmux configuration
config.leader = { key = "a", mods = "CTRL", timeout_milliseconds = 1000 }
config.keys = {
	-- Disable default CMD-m to allow it to be handled by terminal
	{
		key = "m",
		mods = "CMD",
		action = wezterm.action.DisableDefaultAssignment,
	},

	-- Pane splitting (matching tmux)
	{
		key = "|",
		mods = "LEADER|SHIFT",
		action = wezterm.action.SplitHorizontal({ domain = "CurrentPaneDomain" }),
	},
	{
		key = "\\",
		mods = "LEADER|SHIFT",
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

	-- Reload configuration (matching tmux)
	{
		key = "r",
		mods = "LEADER",
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
		action = wezterm.action.ActivateCopyMode
	},
}

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

wezterm.on("format-tab-title", function(tab, tabs, panes, config, hover, max_width)
	local title = ""
	local padding = " "

	return padding .. title .. padding
end)

wezterm.on("update-right-status", function(window, pane)
	-- Prefer effective_config; it includes base config + overrides
	local cfg = window:effective_config()
	local colors = cfg.colors or {}

	-- Safe access with fallbacks
	local bg = colors.background or "#1b1b1b"
	local fg = colors.foreground or "#c0c0c0"

	window:set_right_status(wezterm.format({
		{ Background = { Color = bg } },
		{ Foreground = { Color = fg } },
		{ Text = (window:active_workspace() or "") .. " " },
	}))
end)

return config
