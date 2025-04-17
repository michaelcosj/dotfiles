local M = {}

M.init = function()
	vim.opt.sessionoptions = {
		"buffers",
		"curdir",
		"tabpages",
		"winsize",
		"help",
		"globals",
		"skiprtp",
		"folds",
	}

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
end

return M
