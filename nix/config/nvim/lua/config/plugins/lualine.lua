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
		-- branch and diff from gitsigns: lualine's own run git on every BufEnter
		lualine_b = {
			{ "b:gitsigns_head", icon = "" },
		},
		lualine_c = {
			{
				"diff",
				source = function()
					local g = vim.b.gitsigns_status_dict
					return g and { added = g.added, modified = g.changed, removed = g.removed }
				end,
			},
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
			-- 󰚩 pi ○/●/⏳ · 󰁌 follow · Δn files to review (all clickable)
			unpack(require("config.agent-bridge").lualine()),
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
