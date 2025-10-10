local wezterm = require("wezterm")
local config = wezterm.config_builder()

config.font_size = 13

-- Colorscheme (https://github.com/rebelot/kanagawa.nvim/blob/master/extras/wezterm/kanagawa-dragon.lua)

config.colors = {
	foreground = "#c5c9c5",
	background = "#181616",

	cursor_bg = "#C8C093",
	cursor_fg = "#C8C093",
	cursor_border = "#C8C093",

	selection_fg = "#C8C093",
	selection_bg = "#2D4F67",

	scrollbar_thumb = "#16161D",
	split = "#16161D",

	ansi = {
		"#0D0C0C",
		"#C4746E",
		"#8A9A7B",
		"#C4B28A",
		"#8BA4B0",
		"#A292A3",
		"#8EA4A2",
		"#C8C093",
	},

	brights = {
		"#A6A69C",
		"#E46876",
		"#87A987",
		"#E6C384",
		"#7FB4CA",
		"#938AA9",
		"#7AA89F",
		"#C5C9C5",
	},

	tab_bar = {
		background = "#181616",
	},
}

config.force_reverse_video_cursor = true

-- Command pallete
config.command_palette_bg_color = config.colors.background
config.command_palette_fg_color = config.colors.foreground
config.command_palette_rows = 5

-- Tab bar
config.hide_tab_bar_if_only_one_tab = false
config.show_new_tab_button_in_tab_bar = false
config.use_fancy_tab_bar = false

-- Panes
config.inactive_pane_hsb = {
	saturation = 0.8,
	brightness = 0.7,
}

-- Windows
config.window_decorations = "RESIZE"
config.window_background_opacity = 0.8
config.macos_window_background_blur = 50

local mux = wezterm.mux
wezterm.on("gui-attached", function(domain)
	local workspace = mux.get_active_workspace()
	for _, window in ipairs(mux.all_windows()) do
		if window:get_workspace() == workspace then
			window:gui_window():maximize()
		end
	end
end)

return config
