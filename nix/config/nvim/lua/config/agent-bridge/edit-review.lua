-- Reviewing an edit before pi makes it: a diff tab with the file as it is
-- on the left and pi's version on the right. Change the right side to adjust
-- the edit, then accept or reject it.
local M = {}

local function relative(path)
	return vim.fs.relpath(vim.uv.cwd(), path) or vim.fn.fnamemodify(path, ":~")
end

function M.wants(req)
	local mode = require("config.agent-bridge.config").values.review.edits
	if mode == "always" then return true end
	if mode == "open" then
		local bufnr = vim.fn.bufnr(req.path)
		return bufnr > 0 and vim.api.nvim_buf_is_loaded(bufnr) and vim.bo[bufnr].buflisted
	end
	return false
end

local function split_lines(text)
	local eol = text:sub(-1) == "\n"
	local lines = vim.split(eol and text:sub(1, -2) or text, "\n", { plain = true })
	return lines, eol
end

local function scratch(name, lines, ft, modifiable)
	local buf = vim.api.nvim_create_buf(false, true)
	vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
	pcall(vim.api.nvim_buf_set_name, buf, name)
	-- hidden, not wiped: Neovim 0.12 can crash wiping a buffer in diff mode;
	-- M.close deletes them once diff mode is off
	vim.bo[buf].bufhidden = "hide"
	vim.bo[buf].modified = false
	vim.bo[buf].modifiable = modifiable
	if ft then vim.bo[buf].filetype = ft end
	return buf
end

function M.open(req, done)
	local rel = relative(req.path)
	local ft = vim.filetype.match({ filename = req.path })
	local old_lines = split_lines(req.original or "")
	local new_lines, eol = split_lines(req.proposed or "")
	if not req.exists then old_lines = {} end

	vim.cmd("tabnew")
	local tab = vim.api.nvim_get_current_tabpage()
	local left_win = vim.api.nvim_get_current_win()
	local placeholder = vim.api.nvim_get_current_buf()
	local left = scratch("agent-review://" .. rel .. " (current)", old_lines, ft, false)
	vim.api.nvim_win_set_buf(left_win, left)
	pcall(vim.api.nvim_buf_delete, placeholder, { force = true })
	vim.cmd("rightbelow vsplit")
	local right_win = vim.api.nvim_get_current_win()
	local right = scratch("agent-review://" .. rel .. " (pi)", new_lines, ft, true)
	vim.api.nvim_win_set_buf(right_win, right)
	for _, win in ipairs({ left_win, right_win }) do
		vim.api.nvim_win_call(win, function() vim.cmd("diffthis") end)
	end
	local what = req.exists and "edit" or "new file"
	vim.wo[left_win].winbar = "%#Comment# " .. rel .. " now%*"
	vim.wo[right_win].winbar = "%#DiagnosticWarn# 󰚩 " .. rel:gsub("%%", "%%%%") .. "%*%#Comment# (agent " .. what .. ")%*"
	vim.api.nvim_set_current_win(right_win)
	pcall(vim.cmd, "normal! gg]c")

	local decided = false
	local function finish(result)
		if decided then return end
		decided = true
		done(result)
		M.close(req)
	end
	local function accept()
		local lines = vim.api.nvim_buf_get_lines(right, 0, -1, false)
		finish({ decision = "accept", content = table.concat(lines, "\n") .. (eol and "\n" or "") })
	end
	local function reject(with_note)
		if not with_note then return finish({ decision = "reject" }) end
		vim.ui.input({ prompt = "Why? (sent to pi): " }, function(note)
			if note == nil then return end
			finish({ decision = "reject", reason = note })
		end)
	end
	for _, buf in ipairs({ left, right }) do
		local function map(lhs, fn, desc)
			vim.keymap.set("n", lhs, fn, { buffer = buf, desc = desc, nowait = true })
		end
		map("<leader>ra", accept, "Review: accept edit")
		map("<leader>rr", function() reject(false) end, "Review: reject edit")
		map("<leader>rR", function() reject(true) end, "Review: reject edit with a note")
		-- closing the diff without deciding rejects the edit
		vim.api.nvim_create_autocmd("BufHidden", {
			buffer = buf,
			once = true,
			callback = function()
				vim.schedule(function() finish({ decision = "reject", reason = "closed the review without accepting" }) end)
			end,
		})
	end
	req._tab = tab
	req._bufs = { left, right }
end

function M.close(req)
	local tab = req._tab
	local bufs = req._bufs or {}
	req._tab, req._bufs = nil, nil
	if tab and vim.api.nvim_tabpage_is_valid(tab) then
		for _, win in ipairs(vim.api.nvim_tabpage_list_wins(tab)) do
			vim.api.nvim_win_call(win, function() vim.cmd("diffoff") end)
		end
		if #vim.api.nvim_list_tabpages() > 1 then
			pcall(vim.cmd, vim.api.nvim_tabpage_get_number(tab) .. "tabclose!")
		else
			for _, win in ipairs(vim.api.nvim_tabpage_list_wins(tab)) do
				pcall(vim.api.nvim_win_close, win, true)
			end
		end
	end
	vim.schedule(function()
		for _, buf in ipairs(bufs) do
			if vim.api.nvim_buf_is_valid(buf) then pcall(vim.api.nvim_buf_delete, buf, { force = true }) end
		end
	end)
end

function M.resume(req)
	if req._tab and vim.api.nvim_tabpage_is_valid(req._tab) then
		vim.api.nvim_set_current_tabpage(req._tab)
	end
end

return M
