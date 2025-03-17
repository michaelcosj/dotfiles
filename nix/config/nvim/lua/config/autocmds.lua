-- [[ Basic Autocommands ]]
--  See `:help lua-guide-autocommands`

-- Highlight when yanking (copying) text
--  See `:help vim.highlight.on_yank()`
vim.api.nvim_create_autocmd("TextYankPost", {
	desc = "Highlight when yanking (copying) text",
	group = vim.api.nvim_create_augroup("nvim_highlight_yank", { clear = true }),
	callback = function()
		vim.highlight.on_yank()
	end,
})

-- Close some filetypes with <esc>
vim.api.nvim_create_autocmd("FileType", {
	group = vim.api.nvim_create_augroup("nvim_close_with_q", { clear = true }),
	pattern = {
		"PlenaryTestPopup",
		"grug-far",
		"help",
		"lspinfo",
		"notify",
		"qf",
		"spectre_panel",
		"startuptime",
		"tsplayground",
		"neotest-output",
		"checkhealth",
		"neotest-summary",
		"neotest-output-panel",
		"dbout",
		"gitsigns-blame",
		"Lazy",
	},
	callback = function(event)
		vim.bo[event.buf].buflisted = false
		vim.schedule(function()
			vim.keymap.set("n", "q", function()
				vim.cmd("close")
				pcall(vim.api.nvim_buf_delete, event.buf, { force = true })
			end, {
				buffer = event.buf,
				silent = true,
				desc = "Quit buffer",
			})
		end)
	end,
})

-- Open diagnostic float
-- handled by noice.nvim

vim.api.nvim_create_autocmd({ "CursorHold", "CursorHoldI" }, {
	group = vim.api.nvim_create_augroup("float_diagnostic", { clear = true }),
	callback = function()
		vim.diagnostic.open_float(nil, {
			focus = false,
			border = "rounded",
		})
	end,
})

-- Show notification for LSP progress
-- handled by noice.nvim
--
-- vim.api.nvim_create_autocmd("LspProgress", {
-- 	---@param ev {data: {client_id: integer, params: lsp.ProgressParams}}
-- 	callback = function(ev)
-- 		local spinner = { "⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏" }
-- 		vim.notify(vim.lsp.status(), "info", {
-- 			id = "lsp_progress",
-- 			title = "LSP Progress",
-- 			opts = function(notif)
-- 				notif.icon = ev.data.params.value.kind == "end" and " "
-- 					or spinner[math.floor(vim.uv.hrtime() / (1e6 * 80)) % #spinner + 1]
-- 			end,
-- 		})
-- 	end,
-- })
