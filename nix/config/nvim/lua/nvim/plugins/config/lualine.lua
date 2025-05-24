local M = {}

M.opts = function()
	-- based on [[https://yeripratama.com/blog/customizing-nvim-lualine/]]
	local colors = require("kanagawa.colors").setup()

	local conditions = {
		buffer_not_empty = function()
			return vim.fn.empty(vim.fn.expand("%:t")) ~= 1
		end,
		buffer_empty = function()
			return vim.fn.empty(vim.fn.expand("%:t")) == 1
		end,
		hide_in_width = function()
			return vim.fn.winwidth(0) > 80
		end,
		in_git = function()
			return Snacks.git.get_root() ~= nil
		end,
		diff_mode = function()
			return vim.o.diff == true
		end,
	}

	local config = {
		options = {
			component_separators = "",
			section_separators = "",
			theme = {
				normal = { c = { fg = colors.theme.ui.fg, bg = colors.theme.ui.bg_p1 } },
				inactive = { c = { fg = colors.theme.ui.fg_dim, bg = colors.theme.ui.bg_dim } },
			},
			disabled_filetypes = { "snacks_dashboard" },
			globalstatus = true,
		},
		sections = {
			lualine_a = {},
			lualine_b = {},
			lualine_y = {},
			lualine_z = {},
			lualine_c = {},
			lualine_x = { require("mcphub.extensions.lualine") },
		},
		inactive_sections = {
			lualine_a = { "filename" },
			lualine_b = {},
			lualine_y = {},
			lualine_z = {},
			lualine_c = {},
			lualine_x = {},
		},
	}

	local function insert_left(component)
		table.insert(config.sections.lualine_c, component)
	end

	local function insert_right(component)
		table.insert(config.sections.lualine_x, component)
	end

	insert_left({
		"filename",
		icon = "",
		color = { fg = colors.theme.ui.fg, bg = colors.theme.ui.bg_p1 },
	})

	insert_left({
		"branch",
		icon = "",
		color = { fg = colors.theme.ui.special, bg = colors.theme.ui.bg_p1, gui = "bold" },
	})

	insert_left({
		"diff",
		symbols = { added = " ", modified = " ", removed = " " },
		diff_color = {
			added = { fg = colors.theme.vcs.added },
			modified = { fg = colors.theme.vcs.changed },
			removed = { fg = colors.theme.vcs.removed },
		},
		cond = conditions.hide_in_width,
	})

	insert_left({
		"diagnostics",
		sources = { "nvim_diagnostic" },
		symbols = { error = " ", warn = " ", info = " " },
		diagnostics_color = {
			color_error = { fg = colors.theme.diag.error },
			color_warn = { fg = colors.theme.diag.warning },
			color_info = { fg = colors.theme.diag.info },
		},
	})

	insert_left({
		function()
			return "%="
		end,
	})

	insert_right({
		"overseer",
	})

	insert_right({
		"location",
		color = { fg = colors.theme.ui.fg_dim },
		cond = conditions.buffer_not_empty,
	})

	insert_right({
		"encoding",
	})

	insert_right({
		"filetype",
	})

	insert_right({
		require("noice").api.status.mode.get,
		color = { fg = colors.theme.diag.warning },
		cond = require("noice").api.status.mode.has,
	})

	return config
end

return M
