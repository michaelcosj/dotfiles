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
local set_opencode_timeout_len_aug = vim.api.nvim_create_augroup("nvim_opencode_timeout_len", { clear = true })

vim.api.nvim_create_autocmd({ "WinEnter", "BufWinEnter" }, {
	group = set_opencode_timeout_len_aug,
	callback = function(event)
		if vim.bo[event.buf].filetype ~= "opencode" then
			return
		end

		if vim.g.__opencode_timeoutlen_orig == nil then
			-- Read the effective current value
			vim.g.__opencode_timeoutlen_orig = vim.api.nvim_get_option_value("timeoutlen", {})
		end

		vim.api.nvim_set_option_value("timeoutlen", 10, {})

		-- Reset timeoutlen when leaving opencode window
		vim.api.nvim_create_autocmd({ "WinLeave" }, {
			group = set_opencode_timeout_len_aug,
			once = true,
			callback = function()
				local orig = vim.g.__opencode_timeoutlen_orig
				if orig ~= nil then
					pcall(vim.api.nvim_set_option_value, "timeoutlen", orig, {})
					vim.g.__opencode_timeoutlen_orig = nil
				end
			end,
		})
	end,
})
