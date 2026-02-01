return {
	"stevearc/conform.nvim",
	event = "BufWritePre",
	cmd = "ConformInfo",
	opts = {
		formatters_by_ft = {
			lua = { "stylua" },
			javascript = { "biome-check" },
			typescript = { "biome-check" },
			nix = { "nixfmt" },
			json = { "jq" },
			jsonc = { "jq" },
			php = { "pint" },
			svelte = { "prettier" },
		},
		-- too much trouble
		-- format_on_save = {
		-- 	timeout_ms = 500,
		-- 	lsp_format = "fallback",
		-- },
	},
	keys = {
		{
			"<leader>ff",
			function()
				require("conform").format({ async = true, lsp_format = "fallback" })
			end,
			mode = { "n", "v" },
			desc = "Format Code",
		},
	},
}
