-- Autofollow: when on, Neovim shows each file pi reads or edits, at the line
-- it's working on. Focus stays where it is (usually the agent pane), so you
-- can keep typing to pi while Neovim follows along.
local config = require("config.pi-bridge.config")

local M = {}

local function normal_window()
	local function ok(win)
		local buf = vim.api.nvim_win_get_buf(win)
		return vim.api.nvim_win_get_config(win).relative == "" and vim.bo[buf].buftype == ""
	end
	local cur = vim.api.nvim_get_current_win()
	if ok(cur) then return cur end
	for _, win in ipairs(vim.api.nvim_tabpage_list_wins(0)) do
		if ok(win) then return win end
	end
end

local function busy()
	local mode = vim.api.nvim_get_mode().mode
	if not mode:match("^n") then return true end -- typing, selecting or in the cmdline
	if vim.fn.getcmdwintype() ~= "" then return true end
	if require("config.pi-bridge.requests").active then return true end
	-- don't pull the rug out from a review tab
	return vim.t.pi_review or vim.t.pi_changes or vim.wo.diff
end

function M.show(data)
	if not config.values.follow or not data or not data.path or busy() then return end
	if vim.fn.filereadable(data.path) == 0 then return end
	local win = normal_window()
	if not win then return end
	vim.api.nvim_win_call(win, function()
		if vim.fn.bufnr(data.path) ~= vim.api.nvim_get_current_buf() then
			vim.cmd("keepjumps edit " .. vim.fn.fnameescape(data.path))
		end
		if data.line then
			local line = math.min(data.line, vim.api.nvim_buf_line_count(0))
			pcall(vim.api.nvim_win_set_cursor, 0, { line, 0 })
			vim.cmd("normal! zvzz")
		end
	end)
end

function M.toggle(on)
	if on == nil then on = not config.values.follow end
	config.values.follow = on
	vim.notify("Agent follow " .. (on and "on" or "off"), vim.log.levels.INFO)
	require("config.pi-bridge.statusline").sync()
	pcall(function() require("lualine").refresh({ place = { "statusline" } }) end)
end

function M.setup()
	vim.api.nvim_create_autocmd("User", {
		group = vim.api.nvim_create_augroup("pi_bridge_follow", { clear = true }),
		pattern = "PiEvent:follow",
		-- after files_changed's checktime, so an edited buffer is reloaded first
		callback = function(args) vim.schedule(function() M.show(args.data) end) end,
	})
	vim.api.nvim_create_user_command("AgentFollow", function(c)
		M.toggle(({ on = true, off = false })[c.args])
	end, { nargs = "?", complete = function() return { "on", "off" } end, desc = "Follow the files pi works on" })
	vim.keymap.set("n", "<leader>aw", function() M.toggle() end, { desc = "Agent: toggle follow" })
end

return M
