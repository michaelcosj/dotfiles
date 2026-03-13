return {
	"stevearc/resession.nvim",
	lazy = false,
	dependencies = { "stevearc/overseer.nvim" },
	opts = function()
		return {
			options = {
				"binary",
				"bufhidden",
				"buflisted",
				"cmdheight",
				"diff",
				"filetype",
				"modifiable",
				"previewwindow",
				"readonly",
				"scrollbind",
				"winfixheight",
				"winfixwidth",
			},

			extensions = {
				overseer_fix = {},
				quickfix = {},
			},
		}
	end,
	init = function()
		local resession = require("resession")

		vim.api.nvim_create_autocmd("VimEnter", {
			callback = function()
				-- Only load the session if nvim was started with no args and without reading from stdin
				if vim.fn.argc(-1) == 0 and not vim.g.using_stdin then
					resession.load(vim.fn.getcwd(), { dir = "dirsession", silence_errors = true })
				end
			end,
			nested = true,
		})

		vim.api.nvim_create_autocmd("VimLeavePre", {
			callback = function()
				resession.save(vim.fn.getcwd(), { dir = "dirsession", notify = false })
			end,
		})

		vim.api.nvim_create_autocmd("StdinReadPre", {
			callback = function()
				vim.g.using_stdin = true
			end,
		})

		-- Manual session save command
		vim.api.nvim_create_user_command("SessionSave", function()
			resession.save(vim.fn.getcwd(), { dir = "dirsession", notify = true })
			vim.notify("Session saved", vim.log.levels.INFO)
		end, { desc = "Save current session" })
	end,
}
