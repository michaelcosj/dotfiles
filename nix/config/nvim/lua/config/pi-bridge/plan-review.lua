-- Reviewing a plan pi submitted with submit_plan: it opens in a tab with
-- CriticMarkup hidden; comment inline, then approve or request changes.
local cm = require("config.criticmarkup")

local M = {}

function M.wants()
	return require("config.pi-bridge.config").values.review.plans ~= false
end

local function banner(req)
	local summary = req.summary and req.summary ~= "" and ("  " .. req.summary:gsub("%%", "%%%%")) or ""
	return "%#DiagnosticWarn# 󰚩 Plan review%*" .. summary
		.. "%=%#Comment#<leader>rc comment · ]c/[c · <leader>ra approve · <leader>rr request changes %*"
end

-- Opens the review; done(result) once the user decides.
function M.open(req, done)
	local path = req.path
	vim.cmd("tabedit " .. vim.fn.fnameescape(path))
	local buf = vim.api.nvim_get_current_buf()
	if not vim.bo[buf].modified then vim.cmd("silent! checktime") end
	local tab = vim.api.nvim_get_current_tabpage()
	local original = cm.strip(table.concat(vim.api.nvim_buf_get_lines(buf, 0, -1, false), "\n"))
	local win = vim.api.nvim_get_current_win()
	vim.wo[win].winbar = banner(req)
	cm.attach(buf)

	local decided = false
	local function finish(decision, message)
		if decided then return end
		decided = true
		if vim.bo[buf].modified then
			vim.api.nvim_buf_call(buf, function() vim.cmd("silent write") end)
		end
		local text = table.concat(vim.api.nvim_buf_get_lines(buf, 0, -1, false), "\n")
		done({
			decision = decision,
			comments = cm.comments(buf),
			edited = cm.strip(text) ~= original,
			message = message,
		})
		M.close(req)
	end

	req._buf, req._tab = buf, tab
	cm.keys(buf, {
		{ "n", "<leader>ra", function() finish("approve") end, "Review: approve plan" },
		{
			"n",
			"<leader>rr",
			function()
				vim.ui.input({ prompt = "Note for pi (optional): " }, function(note)
					if note == nil then return end
					finish("changes", vim.trim(note) ~= "" and note or nil)
				end)
			end,
			"Review: request changes",
		},
	})
	req._reopen = function() M.open(req, done) end
end

-- Ends the review UI (also when pi cancels it); the file stays open elsewhere.
function M.close(req)
	local buf, tab = req._buf, req._tab
	if buf and vim.api.nvim_buf_is_valid(buf) then
		for _, lhs in ipairs({ "<leader>ra", "<leader>rr" }) do
			pcall(vim.keymap.del, "n", lhs, { buffer = buf })
		end
		for _, win in ipairs(vim.fn.win_findbuf(buf)) do
			vim.wo[win].winbar = ""
		end
	end
	if tab and vim.api.nvim_tabpage_is_valid(tab) and #vim.api.nvim_list_tabpages() > 1 then
		local nr = vim.api.nvim_tabpage_get_number(tab)
		pcall(vim.cmd, nr .. "tabclose")
	end
end

-- Puts the review back on screen if its tab was closed.
function M.resume(req)
	if req._tab and vim.api.nvim_tabpage_is_valid(req._tab) then
		vim.api.nvim_set_current_tabpage(req._tab)
	elseif req._reopen then
		req._reopen()
	end
end

return M
