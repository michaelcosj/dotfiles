------------------=[[Autocmds]]=----------------------------
-- Highlight when yanking (copying) text
vim.api.nvim_create_autocmd("TextYankPost", {
	desc = "Highlight when yanking (copying) text",
	group = vim.api.nvim_create_augroup("nvim_highlight_yank", { clear = true }),
	callback = function()
		vim.highlight.on_yank()
	end,
})

-- Close some filetypes with q
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

-- PHP comment string config
vim.api.nvim_create_autocmd("FileType", {
	pattern = "php",
	callback = function()
		vim.opt_local.commentstring = "// %s"
	end,
})

-- Set timeoutlen for opencode filetype

vim.api.nvim_create_autocmd({ "WinEnter" }, {
	group = vim.api.nvim_create_augroup("nvim_opencode_timeout_len", { clear = true }),
	callback = function(event)
		if vim.bo[event.buf].filetype == "opencode" then
			local timeoutlen = vim.opt_local.timeoutlen:get()
			vim.opt_local.timeoutlen = 10

			-- Reset timeoutlen when leaving opencode buffer
			vim.api.nvim_create_autocmd("WinLeave", {
				buffer = 0,
				once = true,
				callback = function()
					vim.opt_local.timeoutlen = timeoutlen
				end,
			})
		end
	end,
})
