return {
	{
		"nvim-treesitter/nvim-treesitter",
		build = ":TSUpdate",
		opts = function()
			require("nvim-treesitter.configs").setup({
				ensure_installed = {
					"bash",
					"c",
					"cpp",
					"css",
					"dockerfile",
					"go",
					"html",
					"javascript",
					"json",
					"lua",
					"markdown",
					"python",
					"rust",
					"sql",
					"typescript",
					"yaml",
				},
				modules = {},

				auto_install = false,
				sync_install = false,
				ignore_install = {},

				highlight = {
					enable = true,
					additional_vim_regex_highlighting = false,
					disable = function(_, buf)
						local max_filesize = 500 * 1024 -- 100 KB
						local ok, stats = pcall(vim.loop.fs_stat, vim.api.nvim_buf_get_name(buf))
						if ok and stats and stats.size > max_filesize then
							return true
						end
					end,
				},
				indent = { enable = true },
			})
		end,
	},
	{
		"nvim-treesitter/nvim-treesitter-context",
		opts = {
			enable = false,
			multiwindow = false,
			max_lines = 0,
			min_window_height = 0,
			line_numbers = true,
			multiline_threshold = 20,
			trim_scope = "outer",
			mode = "cursor",
			separator = nil,
			zindex = 20,
			on_attach = nil,
		},
		init = function()
			vim.keymap.set("n", "[t", function()
				require("treesitter-context").go_to_context(vim.v.count1)
			end, { silent = true })
		end,
	},
}
