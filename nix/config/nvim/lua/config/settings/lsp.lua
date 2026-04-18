-- Enabled configs
vim.lsp.enable({
	"cssls",
	"html",
	"intelephense",
	"jsonls",
	"lua_ls",
	"nixd",
	"oxlint",
	"svelte",
	"tsgo",
})

-- On attach autocmd
vim.api.nvim_create_autocmd("LspAttach", {
	callback = function(ev)
		-- LSP keymaps
		vim.keymap.set("n", "cd", function()
			vim.lsp.buf.rename()
		end, { desc = "Rename item under the cusor" })

		-- Using rachartier/tiny-code-action.nvim for code actions
		-- vim.keymap.set("n", "g.", function()
		-- 	vim.lsp.buf.code_action()
		-- end, { desc = "Code Actions" })

		vim.keymap.set("n", "K", function()
			vim.lsp.buf.hover({ border = "rounded" })
		end, { desc = "Documentation hover floating window" })

		vim.keymap.set("n", "gl", function()
			vim.diagnostic.setloclist({})
		end, { desc = "Diagnostics in quickfix list" })

		vim.keymap.set("n", "gq", function()
			vim.diagnostic.setloclist({})
		end, { desc = "Diagnostics in quickfix list" })

		vim.keymap.set("n", "<leader>d", function()
			vim.diagnostic.open_float(nil, {
				border = "rounded",
			})
		end, { desc = "Open diagnostic float" })
	end,
})

-- Disable LSP features for files above 500kb
local disable_lsp_file_size_limit = 500 * 1024
vim.api.nvim_create_autocmd("BufReadPre", {
	callback = function()
		local size = vim.fn.getfsize(vim.fn.expand("%:p"))
		if size > disable_lsp_file_size_limit then
			-- Disable diagnostics for the buffer
			vim.diagnostic.enable(false, { bufnr = 0 })

			-- Detach LSP clients for this buffer
			local clients = vim.lsp.get_clients({ bufnr = 0 })
			for _, client in ipairs(clients) do
				vim.lsp.buf_detach_client(0, client.id)
			end
		end
	end,
})

-- Auto open diagnostic float
vim.api.nvim_create_autocmd({ "CursorHold", "CursorHoldI" }, {
	group = vim.api.nvim_create_augroup("float_diagnostic", { clear = true }),
	callback = function()
		vim.schedule(function()
			vim.diagnostic.open_float(nil, {
				focus = false,
				border = "rounded",
			})
		end)
	end,
})
