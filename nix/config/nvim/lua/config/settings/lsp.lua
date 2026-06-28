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
	group = vim.api.nvim_create_augroup("nvim_lsp_attach", { clear = true }),
	callback = function(ev)
		if vim.b[ev.buf].disable_lsp then
			vim.diagnostic.enable(false, { bufnr = ev.buf })
			vim.lsp.buf_detach_client(ev.buf, ev.data.client_id)
			return
		end

		local opts = { buffer = ev.buf }

		-- LSP keymaps
		vim.keymap.set("n", "cd", function()
			vim.lsp.buf.rename()
		end, vim.tbl_extend("force", opts, { desc = "Rename item under the cursor" }))

		-- Using rachartier/tiny-code-action.nvim for code actions
		-- vim.keymap.set("n", "g.", function()
		-- 	vim.lsp.buf.code_action()
		-- end, { desc = "Code Actions" })

		vim.keymap.set("n", "K", function()
			vim.lsp.buf.hover({ border = "rounded" })
		end, vim.tbl_extend("force", opts, { desc = "Documentation hover floating window" }))

		vim.keymap.set("n", "gl", function()
			vim.diagnostic.setloclist({})
		end, vim.tbl_extend("force", opts, { desc = "Diagnostics in quickfix list" }))

		vim.keymap.set("n", "gq", function()
			vim.diagnostic.setloclist({})
		end, vim.tbl_extend("force", opts, { desc = "Diagnostics in quickfix list" }))

		vim.keymap.set("n", "<leader>d", function()
			vim.diagnostic.open_float(nil, {
				border = "rounded",
			})
		end, vim.tbl_extend("force", opts, { desc = "Open diagnostic float" }))
	end,
})

-- Disable LSP features for files above 500kb
local disable_lsp_file_size_limit = 500 * 1024
vim.api.nvim_create_autocmd("BufReadPre", {
	group = vim.api.nvim_create_augroup("nvim_disable_lsp_large_files", { clear = true }),
	callback = function()
		local size = vim.fn.getfsize(vim.fn.expand("%:p"))
		if size > disable_lsp_file_size_limit then
			vim.b.disable_lsp = true
			vim.diagnostic.enable(false, { bufnr = 0 })
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
