return {
	-- Colorscheme
	{
		"rebelot/kanagawa.nvim",
		enabled = false,
		priority = 1000,
		opts = {
			transparent = true,
			colors = {
				theme = {
					all = {
						ui = {
							bg_gutter = "none",
						},
					},
				},
			},
			background = {
				dark = "dragon",
				light = "lotus",
			},
			overrides = function(colors)
				local theme = colors.theme
				return {
					Pmenu = { fg = theme.ui.shade0, bg = theme.ui.bg_p1 },
					PmenuSel = { fg = "NONE", bg = theme.ui.bg_p2 },
					PmenuSbar = { bg = theme.ui.bg_m1 },
					PmenuThumb = { bg = theme.ui.bg_p2 },

					NormalFloat = { bg = "none" },
					FloatBorder = { bg = "none" },
					FloatTitle = { bg = "none" },

					-- Save an hlgroup with dark background and dimmed foreground
					-- so that you can use it where your still want darker windows.
					-- E.g.: autocmd TermOpen * setlocal winhighlight=Normal:NormalDark
					NormalDark = { fg = theme.ui.fg_dim, bg = theme.ui.bg_m3 },

					-- Popular plugins that open floats will link to NormalFloat by default;
					-- set their background accordingly if you wish to keep them dark and borderless
					LazyNormal = { bg = theme.ui.bg_m3, fg = theme.ui.fg_dim },
					OpencodeBorder = { bg = "none", fg = "none" },
				}
			end,
		},
		init = function()
			vim.cmd("colorscheme kanagawa")
		end,
	},

	{
		"sainnhe/gruvbox-material",
		enabled = false,
		lazy = false,
		priority = 1000,
		config = function()
			vim.g.gruvbox_material_enable_italic = true
			vim.g.gruvbox_material_background = "medium"
			vim.g.gruvbox_material_better_performance = 1

			-- set some highlights for floating windows
			vim.api.nvim_set_hl(0, "NormalFloat", { bg = "NONE" })
			vim.api.nvim_set_hl(0, "FloatBorder", { bg = "NONE" })
			vim.api.nvim_set_hl(0, "FloatTitle", { bg = "NONE" })
		end,
		init = function()
			vim.cmd.colorscheme("gruvbox-material")
		end,
	},

	{
		"catppuccin/nvim",
		name = "catppuccin",
		enabled = false,
		priority = 1000,
		opts = {
			flavour = "latte",
			styles = {
				comments = { "italic" },
				conditionals = { "italic" },
				loops = {},
				functions = {},
				keywords = {},
				strings = {},
				variables = {},
				numbers = {},
				booleans = {},
				properties = {},
				types = {},
				operators = {},
				-- miscs = {},
			},
			lsp_styles = {
				virtual_text = {
					errors = { "italic" },
					hints = { "italic" },
					warnings = { "italic" },
					information = { "italic" },
					ok = { "italic" },
				},
				underlines = {
					errors = { "underline" },
					hints = { "underline" },
					warnings = { "underline" },
					information = { "underline" },
					ok = { "underline" },
				},
				inlay_hints = {
					background = true,
				},
			},
			color_overrides = {},
			custom_highlights = function(colors)
				return {
					NormalFloat = { bg = "none" },
					FloatBorder = { bg = "none" },
					FloatTitle = { bg = "none" },
					OpencodeBorder = { bg = "none", fg = "none" },
				}
			end,
			default_integrations = true,
			auto_integrations = true,
		},
		init = function()
			vim.o.background = "light" -- "dark" or "light"
			vim.cmd.colorscheme("catppuccin")
		end,
	},

	{
		"folke/tokyonight.nvim",
		lazy = false,
		priority = 1000,
		opts = {
      style = "night",
			on_highlights = function(hl, c)
				hl.NormalFloat = { bg = "none" }
				hl.FloatBorder = { bg = "none" }
				hl.FloatTitle = { bg = "none" }
				hl.OpencodeBorder = { bg = "none", fg = "none" }
			end,
		},
		init = function()
			vim.cmd([[colorscheme tokyonight]])
		end,
	},

	-- Highlight Todo Comments
	{
		"folke/todo-comments.nvim",
		events = "VimEnter",
		opts = {},
	},

	-- mini icons
	{
		"echasnovski/mini.icons",
		version = false,
		opts = {},
		config = function(_, opts)
			require("mini.icons").setup(opts)
			require("mini.icons").mock_nvim_web_devicons()
		end,
	},

	-- Status line
	{
		"nvim-lualine/lualine.nvim",
		dependencies = { "nvim-tree/nvim-web-devicons" },
		enabled = true,
		event = "VeryLazy",
		opts = {
			options = {
				theme = "auto",
				component_separators = "",
				section_separators = "",
				disabled_filetypes = { "snacks_dashboard" },
				globalstatus = true,
			},
			sections = {
				lualine_a = {},
				lualine_b = {},
				lualine_y = {},
				lualine_z = {},
				lualine_c = { "filetype", "filename", "branch", "diff", "diagnostics" },
				lualine_x = {
					"overseer",
					"location",
					"progress",
					"searchcount",
					"selectedcount",
					{
						"macro",
						fmt = function()
							local reg = vim.fn.reg_recording()
							if reg ~= "" then
								return "Recording @" .. reg
							end
							return nil
						end,
						color = { fg = "#ff9e64" },
						draw_empty = false,
					},
					-- require("config.extensions.mcphub").lualine,
					-- require("noice").api.status.mode.get,
				},
			},
			inactive_sections = {
				lualine_a = {},
				lualine_b = {},
				lualine_y = {},
				lualine_z = {},
				lualine_c = {},
				lualine_x = {},
			},
		},
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
			lsp = {
				progress = {
					enabled = true,
				},
			},
		},
		dependencies = {
			"MunifTanjim/nui.nvim",
			"folke/snacks.nvim",
		},
	},

	-- Smoother cursor movement animations
	{
		"sphamba/smear-cursor.nvim",
		enabled = false,
		opts = {},
	},

	-- Better Markdown rendering
	{
		"MeanderingProgrammer/render-markdown.nvim",
		ft = { "markdown", "codecompanion" },
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
}
