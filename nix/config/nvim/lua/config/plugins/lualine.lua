local ok, lualine = pcall(require, "lualine")

if not ok then
	return
end

lualine.setup({
	options = {
		theme = "auto",
		component_separators = "",
		section_separators = "",
		disabled_filetypes = { "snacks_dashboard" },
		globalstatus = true,
	},
	sections = {
		lualine_a = { "mode" },
		lualine_b = {
			"branch",
		},
		lualine_c = {
			"diff",
			"diagnostics",
		},
		lualine_x = {
			"location",
			"searchcount",
			"selectedcount",
			{
				"macro",
				fmt = function()
					local reg = vim.fn.reg_recording()
					if reg ~= "" then
						return "Recording @" .. reg
					end
					return nil
				end,
				color = { fg = "#ff9e64" },
				draw_empty = false,
			},
			"overseer",
			{
				function()
					return require("config.pi-bridge").statusline()
				end,
				cond = function()
					return vim.env.HERDR_WORKSPACE_ID ~= nil
				end,
			},
		},
		lualine_y = {
			"progress",
		},
		lualine_z = {
			"filename",
		},
	},
	inactive_sections = {
		lualine_a = {},
		lualine_b = {},
		lualine_y = {},
		lualine_z = {},
		lualine_c = {},
		lualine_x = {},
	},
})
