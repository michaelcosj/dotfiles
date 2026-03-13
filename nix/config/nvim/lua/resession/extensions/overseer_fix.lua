local M = {}

M.on_save = function()
	local task_list = require("overseer.task_list")

	local serialized = vim.tbl_map(function(task)
		return task:serialize()
	end, task_list.list_tasks())

	if #serialized > 0 then
		return serialized
	end
end

M.on_load = function(data)
	local overseer = require("overseer")

	for _, params in ipairs(data) do
		local task = overseer.new_task(params)

		-- add any components that are not part
		-- of the default template of this task
		task:add_components(params.components)

		task:start()
	end
end

M.is_win_supported = function(winid, bufnr)
	return vim.bo[bufnr].filetype == "OverseerList"
end

M.save_win = function(winid)
	return {}
end

M.load_win = function(winid, data)
	local sidebar = require("overseer.task_list.sidebar")
	local window = require("overseer.window")
	window.open({ winid = winid })
	sidebar.get_or_create()
end

return M
