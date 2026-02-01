return {
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
}
