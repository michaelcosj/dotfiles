require("config.helpers").safeSetup("conform", {
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
})

vim.keymap.set({ "n", "v" }, "<leader>ff", function()
	require("conform").format({ async = true, lsp_format = "fallback" })
end, { desc = "Format Code" })
