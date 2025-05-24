return {
	---[[ Visual Stuff ]]---
	{
		-- Color scheme
		{
			"rebelot/kanagawa.nvim",
			priority = 1000,
			opts = {
				overrides = function(colors)
					local theme = colors.theme
					return {
						Pmenu = { fg = theme.ui.shade0, bg = theme.ui.bg_p1 },
						PmenuSel = { fg = "NONE", bg = theme.ui.bg_p2 },
						PmenuSbar = { bg = theme.ui.bg_m1 },
						PmenuThumb = { bg = theme.ui.bg_p2 },
					}
				end,
			},
			init = function()
				vim.cmd("colorscheme kanagawa")
			end,
		},

		-- Todo Comments
		{
			"folke/todo-comments.nvim",
			events = "VimEnter",
			opts = {},
		},

		-- Status line
		{
			"nvim-lualine/lualine.nvim",
			dependencies = { "nvim-tree/nvim-web-devicons" },
			enabled = true,
			event = "VeryLazy",
			opts = require("nvim.plugins.config.lualine").opts,
		},

		-- Noice makes nvim fancy
		{
			"folke/noice.nvim",
			event = "VeryLazy",
			opts = {
				notify = {
					view = "mini",
				},
				presets = {
					bottom_search = true,
					command_palette = true,
					lsp_doc_border = true,
				},
			},
			dependencies = {
				"MunifTanjim/nui.nvim",
				"folke/snacks.nvim",
			},
		},

		-- Better Markdown rendering
		{
			"MeanderingProgrammer/render-markdown.nvim",
			ft = { "markdown", "codecompanion" },
		},

		-- Treesitter (I guess it's visual since it's about syntax highlighting)
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
	},

	---[[ Text Editing ]]---
	{

		-- Comments
		{ "echasnovski/mini.comment", version = "*", opts = {} },

		-- Auto pairs
		{ "echasnovski/mini.pairs", version = "*", opts = {} },

		-- Surround
		{ "echasnovski/mini.surround", version = "*", opts = {} },

		-- Completions
		{

			"saghen/blink.cmp",
			dependencies = {
				"rafamadriz/friendly-snippets",
				"onsails/lspkind.nvim",
				"nvim-tree/nvim-web-devicons",
				{ "xzbdmw/colorful-menu.nvim", opts = {} },
				"olimorris/codecompanion.nvim",
				"giuxtaposition/blink-cmp-copilot",
			},
			-- use a release tag to download pre-built binaries
			version = "*",
			---@module 'blink.cmp'
			---@type blink.cmp.Config
			opts = require("nvim.plugins.config.blink").opts,
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
	},

	---[[ Workflow ]]---
	{
		-- Task runner
		{
			"stevearc/overseer.nvim",
			opts = {
				strategy = "terminal",
				task_list = {
					max_height = nil,
					height = 0.3,
				},
			},
			cmd = {
				"OverseerDebugParser",
				"OverseerInfo",
				"OverseerOpen",
				"OverseerRun",
				"OverseerRunCmd",
				"OverseerToggle",
			},
			keys = {
				{
					"<leader>or",
					"<cmd>OverseerRun<cr>",
					desc = "[O]verseer [R]un",
				},
				{
					"<leader>ot",
					"<cmd>OverseerToggle<cr>",
					desc = "[O]verseer [T]oggle",
				},
			},
		},

		-- Which key
		{
			"folke/which-key.nvim",
			event = "VeryLazy",
			opts = {},
			keys = {
				{
					"<leader>?",
					function()
						require("which-key").show({ global = false })
					end,
					desc = "Buffer Local Keymaps (which-key)",
				},
			},
			init = function()
				local wk = require("which-key")
				wk.add({
					{ "<leader>f", group = "Find" },
					{ "<leader>a", group = "AI" },
					{ "<leader>b", group = "Buffer" },
					{ "<leader>g", group = "Git" },
					{ "<leader>h", group = "Git Signs" },
					{ "<leader>u", group = "Toggle" },
				})
			end,
		},

		-- Git signs and utils
		{
			"lewis6991/gitsigns.nvim",
			opts = {
				on_attach = require("nvim.plugins.config.gitsigns").on_attach,
			},
		},

		-- Snacks Nvim
		{
			"folke/snacks.nvim",
			dependencies = { "folke/todo-comments.nvim" },
			priority = 1000,
			lazy = false,
			---@type snacks.Config
			opts = require("nvim.plugins.config.snacks").opts,
			keys = require("nvim.plugins.config.snacks").keys,
			init = require("nvim.plugins.config.snacks").init,
		},

		-- Session Management
		{
			"folke/persistence.nvim",
			event = "BufReadPre",
			dependencies = { "stevearc/overseer.nvim" },
			opts = {},
			init = require("nvim.plugins.config.persistence").init,
		},
	},

	---[[ LSP stuff ]]---
	{
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
			config = require("nvim.plugins.config.lspconfig").config,
		},

		-- Asynchronous Lint Engine (for linters that don't have LSP support)
		{
			"dense-analysis/ale",
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
		},
	},

	---[[ AI ]]---
	{
		-- Github Copilot
		{
			"zbirenbaum/copilot.lua",
			event = "InsertEnter",
			enabled = false,
			opts = {
				suggestion = { enabled = false },
				panel = { enabled = false },
			},
		},

		-- Code companion (My cursor)
		{
			"olimorris/codecompanion.nvim",
			dependencies = {
				"nvim-lua/plenary.nvim",
				"nvim-treesitter/nvim-treesitter",
				"folke/noice.nvim",
			},
			opts = require("nvim.plugins.config.codecompanion").opts,
			init = require("nvim.plugins.config.codecompanion").init,
		},

		-- MCP Hub
		{
			"ravitemer/mcphub.nvim",
			dependencies = {
				"nvim-lua/plenary.nvim",
			},
			cmd = "MCPHub",
			build = "npm install -g mcp-hub@latest",
			opts = require("nvim.plugins.config.mcphub").opts,
		},
	},
}
