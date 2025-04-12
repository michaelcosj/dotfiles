-- [[ Plugin Autocmds ]]
-- -- Highlights for avante
vim.api.nvim_create_autocmd("FileType", {
	pattern = "Avante",
	group = vim.api.nvim_create_augroup("avante_highlights", { clear = true }),
	callback = function()
		vim.api.nvim_set_hl(0, "AvanteSidebarNormal", { link = "Normal" })
		vim.api.nvim_set_hl(0, "AvanteSidebarWinSeparator", { link = "WinSeparator" })

		local normal_bg = string.format("#%06x", vim.api.nvim_get_hl(0, { name = "Normal" }).bg)
		vim.api.nvim_set_hl(0, "AvanteSidebarWinHorizontalSeparator", { fg = normal_bg })
	end,
})

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
			opts = function()
				-- based on [[https://yeripratama.com/blog/customizing-nvim-lualine/]]
				local colors = require("kanagawa.colors").setup()

				local conditions = {
					buffer_not_empty = function()
						return vim.fn.empty(vim.fn.expand("%:t")) ~= 1
					end,
					buffer_empty = function()
						return vim.fn.empty(vim.fn.expand("%:t")) == 1
					end,
					hide_in_width = function()
						return vim.fn.winwidth(0) > 80
					end,
					in_git = function()
						return Snacks.git.get_root() ~= nil
					end,
					diff_mode = function()
						return vim.o.diff == true
					end,
				}

				local config = {
					options = {
						component_separators = "",
						section_separators = "",
						theme = {
							normal = { c = { fg = colors.theme.ui.fg, bg = colors.theme.ui.bg_p1 } },
							inactive = { c = { fg = colors.theme.ui.fg_dim, bg = colors.theme.ui.bg_dim } },
						},
						disabled_filetypes = { "snacks_dashboard" },
						globalstatus = true,
					},
					sections = {
						lualine_a = {},
						lualine_b = {},
						lualine_y = {},
						lualine_z = {},
						lualine_c = {},
						lualine_x = {},
					},
					inactive_sections = {
						lualine_a = { "filename" },
						lualine_b = {},
						lualine_y = {},
						lualine_z = {},
						lualine_c = {},
						lualine_x = {},
					},
				}

				local function insert_left(component)
					table.insert(config.sections.lualine_c, component)
				end

				local function insert_right(component)
					table.insert(config.sections.lualine_x, component)
				end

				insert_left({
					"filename",
					icon = "",
					color = { fg = colors.theme.ui.fg, bg = colors.theme.ui.bg_p1 },
				})

				insert_left({
					"branch",
					icon = "",
					color = { fg = colors.theme.ui.special, bg = colors.theme.ui.bg_p1, gui = "bold" },
				})

				insert_left({
					"diff",
					symbols = { added = " ", modified = " ", removed = " " },
					diff_color = {
						added = { fg = colors.theme.vcs.added },
						modified = { fg = colors.theme.vcs.changed },
						removed = { fg = colors.theme.vcs.removed },
					},
					cond = conditions.hide_in_width,
				})

				insert_left({
					"diagnostics",
					sources = { "nvim_diagnostic" },
					symbols = { error = " ", warn = " ", info = " " },
					diagnostics_color = {
						color_error = { fg = colors.theme.diag.error },
						color_warn = { fg = colors.theme.diag.warning },
						color_info = { fg = colors.theme.diag.info },
					},
				})

				insert_left({
					function()
						return "%="
					end,
				})

				insert_right({
					"overseer",
				})

				insert_right({
					"location",
					color = { fg = colors.theme.ui.fg_dim },
					cond = conditions.buffer_not_empty,
				})

				insert_right({
					"encoding",
				})

				insert_right({
					"filetype",
				})

				insert_right({
					require("noice").api.status.mode.get,
					color = { fg = colors.theme.diag.warning },
					cond = require("noice").api.status.mode.has,
				})

				return config
			end,
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
				"Kaiser-Yang/blink-cmp-avante",
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
					default = { "avante", "lazydev", "lsp", "path", "buffer", "snippets" },
					providers = {
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
						codecompanion = { "codecompanion" },
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
										local lspkind = require("lspkind")
										local icon = ctx.kind_icon

										if vim.tbl_contains({ "Path" }, ctx.source_name) then
											local dev_icon, _ = require("nvim-web-devicons").get_icon(ctx.label)
											if dev_icon then
												icon = dev_icon
											end
										elseif vim.tbl_contains({ "Avante" }, ctx.source_name) then
											icon = " "
										else
											icon = require("lspkind").symbolic(ctx.kind, {
												mode = "symbol",
											})
										end

										return icon .. ctx.icon_gap
									end,

									-- Optionally, use the highlight groups from nvim-web-devicons
									-- You can also add the same function for `kind.highlight` if you want to
									-- keep the highlight groups in sync with the icons.
									highlight = function(ctx)
										local hl = ctx.kind_hl
										if vim.tbl_contains({ "Path" }, ctx.source_name) then
											local dev_icon, dev_hl = require("nvim-web-devicons").get_icon(ctx.label)
											if dev_icon then
												hl = dev_hl
											end
										end
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
				format_on_save = {
					timeout_ms = 500,
					lsp_format = "fallback",
				},
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
		},

		-- Git signs and utils
		{
			"lewis6991/gitsigns.nvim",
			opts = {
				on_attach = function(bufnr)
					local gitsigns = require("gitsigns")

					local function map(mode, l, r, opts)
						opts = opts or {}
						opts.buffer = bufnr
						vim.keymap.set(mode, l, r, opts)
					end

					-- Navigation
					map("n", "]c", function()
						if vim.wo.diff then
							vim.cmd.normal({ "]c", bang = true })
						else
							gitsigns.nav_hunk("next")
						end
					end, { desc = "Next Hunk" })

					map("n", "[c", function()
						if vim.wo.diff then
							vim.cmd.normal({ "[c", bang = true })
						else
							gitsigns.nav_hunk("prev")
						end
					end, { desc = "Previous Hunk" })

					-- Actions
					map("n", "<leader>hs", gitsigns.stage_hunk, { desc = "Stage Hunk" })
					map("n", "<leader>hr", gitsigns.reset_hunk, { desc = "Reset Hunk" })

					map("v", "<leader>hs", function()
						gitsigns.stage_hunk({ vim.fn.line("."), vim.fn.line("v") })
					end, { desc = "Stage Hunk" })

					map("v", "<leader>hr", function()
						gitsigns.reset_hunk({ vim.fn.line("."), vim.fn.line("v") })
					end, { desc = "Reset Hunk" })

					map("n", "<leader>hS", gitsigns.stage_buffer, { desc = "Stage Buffer" })
					map("n", "<leader>hR", gitsigns.reset_buffer, { desc = "Reset Buffer" })
					map("n", "<leader>hp", gitsigns.preview_hunk, { desc = "Preview Hunk" })
					map("n", "<leader>hi", gitsigns.preview_hunk_inline, { desc = "Preview Hunk Inline" })

					map("n", "<leader>hb", function()
						gitsigns.blame_line({ full = true })
					end, { desc = "Blame Line" })

					-- Toggles
					map("n", "<leader>htb", gitsigns.toggle_current_line_blame, { desc = "Toggle Blame Line" })
					map("n", "<leader>htw", gitsigns.toggle_word_diff, { desc = "Toggle Word Diff" })

					-- Text object
					map({ "o", "x" }, "ih", gitsigns.select_hunk, { desc = "Select Hunk" })
				end,
			},
		},

		-- Snacks Nvim
		{
			"folke/snacks.nvim",
			dependencies = { "folke/todo-comments.nvim" },
			priority = 1000,
			lazy = false,
			---@type snacks.Config
			opts = {
				animate = { enabled = true, duration = 1 },
				bigfile = { enabled = true },
				dashboard = {
					enabled = true,
					preset = {
						keys = {
							{ icon = "󰦛 ", key = "s", desc = "Restore Session", section = "session" },
							{ icon = " ", key = "q", desc = "Quit", action = ":qa" },
						},
						header = [[
⣇⣿⠘⣿⣿⣿⡿⡿⣟⣟⢟⢟⢝⠵⡝⣿⡿⢂⣼⣿⣷⣌⠩⡫⡻⣝⠹⢿⣿⣷
⡆⣿⣆⠱⣝⡵⣝⢅⠙⣿⢕⢕⢕⢕⢝⣥⢒⠅⣿⣿⣿⡿⣳⣌⠪⡪⣡⢑⢝⣇
⡆⣿⣿⣦⠹⣳⣳⣕⢅⠈⢗⢕⢕⢕⢕⢕⢈⢆⠟⠋⠉⠁⠉⠉⠁⠈⠼⢐⢕⢽
⡗⢰⣶⣶⣦⣝⢝⢕⢕⠅⡆⢕⢕⢕⢕⢕⣴⠏⣠⡶⠛⡉⡉⡛⢶⣦⡀⠐⣕⢕
⡝⡄⢻⢟⣿⣿⣷⣕⣕⣅⣿⣔⣕⣵⣵⣿⣿⢠⣿⢠⣮⡈⣌⠨⠅⠹⣷⡀⢱⢕
⡝⡵⠟⠈⢀⣀⣀⡀⠉⢿⣿⣿⣿⣿⣿⣿⣿⣼⣿⢈⡋⠴⢿⡟⣡⡇⣿⡇⡀⢕
⡝⠁⣠⣾⠟⡉⡉⡉⠻⣦⣻⣿⣿⣿⣿⣿⣿⣿⣿⣧⠸⣿⣦⣥⣿⡇⡿⣰⢗⢄
⠁⢰⣿⡏⣴⣌⠈⣌⠡⠈⢻⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣬⣉⣉⣁⣄⢖⢕⢕⢕
⡀⢻⣿⡇⢙⠁⠴⢿⡟⣡⡆⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣵⣵⣿
⡻⣄⣻⣿⣌⠘⢿⣷⣥⣿⠇⣿⣿⣿⣿⣿⣿⠛⠻⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿
⣷⢄⠻⣿⣟⠿⠦⠍⠉⣡⣾⣿⣿⣿⣿⣿⣿⢸⣿⣦⠙⣿⣿⣿⣿⣿⣿⣿⣿⠟
⡕⡑⣑⣈⣻⢗⢟⢞⢝⣻⣿⣿⣿⣿⣿⣿⣿⠸⣿⠿⠃⣿⣿⣿⣿⣿⣿⡿⠁⣠
⡝⡵⡈⢟⢕⢕⢕⢕⣵⣿⣿⣿⣿⣿⣿⣿⣿⣿⣶⣶⣿⣿⣿⣿⣿⠿⠋⣀⣈⠙
⡝⡵⡕⡀⠑⠳⠿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠿⠛⢉⡠⡲⡫⡪⡪⡣ 
]],
					},
					sections = {
						{ section = "header" },
						{
							text = { { "Ad Astra Per Aspera", hl = "special" } },
							align = "center",
						},
						{
							text = { { os.date("%A %B, %Y") .. "", hl = "key" } },
							align = "center",
							padding = 1,
						},
						{ section = "projects", title = " Projects", padding = 2, indent = 2 },
						{ section = "recent_files", title = " Recent Files", padding = 1, indent = 2 },
						{ section = "keys", padding = 2 },
						{ section = "startup" },
					},
					pane_gap = 10,
				},
				explorer = {
					enabled = true,
					wo = {
						cursorline = true,
					},
				},
				indent = { enabled = true },
				input = {
					enabled = true,
					win = {
						position = "float",
						relative = "cursor",
						row = -3,
						col = 0,
						wo = {
							cursorline = false,
						},
					},
				},
				notifier = { enabled = false },
				picker = {
					enabled = true,
					ui_select = true,
					matcher = {
						frecency = true,
					},
					layout = {
						preset = "ivy",
						cycle = false,
					},
					layouts = {
						ivy = {
							layout = {
								height = 0.5,
							},
						},
					},
				},
				quickfile = { enabled = true },
				scope = { enabled = true },
				scroll = {
					enabled = true,
					animate = { duration = { step = 5, total = 50 } },
					animate_repeat = {
						delay = 50, -- delay in ms before using the repeat animation
						duration = { step = 2, total = 25 },
					},
				},
				statuscolumn = { enabled = true, git = { patterns = { "GitSigns" } } },
				words = { enabled = true },
				terminal = {
					win = {
						border = "rounded",
						position = "float",
						height = 0.8,
						width = 0.8,
					},
				},
				styles = {},
			},
			keys = {
				-- Find
				{
					"<leader><space>",
					function()
						Snacks.picker.smart()
					end,
					desc = "Smart Find Files",
				},
				{
					"<leader>ff",
					function()
						Snacks.picker.files()
					end,
					desc = "Find Files",
				},
				{
					"<leader>fb",
					function()
						Snacks.picker.buffers()
					end,
					desc = "Buffers",
				},
				{
					"<leader>fn",
					"<cmd>NoiceSnacks<cr>",
					desc = "Notification History",
				},
				{
					"<leader>fp",
					function()
						Snacks.picker.projects()
					end,
					desc = "Projects",
				},
				{
					"<leader>fr",
					function()
						Snacks.picker.recent()
					end,
					desc = "Recent",
				},
				{
					"<leader>e",
					function()
						Snacks.picker.explorer()
					end,
					desc = "Explorer",
				},

				-- git
				{
					"<leader>gb",
					function()
						Snacks.picker.git_branches()
					end,
					desc = "Git Branches",
				},
				{
					"<leader>gf",
					":lua Snacks.picker.git_log_file() <cr>",
					desc = "Git Log File",
				},
				{
					"<leader>gL",
					function()
						Snacks.picker.git_log()
					end,
					desc = "Git Log",
				},
				{
					"<leader>gl",
					function()
						Snacks.picker.git_log_line()
					end,
					desc = "Git Log Line",
				},
				{
					"<leader>gs",
					function()
						Snacks.picker.git_status()
					end,
					desc = "Git Status",
				},
				{
					"<leader>gd",
					function()
						Snacks.picker.git_diff()
					end,
					desc = "Git Diff (Hunks)",
				},
				{
					"<leader>gB",
					function()
						Snacks.gitbrowse()
					end,
					desc = "Git Browse",
					mode = { "n", "v" },
				},
				{
					"<leader>gg",
					function()
						Snacks.lazygit()
					end,
					desc = "Lazygit",
				},

				-- search
				{
					"<leader>sS",
					function()
						Snacks.picker.grep()
					end,
					desc = "Grep",
				},
				{
					"<leader>ss",
					function()
						Snacks.picker.lines()
					end,
					desc = "Buffer Lines",
				},
				{
					"<leader>sw",
					function()
						Snacks.picker.grep_word()
					end,
					desc = "Visual selection or word",
					mode = { "n", "x" },
				},
				{
					"<leader>sr",
					function()
						Snacks.picker.registers()
					end,
					desc = "Registers",
				},
				{
					"<leader>sd",
					function()
						Snacks.picker.diagnostics()
					end,
					desc = "Diagnostics",
				},
				{
					"<leader>sD",
					function()
						Snacks.picker.diagnostics_buffer()
					end,
					desc = "Buffer Diagnostics",
				},
				{
					"<leader>sh",
					function()
						Snacks.picker.help()
					end,
					desc = "Help Pages",
				},
				{
					"<leader>si",
					function()
						Snacks.picker.icons()
					end,
					desc = "Icons",
				},
				{
					"<leader>sj",
					function()
						Snacks.picker.jumps()
					end,
					desc = "Jumps",
				},
				{
					"<leader>sk",
					function()
						Snacks.picker.keymaps()
					end,
					desc = "Keymaps",
				},
				{
					"<leader>sl",
					function()
						Snacks.picker.loclist()
					end,
					desc = "Location List",
				},
				{
					"<leader>sp",
					function()
						Snacks.picker.lazy()
					end,
					desc = "Search for Plugin Spec",
				},
				{
					"<leader>sq",
					function()
						Snacks.picker.qflist()
					end,
					desc = "Quickfix List",
				},
				{
					"<leader>su",
					function()
						Snacks.picker.undo()
					end,
					desc = "Undo History",
				},
				-- Doesn't work on mac
				-- {
				-- 	"<leader>c",
				-- 	function()
				-- 		Snacks.picker.cliphist()
				-- 	end,
				-- 	desc = "Clipboard history",
				-- },
				{
					"<leader>st",
					function()
						---@diagnostic disable-next-line: undefined-field
						Snacks.picker.todo_comments()
					end,
					desc = "Todo",
				},
				{
					"<leader>sT",
					function()
						---@diagnostic disable-next-line: undefined-field
						Snacks.picker.todo_comments({ keywords = { "TODO", "FIX", "FIXME" } })
					end,
					desc = "Todo/Fix/Fixme",
				},

				-- LSP
				{
					"gd",
					function()
						Snacks.picker.lsp_definitions()
					end,
					desc = "Goto Definition",
				},
				{
					"gD",
					function()
						Snacks.picker.lsp_declarations()
					end,
					desc = "Goto Declaration",
				},
				{
					"gr",
					function()
						Snacks.picker.lsp_references()
					end,
					nowait = true,
					desc = "References",
				},
				{
					"gI",
					function()
						Snacks.picker.lsp_implementations()
					end,
					desc = "Goto Implementation",
				},
				{
					"gy",
					function()
						Snacks.picker.lsp_type_definitions()
					end,
					desc = "Goto T[y]pe Definition",
				},
				{
					"gs",
					function()
						Snacks.picker.lsp_symbols()
					end,
					desc = "LSP Symbols",
				},
				{
					"gS",
					function()
						Snacks.picker.lsp_workspace_symbols()
					end,
					desc = "LSP Workspace Symbols",
				},

				-- Other
				{
					"<leader>z",
					function()
						Snacks.zen.zoom()
					end,
					desc = "Toggle Zoom",
				},
				{
					"<leader>.",
					function()
						Snacks.scratch()
					end,
					desc = "Toggle Scratch Buffer",
				},
				{
					"<leader>S",
					function()
						Snacks.scratch.select()
					end,
					desc = "Select Scratch Buffer",
				},
				{
					"<leader>bd",
					function()
						Snacks.bufdelete()
					end,
					desc = "Delete Buffer",
				},
				{
					"<leader>cR",
					function()
						Snacks.rename.rename_file()
					end,
					desc = "Rename File",
				},
				{
					"<leader>un",
					function()
						Snacks.notifier.hide()
					end,
					desc = "Dismiss All Notifications",
				},
				{
					"<c-;>",
					function()
						Snacks.terminal()
					end,
					desc = "Toggle Terminal",
				},
				{
					"]]",
					function()
						Snacks.words.jump(vim.v.count1)
					end,
					desc = "Next Reference",
					mode = { "n", "t" },
				},
				{
					"[[",
					function()
						Snacks.words.jump(-vim.v.count1)
					end,
					desc = "Prev Reference",
					mode = { "n", "t" },
				},
			},
			init = function()
				vim.api.nvim_create_autocmd("User", {
					pattern = "VeryLazy",
					callback = function()
						local Snacks = require("snacks")

						-- Setup some globals for debugging (lazy-loaded)
						-- Inspect
						_G.dd = function(...)
							Snacks.debug.inspect(...)
						end

						-- Backtrace
						_G.bt = function()
							Snacks.debug.backtrace()
						end

						vim.print = _G.dd -- Override print to use snacks for `:=` command

						-- Create some toggle mappings
						Snacks.toggle.option("spell", { name = "Spelling" }):map("<leader>us")
						Snacks.toggle.option("wrap", { name = "Wrap" }):map("<leader>uw")

						Snacks.toggle.line_number():map("<leader>ul")
						Snacks.toggle.option("relativenumber", { name = "Relative Number" }):map("<leader>uL")

						Snacks.toggle.diagnostics():map("<leader>ud")
						Snacks.toggle
							.option("conceallevel", { off = 0, on = vim.o.conceallevel > 0 and vim.o.conceallevel or 2 })
							:map("<leader>uc")
						Snacks.toggle.treesitter():map("<leader>uT")
						Snacks.toggle
							.option("background", { off = "light", on = "dark", name = "Dark Background" })
							:map("<leader>ub")

						Snacks.toggle.inlay_hints():map("<leader>uh")
						Snacks.toggle.indent():map("<leader>ug")
						Snacks.toggle.dim():map("<leader>uD")

						-- TODO: make a snacks picker for showing terminals
					end,
				})
			end,
		},

		-- Session Management
		{
			"folke/persistence.nvim",
			event = "BufReadPre",
			opts = {},
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
					ft = "lua", -- only load on lua files
					opts = {
						library = {
							-- See the configuration section for more details
							-- Load luvit types when the `vim.uv` word is found
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
			end,
		},
	},

	---[[ AI ]]---
	{
		-- { "zbirenbaum/copilot.lua", opts = {} },
		-- {
		-- 	"olimorris/codecompanion.nvim",
		-- 	opts = {},
		-- 	dependencies = {
		-- 		"nvim-lua/plenary.nvim",
		-- 		"nvim-treesitter/nvim-treesitter",
		-- 	},
		-- },
		{
			"yetone/avante.nvim",
			event = "VeryLazy",
			version = false, -- Never set this value to "*"! Never!
			opts = {
				provider = "gemini",
				behaviour = {
					enable_cursor_planning_mode = true,
				},
				gemini = {
					model = "gemini-2.5-pro-exp-03-25",
				},
				file_selector = {
					provider = "snacks",
					provider_opts = {},
				},
			},
			build = "make",
			dependencies = {
				"nvim-treesitter/nvim-treesitter",
				"nvim-lua/plenary.nvim",
				"MunifTanjim/nui.nvim",
				"nvim-tree/nvim-web-devicons",
				-- { "stevearc/dressing.nvim", opts = { select = { backend = "builtin" } } },
				{
					-- support for image pasting
					"HakonHarnes/img-clip.nvim",
					event = "VeryLazy",
					opts = {
						default = {
							embed_image_as_base64 = false,
							prompt_for_file_name = false,
							drag_and_drop = {
								insert_mode = true,
							},
						},
					},
				},
				{
					-- Make sure to set this up properly if you have lazy=true
					"MeanderingProgrammer/render-markdown.nvim",
					opts = {
						file_types = { "markdown", "Avante" },
					},
					ft = { "markdown", "Avante" },
				},
			},
		},
	},
}
