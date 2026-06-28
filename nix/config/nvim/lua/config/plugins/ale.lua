local gh = require("config.helpers").gh

vim.api.nvim_create_autocmd("FileType", {
	pattern = "php",
	callback = function()
		vim.pack.add({ gh("dense-analysis/ale") })

		local g = vim.g

		g.ale_linters = {
			php = { "phpstan" },
		}

		g.ale_linters_explicit = 1
		g.ale_echo_cursor = 0
		g.ale_use_neovim_diagnostics_api = 1
	end,
})
