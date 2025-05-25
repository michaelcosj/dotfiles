return {
	-- Colorscheme
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
					lualine_x = { require("mcphub.extensions.lualine") },
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

	-- Smoother cursor movement animations
	{
		"sphamba/smear-cursor.nvim",
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
