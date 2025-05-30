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

	-- Lua ls setup for Neovim
	{
		"folke/lazydev.nvim",
		ft = "lua",
		opts = {
			library = {
				{ path = "${3rd}/luv/library", words = { "vim%.uv" } },
			},
		},
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
			{ "folke/lazydev.nvim" },
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
				default = { "lazydev", "lsp", "minuet", "path", "buffer", "snippets" },
				providers = {
					minuet = {
						name = "minuet",
						module = "minuet.blink",
						async = true,
						timeout_ms = 3000, -- Should match minuet.config.request_timeout * 1000,
						score_offset = 50,
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
				},
				per_filetype = {
					codecompanion = { "codecompanion", "path", "buffer" },
				},
			},
			completion = {
				documentation = { window = { border = "single" } },
				ghost_text = {
					enabled = false,
					show_with_menu = true,
				},
				menu = {
					auto_show = true,
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
				list = {
					selection = {
						auto_insert = false,
					},
				},
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
				jsonc = { "jq" },
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
				mode = { "n", "v" },
				desc = "Format Code",
			},
		},
	},
}
