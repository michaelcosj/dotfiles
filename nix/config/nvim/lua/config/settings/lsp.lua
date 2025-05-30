-- Enabled configs
vim.lsp.enable({
	"biome",
	"intelephense",
	"jsonls",
	"lua_ls",
	"nixd",
	"svelte",
	"ts_ls",
})

-- On attach autocmd
vim.api.nvim_create_autocmd("LspAttach", {
	callback = function(ev)
		-- LSP keymaps
		vim.keymap.set("n", "cd", function()
			vim.lsp.buf.rename()
		end, { desc = "Rename item under the cusor" })

		vim.keymap.set("n", "g.", function()
			vim.lsp.buf.code_action()
		end, { desc = "Code Actions" })

		vim.keymap.set("n", "K", function()
			vim.lsp.buf.hover()
		end, { desc = "Documentation hover floating window" })

		vim.keymap.set("n", "gl", function()
			vim.diagnostic.setloclist({})
		end, { desc = "Diagnostics in quickfix list" })

		vim.keymap.set("n", "gq", function()
			vim.diagnostic.setloclist({})
		end, { desc = "Diagnostics in quickfix list" })
	end,
})
