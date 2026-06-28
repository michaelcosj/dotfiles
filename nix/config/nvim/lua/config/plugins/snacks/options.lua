return {
	animate = { enabled = true, duration = 1 },
	bigfile = { enabled = true },
	explorer = {
		enabled = true,
		wo = {
			cursorline = true,
		},
	},
	image = {
		enabled = true,
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
		enabled = false,
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
	styles = {},
	dim = { enabled = true },
	win = {
		backdrop = { transparent = true, blend = 100 },
	},
}
