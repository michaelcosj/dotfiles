return {
	-- Treesitter
	{
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
	},

	-- Auto Completions
	{

		"saghen/blink.cmp",
		dependencies = {
			"rafamadriz/friendly-snippets",
			{ "xzbdmw/colorful-menu.nvim", opts = {} },
			"olimorris/codecompanion.nvim",
			"echasnovski/mini.icons",
			"giuxtaposition/blink-cmp-copilot",
		},
		-- use a release tag to download pre-built binaries
		version = "*",
		---@module 'blink.cmp'
		---@type blink.cmp.Config
		opts = {
			appearance = {
				use_nvim_cmp_as_default = false,
				nerd_font_variant = "mono",
			},
			signature = { enabled = true, window = { show_documentation = false, border = "rounded" } },
			sources = {
				default = { "minuet", "lazydev", "lsp", "path", "buffer", "snippets" },
				providers = {
					-- copilot = {
					--   name = "copilot",
					--   module = "blink-cmp-copilot",
					--   score_offset = 100,
					--   async = true,
					-- },
					minuet = {
						name = "minuet",
						module = "minuet.blink",
						async = true,
						-- Should match minuet.config.request_timeout * 1000,
						-- since minuet.config.request_timeout is in seconds
						timeout_ms = 3000,
						score_offset = 100, -- Gives minuet higher priority among suggestions
					},
					lazydev = {
						name = "LazyDev",
						module = "lazydev.integrations.blink",
						-- make lazydev completions top priority (see `:h blink.cmp`)
						score_offset = 100,
					},
					lsp = {
						fallbacks = {},
					},
					avante = {
						module = "blink-cmp-avante",
						name = "Avante",
						opts = {},
					},
				},
				per_filetype = {
					codecompanion = { "codecompanion", "path", "buffer" },
				},
			},
			completion = {
				documentation = { window = { border = "single" } },
				menu = {
					draw = {
						columns = { { "kind_icon" }, { "label", gap = 1 } },
						components = {
							kind_icon = {
								ellipsis = false,
								text = function(ctx)
									if ctx.source_name == "minuet" then
										return " "
									else
										local kind_icon, _, _ = require("mini.icons").get("lsp", ctx.kind)
										return kind_icon
									end
								end,
								highlight = function(ctx)
									local _, hl, _ = require("mini.icons").get("lsp", ctx.kind)
									return hl
								end,
							},
							label = {
								text = function(ctx)
									return require("colorful-menu").blink_components_text(ctx)
								end,
								highlight = function(ctx)
									return require("colorful-menu").blink_components_highlight(ctx)
								end,
							},
						},
					},
				},
				trigger = { prefetch_on_insert = false },
			},
		},
		opts_extend = { "sources.default" },
	},

	-- Formatting
	{
		"stevearc/conform.nvim",
		event = "BufWritePre",
		cmd = "ConformInfo",
		opts = {
			formatters_by_ft = {
				lua = { "stylua" },
				javascript = { "biome-check" },
				typescript = { "biome-check" },
				svelte = { "prettierd" },
				nix = { "nixfmt" },
				json = { "jq" },
				php = { "pint" },
			},
			-- too much trouble
			-- format_on_save = {
			-- 	timeout_ms = 500,
			-- 	lsp_format = "fallback",
			-- },
		},
		keys = {
			{
				"<leader>f",
				function()
					require("conform").format({ async = true, lsp_format = "fallback" })
				end,
			},
		},
	},

	-- LSP config
	{
		"neovim/nvim-lspconfig",
		dependencies = {
			{ "saghen/blink.cmp" },
			{
				"folke/lazydev.nvim",
				ft = "lua",
				opts = {
					library = {
						{ path = "${3rd}/luv/library", words = { "vim%.uv" } },
					},
				},
			},
		},
		opts = {
			servers = {
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
			},
		},
		config = function(_, opts)
			local lspconfig = require("lspconfig")

			for server, config in pairs(opts.servers) do
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

					vim.keymap.set("n", "gl", function()
						vim.diagnostic.setloclist({})
					end, { desc = "Diagnostics in quickfix list" })

					vim.keymap.set("n", "gq", function()
						vim.diagnostic.setloclist({})
					end, { desc = "Diagnostics in quickfix list" })
				end,
			})
		end,
	},
}
