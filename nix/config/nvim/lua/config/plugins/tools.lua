return {
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

	{
		"rmagatti/auto-session",
		lazy = false,
		keys = {
			{ "<leader>sr", "<cmd>SessionSearch<CR>", desc = "Session search" },
			{ "<leader>ss", "<cmd>SessionSave<CR>", desc = "Save session" },
			{ "<leader>sa", "<cmd>SessionToggleAutoSave<CR>", desc = "Toggle autosave" },
		},
		---@module "auto-session"
		---@type AutoSession.Config
		opts = {
			suppressed_dirs = { "~/", "~/Downloads", "/" },
			cwd_change_handling = true,
			bypass_save_filetypes = {
				"alpha",
				"dashboard",
				"OverseerList",
				"codecompanion",
			},

			session_lens = {
				load_on_setup = true,
				previewer = false,
				mappings = {
					delete_session = { "i", "<C-D>" },
					alternate_session = { "i", "<C-S>" },
					copy_session = { "i", "<C-Y>" },
				},
				theme_conf = {
					border = true,
				},
			},

			pre_cwd_changed_cmds = {},

			post_cwd_changed_cmds = {
				function()
					require("lualine").refresh()
				end,
			},

			pre_save = {
				require("config.extensions.overseer").save_all_tasks,
			},

			pre_restore = {
				require("config.extensions.overseer").dispose_all_tasks,
			},

			post_restore = {
				require("config.extensions.overseer").load_all_tasks,
			},
		},
	},

	{
		{
			"jedrzejboczar/exrc.nvim",
			dependencies = { "neovim/nvim-lspconfig" }, -- (optional)
			opts = {},
		},
	},

	-- Session Management
	{
		"folke/persistence.nvim",
		event = "BufReadPre",
		enabled = false,
		dependencies = { "stevearc/overseer.nvim" },
		opts = {},
		init = function()
			local function get_cwd_as_name()
				local dir = vim.fn.getcwd(0)
				return dir:gsub("[^A-Za-z0-9]", "_")
			end

			local overseer = require("overseer")

			vim.api.nvim_create_autocmd("User", {
				group = vim.api.nvim_create_augroup("user-persistence-pre-save", { clear = true }),
				pattern = "PersistenceSavePre",
				callback = function()
					overseer.save_task_bundle(get_cwd_as_name(), nil, { on_conflict = "overwrite" })

					-- only save buffers in the cwd
					local cwd = vim.fn.getcwd() .. "/"
					for _, buf in ipairs(vim.api.nvim_list_bufs()) do
						local bufname = vim.api.nvim_buf_get_name(buf)
						-- Skip empty names and special buffers (terminals, etc)
						if bufname ~= "" and not bufname:match("^term://") then
							local bufpath = bufname .. "/"
							if not bufpath:match("^" .. vim.pesc(cwd)) then
								vim.api.nvim_buf_delete(buf, {})
							end
						end
					end
				end,
			})

			vim.api.nvim_create_autocmd("User", {
				group = vim.api.nvim_create_augroup("user-persistence-pre-load", { clear = true }),
				pattern = "PersistenceLoadPre",
				callback = function()
					for _, task in ipairs(overseer.list_tasks({})) do
						task:dispose(true)
					end
				end,
			})

			vim.api.nvim_create_autocmd("User", {
				group = vim.api.nvim_create_augroup("user-persistence-post-load", { clear = true }),
				pattern = "PersistenceLoadPost",
				callback = function()
					-- Source exrc (for some reason changing sessions doesn't load exrc,
					-- I think it's an issue with snacks picker projects)
					if vim.fn.filereadable(".nvim.lua") == 1 then
						vim.cmd("silent! source .nvim.lua")
						Snacks.notify("Sourced .nvim.lua")
					end

					-- load overseer tasks
					overseer.load_task_bundle(get_cwd_as_name(), { ignore_missing = true })
				end,
			})

			-- select a session to load
			-- Persistence.nvim keymaps
			vim.keymap.set("n", "<leader>ps", function()
				require("persistence").select()
			end, { desc = "Select Session" })
		end,
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
}
