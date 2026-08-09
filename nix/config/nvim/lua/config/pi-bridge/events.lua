local M = {
	state = "disconnected",
	message = nil,
	agent = nil,
}

local names = {
	files_changed = "file_edited",
}

function M.emit(event, data)
	data = data or {}
	if event == "status" then
		M.state = data.state or "unknown"
		M.message = data.message
	elseif event == "connected" then
		M.state = data.state or "idle"
	elseif event == "shutdown" or event == "disconnected" then
		M.state = "disconnected"
	end

	if event == "files_changed" then
		vim.schedule(function()
			for _, filename in ipairs(data.paths or {}) do
				local bufnr = vim.fn.bufnr(filename)
				if bufnr > 0 and vim.api.nvim_buf_is_loaded(bufnr) then
					if vim.bo[bufnr].modified then
						vim.notify("Pi edited a locally modified buffer: " .. filename, vim.log.levels.WARN)
					else
						vim.api.nvim_buf_call(bufnr, function()
							vim.cmd("checktime")
						end)
					end
				end
			end
		end)
	end

	vim.schedule(function()
		vim.api.nvim_exec_autocmds("User", {
			pattern = "PiEvent:" .. (names[event] or event),
			data = data,
		})
	end)
end

function M.set_agent(agent)
	M.agent = agent
end

function M.statusline()
	if M.state == "disconnected" then
		return ""
	end
	local icons = { idle = "󰚩", working = "󰔟", blocked = "󰀦", unknown = "󰋗" }
	local pane = M.agent and M.agent.pane_id or "pi"
	return string.format("%s Pi %s", icons[M.state] or icons.unknown, pane)
end

return M
