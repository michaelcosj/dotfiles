local function get_cwd_as_name()
	local dir = vim.fn.getcwd(0)
	return dir:gsub("[^A-Za-z0-9]", "_")
end

local M = {}

M.save_all_tasks = function()
	local ok, overseer = pcall(require, "overseer")
	if ok then
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
	end
end

M.dispose_all_tasks = function()
	local ok, overseer = pcall(require, "overseer")
	if ok then
		for _, task in ipairs(overseer.list_tasks({})) do
			task:dispose(true)
		end
	end
end

M.load_all_tasks = function()
	local ok, overseer = pcall(require, "overseer")
	if ok then
		overseer.load_task_bundle(get_cwd_as_name(), { ignore_missing = true })
	end
end

return M
