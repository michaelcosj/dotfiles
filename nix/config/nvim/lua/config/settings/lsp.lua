-- Enabled configs
vim.lsp.enable({
	"ts_ls",
	"jsonls",
	"nixd",
	"lua_ls",
	"intelephense",
	"biome",
})

-- On attach autocmd
vim.api.nvim_create_autocmd("LspAttach", {
	callback = function(ev)
		-- Turn off LSP for large typescript files > 500KB
		-- because tsserver is very slow and frustrating to work with

		local file_type = vim.bo.filetype

		if file_type == "typescript" then
			local max_file_size = 500 * 1024 -- 500kb

			local ok, stats = pcall(vim.loop.fs_stat, vim.api.nvim_buf_get_name(ev.buf))
			if ok and stats and stats.size > max_file_size then
				vim.schedule(function()
					local client = vim.lsp.get_client_by_id(ev.data.client_id)
					if client then
						vim.lsp.buf_detach_client(ev.buf, ev.data.client_id)
					end
				end)
				return
			end
		end

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
