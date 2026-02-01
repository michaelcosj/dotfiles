return {
	"dense-analysis/ale",
	ft = "php",
	config = function()
		local g = vim.g

		g.ale_linters = {
			php = { "phpstan" },
		}
		--  Only run linters named in ale_linters settings.
		g.ale_linters_explicit = 1

		-- turn off echo errors
		g.ale_echo_cursor = 0

		-- display diagnostics through neovim
		g.ale_use_neovim_diagnostics_api = 1
	end,
}
