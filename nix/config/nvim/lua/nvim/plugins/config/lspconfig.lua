local M = {}

local servers = {
	biome = {},
	intelephense = {},
	lua_ls = {},
	nixd = {},
	jsonls = {
		cmd = {
			"/Users/synth/.local/state/fnm_multishells/26685_1737249628581/bin/vscode-json-languageserver",
			"--stdio",
		},
	},
	ts_ls = {
		settings = {
			typescript = {
				tsserver = {
					useSyntaxServer = false,
					maxTsServerMemory = 8192,
				},
				inlayHints = {
					includeInlayParameterNameHints = "all",
					includeInlayParameterNameHintsWhenArgumentMatchesName = false,
					includeInlayFunctionParameterTypeHints = true,
					includeInlayVariableTypeHints = true,
					includeInlayVariableTypeHintsWhenTypeMatchesName = false,
					includeInlayPropertyDeclarationTypeHints = false,
					includeInlayFunctionLikeReturnTypeHints = false,
					includeInlayEnumMemberValueHints = false,
				},
			},
		},
	},
}

M.config = function()
	local lspconfig = require("lspconfig")

	for server, config in pairs(servers) do
		-- Completion setup [[https://cmp.saghen.dev/installation.html]]
		config.capabilities = require("blink.cmp").get_lsp_capabilities(config.capabilities)

		lspconfig[server].setup(config)
	end

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
							Snacks.notify.warn("LSP Disabled for large file > 500KB")
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
		end,
	})
end

return M
