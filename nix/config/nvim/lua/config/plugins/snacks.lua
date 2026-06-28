require("config.helpers").safeSetup("snacks", {
	animate = { enabled = true, duration = 1 },
	bigfile = { enabled = true },
	explorer = {
		enabled = true,
		wo = {
			cursorline = true,
		},
	},
	image = {
		enabled = false,
		convert = {
			notify = true,
		},
	},
	indent = {
		enabled = true,
		indent = { only_scope = false },
		chunk = { enabled = true },
		animate = { enabled = true },
	},
	input = {
		enabled = true,
		win = {
			position = "float",
			relative = "cursor",
			row = -3,
			col = 0,
			wo = {
				cursorline = false,
			},
		},
	},
	lazygit = {
		configure = true,
		config = {
			os = {
				editPreset = "nvim-remote",
				open = "nvim-remote",
				editAtLine = "nvim-remote",
				openDirInEditor = "nvim-remote",
			},
			gui = {
				nerdFontsVersion = "3",
			},
		},
	},
	notifier = { enabled = true, style = "compact" },
	picker = {
		enabled = true,
		ui_select = true,
		matcher = {
			frecency = true,
		},
		layout = {
			preset = "ivy",
			cycle = false,
		},
		layouts = {
			ivy = {
				layout = {
					height = 0.5,
				},
			},
		},
	},
	quickfile = { enabled = true },
	scope = { enabled = true },
	scroll = {
		enabled = true,
		animate = {
			duration = { step = 15, total = 250 },
			easing = "linear",
		},
		animate_repeat = {
			delay = 100,
			duration = { step = 5, total = 50 },
			easing = "linear",
		},
		filter = function(buf)
			return vim.g.snacks_scroll ~= false
				and vim.b[buf].snacks_scroll ~= false
				and vim.bo[buf].buftype ~= "terminal"
		end,
	},
	statuscolumn = { enabled = true, git = { patterns = { "GitSigns" } } },
	words = { enabled = true },
	terminal = {
		win = {
			border = "rounded",
			position = "float",
			height = 0.8,
			width = 0.8,
			wo = {
				winhighlight = "Normal:Normal,FloatBorder:Normal",
			},
		},
	},
	styles = {},
	dashboard = {
		enabled = true,
		preset = {
			keys = {
				{ icon = "", key = "f", desc = "find file", action = ":lua Snacks.dashboard.pick('files')" },
				{ icon = "", key = "n", desc = "new file", action = ":ene | startinsert" },
				{ icon = "", key = "g", desc = "grep text", action = ":lua Snacks.dashboard.pick('live_grep')" },
				{
					icon = "",
					key = "r",
					desc = "recent file",
					action = ":lua Snacks.dashboard.pick('oldfiles')",
				},
				{
					icon = "",
					key = "c",
					desc = "config",
					action = ":lua Snacks.dashboard.pick('files', {cwd = vim.fn.stdpath('config')})",
				},
				-- { icon = "󰒲", key = "L", desc = "lazy", action = ":Lazy", enabled = package.loaded.lazy ~= nil },
				{ icon = "󰈆", key = "q", desc = "quit", action = ":qa" },
			},
			header = [[
  ⣇⣿⠘⣿⣿⣿⡿⡿⣟⣟⢟⢟⢝⠵⡝⣿⡿⢂⣼⣿⣷⣌⠩⡫⡻⣝⠹⢿⣿⣷
  ⡆⣿⣆⠱⣝⡵⣝⢅⠙⣿⢕⢕⢕⢕⢝⣥⢒⠅⣿⣿⣿⡿⣳⣌⠪⡪⣡⢑⢝⣇
  ⡆⣿⣿⣦⠹⣳⣳⣕⢅⠈⢗⢕⢕⢕⢕⢕⢈⢆⠟⠋⠉⠁⠉⠉⠁⠈⠼⢐⢕⢽
  ⡗⢰⣶⣶⣦⣝⢝⢕⢕⠅⡆⢕⢕⢕⢕⢕⣴⠏⣠⡶⠛⡉⡉⡛⢶⣦⡀⠐⣕⢕
  ⡝⡄⢻⢟⣿⣿⣷⣕⣕⣅⣿⣔⣕⣵⣵⣿⣿⢠⣿⢠⣮⡈⣌⠨⠅⠹⣷⡀⢱⢕
  ⡝⡵⠟⠈⢀⣀⣀⡀⠉⢿⣿⣿⣿⣿⣿⣿⣿⣼⣿⢈⡋⠴⢿⡟⣡⡇⣿⡇⡀⢕
  ⡝⠁⣠⣾⠟⡉⡉⡉⠻⣦⣻⣿⣿⣿⣿⣿⣿⣿⣿⣧⠸⣿⣦⣥⣿⡇⡿⣰⢗⢄
  ⠁⢰⣿⡏⣴⣌⠈⣌⠡⠈⢻⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣬⣉⣉⣁⣄⢖⢕⢕⢕
  ⡀⢻⣿⡇⢙⠁⠴⢿⡟⣡⡆⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣵⣵⣿
  ⡻⣄⣻⣿⣌⠘⢿⣷⣥⣿⠇⣿⣿⣿⣿⣿⣿⠛⠻⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿
  ⣷⢄⠻⣿⣟⠿⠦⠍⠉⣡⣾⣿⣿⣿⣿⣿⣿⢸⣿⣦⠙⣿⣿⣿⣿⣿⣿⣿⣿⠟
  ⡕⡑⣑⣈⣻⢗⢟⢞⢝⣻⣿⣿⣿⣿⣿⣿⣿⠸⣿⠿⠃⣿⣿⣿⣿⣿⣿⡿⠁⣠
  ⡝⡵⡈⢟⢕⢕⢕⢕⣵⣿⣿⣿⣿⣿⣿⣿⣿⣿⣶⣶⣿⣿⣿⣿⣿⠿⠋⣀⣈⠙
  ⡝⡵⡕⡀⠑⠳⠿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠿⠛⢉⡠⡲⡫⡪⡪⡣ 
			]],
		},
		formats = {
			header = {
				align = "left",
			},
		},
		sections = {
			{
				section = "header",
				padding = 6,
			},
			{
				pane = 2,
				padding = 1,
				{
					{ section = "keys", gap = 1, padding = 1 },
					{ section = "startup", icon = "󱐌 ", gap = 1, padding = 1 },
				},
			},
		},
	},
	dim = { enabled = true },
	win = {
		backdrop = { transparent = true, blend = 100 },
	},
})

require("config.plugins.snacks.keymaps")
require("config.plugins.snacks.autocmds")
require("config.plugins.snacks.lsp-progress")
