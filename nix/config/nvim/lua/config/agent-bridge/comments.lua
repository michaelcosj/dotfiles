-- Review comments on any file, sent to the agent as one message.
--
-- Comments live in Neovim, not in the file. They belong to the file's path:
-- while its buffer is loaded each is an extmark range, so it moves with
-- edits; when the buffer unloads it is kept as { first, last, quote } and
-- put back when the file is opened again. When the file changes on disk
-- (e.g. the agent edits it), each comment is re-anchored by finding its
-- quoted text near its old line. Nothing is saved after Neovim quits.
--
-- A comment made in the agent-changes review is tagged with the agent that
-- made the change; sending routes it to that agent.
local virtlines = require("config.virtlines")

local M = {}

local ns = vim.api.nvim_create_namespace("agent_review_comments")
local ns_show = vim.api.nvim_create_namespace("agent_review_comments_show")

-- path -> list of { id, text, agent?, mark? (extmark id), first, last (1-based), quote, moved? }
local by_path = {}
local next_id = 0
local show_all = false

local function path_of(buf)
	local name = vim.api.nvim_buf_get_name(buf)
	if name == "" or vim.bo[buf].buftype ~= "" then return nil end
	return vim.fs.normalize(vim.fn.fnamemodify(name, ":p"))
end

local function loaded_buf(path)
	local buf = vim.fn.bufnr(path)
	if buf > 0 and vim.api.nvim_buf_is_loaded(buf) and path_of(buf) == path then return buf end
end

local function lines_text(buf, first, last)
	return table.concat(vim.api.nvim_buf_get_lines(buf, first - 1, last, false), "\n")
end

-- Brings a comment's first/last/quote up to date from its extmark.
local function sync(buf, c)
	if not c.mark then return end
	local m = vim.api.nvim_buf_get_extmark_by_id(buf, ns, c.mark, { details = true })
	if not m[1] then return end
	local d = m[3]
	c.first = m[1] + 1
	local er = d.end_row or m[1]
	-- a range ending at column 0 of a line ends on the line before it
	if d.end_col == 0 and er > m[1] then er = er - 1 end
	c.last = er + 1
	c.sc, c.ec = m[2], d.end_col
end

local function place(buf, c)
	local n = vim.api.nvim_buf_line_count(buf)
	c.first = math.max(1, math.min(c.first, n))
	c.last = math.max(c.first, math.min(c.last, n))
	local last_line = vim.api.nvim_buf_get_lines(buf, c.last - 1, c.last, false)[1] or ""
	local sc = c.sc or 0
	local ec = c.ec or #last_line
	if c.first == c.last and ec < sc then ec = #last_line end
	ec = math.min(ec, #last_line)
	sc = math.min(sc, #(vim.api.nvim_buf_get_lines(buf, c.first - 1, c.first, false)[1] or ""))
	if c.mark then pcall(vim.api.nvim_buf_del_extmark, buf, ns, c.mark) end
	c.mark = vim.api.nvim_buf_set_extmark(buf, ns, c.first - 1, sc, {
		end_row = c.last - 1,
		end_col = ec,
		hl_group = "CriticHighlight",
		right_gravity = false,
		end_right_gravity = true,
	})
end

-- Finds the quoted lines near where the comment was; nil if they're gone.
local function find_quote(buf, c)
	if not c.quote or c.quote == "" then return end
	local lines = vim.api.nvim_buf_get_lines(buf, 0, -1, false)
	local want = vim.split(c.quote, "\n", { plain = true })
	local span = #want
	local best, dist
	for i = 1, #lines - span + 1 do
		local ok = true
		for j = 1, span do
			if lines[i + j - 1] ~= want[j] then ok = false break end
		end
		if ok and (not dist or math.abs(i - c.first) < dist) then
			best, dist = i, math.abs(i - c.first)
		end
	end
	return best
end

local function render(buf)
	if not vim.api.nvim_buf_is_valid(buf) then return end
	local path = path_of(buf)
	vim.api.nvim_buf_clear_namespace(buf, ns_show, 0, -1)
	local list = path and by_path[path]
	if not list or #list == 0 then return end
	local cur = vim.api.nvim_get_current_buf() == buf and vim.api.nvim_win_get_cursor(0)[1] or nil
	for _, c in ipairs(list) do
		sync(buf, c)
		pcall(vim.api.nvim_buf_set_extmark, buf, ns_show, c.last - 1, 0, {
			virt_text = { { " 󰆉", "CriticIcon" } },
			virt_text_pos = "eol",
		})
		if show_all or (cur and cur >= c.first and cur <= c.last) then
			local who = c.agent and c.agent ~= "main" and ("you → " .. c.agent) or "you"
			local extra = c.moved and { "  (moved)", "Comment" } or nil
			pcall(vim.api.nvim_buf_set_extmark, buf, ns_show, c.last - 1, 0, {
				virt_lines = virtlines.lines(buf, who, c.text, "CriticComment", extra),
			})
		end
	end
end

local function render_path(path)
	local buf = loaded_buf(path)
	if buf then render(buf) end
end

local function rerender_all()
	for path in pairs(by_path) do render_path(path) end
end

local function current(buf)
	buf = buf or vim.api.nvim_get_current_buf()
	local path = path_of(buf)
	if not path then return end
	local list = by_path[path]
	if not list then return buf, path, nil end
	local row = vim.api.nvim_win_get_cursor(0)[1]
	for _, c in ipairs(list) do
		sync(buf, c)
		if row >= c.first and row <= c.last then return buf, path, c end
	end
	return buf, path, nil
end

local function ask(prompt, default, callback)
	vim.ui.input({ prompt = prompt, default = default }, function(value)
		if value and vim.trim(value) ~= "" then callback(vim.trim(value)) end
	end)
end

-- The agent a comment in this buffer goes to (set by the changes review).
local function agent_for(buf)
	return vim.b[buf].agent_review_by
end

local function add(buf, first, last, sc, ec)
	local path = path_of(buf)
	if not path then return vim.notify("Review comments need a file", vim.log.levels.WARN) end
	ask("Comment: ", "", function(text)
		next_id = next_id + 1
		local c = { id = next_id, text = text, agent = agent_for(buf), first = first, last = last, sc = sc, ec = ec }
		c.quote = lines_text(buf, first, last)
		place(buf, c)
		by_path[path] = by_path[path] or {}
		table.insert(by_path[path], c)
		table.sort(by_path[path], function(a, b) sync(buf, a); sync(buf, b); return a.first < b.first end)
		render(buf)
	end)
end

function M.comment_line()
	local buf = vim.api.nvim_get_current_buf()
	local row = vim.api.nvim_win_get_cursor(0)[1]
	add(buf, row, row)
end

function M.comment_selection()
	local buf = vim.api.nvim_get_current_buf()
	local mode = vim.fn.visualmode()
	local s, e = vim.fn.getpos("'<"), vim.fn.getpos("'>")
	local first, last = math.min(s[2], e[2]), math.max(s[2], e[2])
	if mode == "v" and s[2] <= e[2] then
		local line = vim.api.nvim_buf_get_lines(buf, last - 1, last, false)[1] or ""
		local col = math.min(e[3], #line)
		local ec = col > 0 and (col + vim.str_utf_end(line, col)) or 0
		add(buf, first, last, s[3] - 1, ec)
	else
		add(buf, first, last)
	end
end

function M.edit()
	local buf, path, c = current()
	if not c then return vim.notify("No comment here", vim.log.levels.WARN) end
	ask("Comment: ", c.text, function(text)
		c.text = text
		render(buf)
	end)
end

local function remove(path, c)
	local list = by_path[path] or {}
	for i, x in ipairs(list) do
		if x == c then table.remove(list, i) break end
	end
	local buf = loaded_buf(path)
	if buf and c.mark then pcall(vim.api.nvim_buf_del_extmark, buf, ns, c.mark) end
	if #list == 0 then by_path[path] = nil end
	if buf then render(buf) end
end

function M.delete()
	local _, path, c = current()
	if not c then return vim.notify("No comment here", vim.log.levels.WARN) end
	remove(path, c)
end

function M.jump(dir)
	local buf, path = current()
	local list = path and by_path[path]
	if not list then return end
	local row = vim.api.nvim_win_get_cursor(0)[1]
	for _, c in ipairs(list) do sync(buf, c) end
	if dir > 0 then
		for _, c in ipairs(list) do
			if c.first > row then return vim.api.nvim_win_set_cursor(0, { c.first, 0 }) end
		end
	else
		for i = #list, 1, -1 do
			if list[i].first < row then return vim.api.nvim_win_set_cursor(0, { list[i].first, 0 }) end
		end
	end
end

function M.toggle_all()
	show_all = not show_all
	rerender_all()
end

local function relative(path)
	return vim.fs.relpath(vim.uv.cwd(), path) or vim.fn.fnamemodify(path, ":~")
end

local function clip(s, n)
	s = s:gsub("%s+", " ")
	return #s > n and (vim.fn.strcharpart(s, 0, n) .. "…") or s
end

-- One message per agent: { [agent] = text }.
local function messages(paths)
	local groups, order = {}, {}
	for _, path in ipairs(paths) do
		local buf = loaded_buf(path)
		for _, c in ipairs(by_path[path] or {}) do
			if buf then sync(buf, c) end
			local who = c.agent or "main"
			if not groups[who] then
				groups[who] = {}
				table.insert(order, who)
			end
			groups[who][path] = groups[who][path] or {}
			table.insert(groups[who][path], c)
		end
	end
	local out = {}
	for _, who in ipairs(order) do
		local parts = {}
		for _, path in ipairs(paths) do
			local list = groups[who][path]
			if list then
				local block = { "Review comments on " .. relative(path) .. ":" }
				for _, c in ipairs(list) do
					local where = c.first == c.last and ("L" .. c.first) or ("L" .. c.first .. "-" .. c.last)
					local quote = c.quote and c.quote ~= "" and (" > " .. clip(c.quote, 120)) or ""
					table.insert(block, "")
					table.insert(block, where .. ":" .. quote)
					for _, l in ipairs(vim.split(c.text, "\n", { plain = true })) do
						table.insert(block, "  " .. l)
					end
				end
				table.insert(parts, table.concat(block, "\n"))
			end
		end
		out[who] = table.concat(parts, "\n\n")
	end
	return out, order
end

local function sorted_paths()
	local paths = vim.tbl_keys(by_path)
	table.sort(paths)
	return paths
end

-- Sends the comments on `paths` (default: the current file); clears them once pi has them.
function M.send(paths, done)
	if not paths then
		local path = path_of(vim.api.nvim_get_current_buf())
		paths = path and by_path[path] and { path } or {}
	end
	if #paths == 0 then return vim.notify("No review comments to send", vim.log.levels.INFO) end
	local bridge = require("config.agent-bridge.bridge")
	local function go()
		local msgs, order = messages(paths)
		local left, failed = #order, nil
		for _, who in ipairs(order) do
			local params = { text = msgs[who] }
			if who ~= "main" then params.agent = who end
			bridge.request("review", params, function(_, err)
				if err then failed = err end
				left = left - 1
				if left > 0 then return end
				if failed then
					vim.notify("Review comments not sent: " .. failed, vim.log.levels.ERROR)
					if done then done(false) end
					return
				end
				local n = 0
				for _, path in ipairs(paths) do
					local buf = loaded_buf(path)
					n = n + #(by_path[path] or {})
					if buf then vim.api.nvim_buf_clear_namespace(buf, ns, 0, -1) end
					by_path[path] = nil
					if buf then render(buf) end
				end
				vim.notify(string.format("Sent %d review comment%s", n, n == 1 and "" or "s"), vim.log.levels.INFO)
				if done then done(true) end
			end)
		end
	end
	if bridge.pipe then return go() end
	-- connect like <leader>aa does
	require("config.agent-bridge").with_bridge(go)
end

function M.send_all(done)
	M.send(sorted_paths(), done)
end

function M.count()
	local n = 0
	for _, list in pairs(by_path) do n = n + #list end
	return n
end

-- All pending comments in the quickfix list.
function M.list()
	local items = {}
	for _, path in ipairs(sorted_paths()) do
		local buf = loaded_buf(path)
		for _, c in ipairs(by_path[path]) do
			if buf then sync(buf, c) end
			table.insert(items, { filename = path, lnum = c.first, text = (c.agent and c.agent ~= "main" and ("→ " .. c.agent .. ": ") or "") .. clip(c.text, 200) })
		end
	end
	if #items == 0 then return vim.notify("No review comments", vim.log.levels.INFO) end
	vim.fn.setqflist({}, " ", { title = "Review comments", items = items })
	vim.cmd("copen")
end

-- ---- buffer lifecycle ----

local function save(buf)
	local path = path_of(buf)
	for _, c in ipairs(path and by_path[path] or {}) do
		sync(buf, c)
		c.mark = nil
	end
end

local function restore(buf, reanchor)
	local path = path_of(buf)
	local list = path and by_path[path]
	if not list then return end
	vim.api.nvim_buf_clear_namespace(buf, ns, 0, -1)
	for _, c in ipairs(list) do
		c.mark = nil
		if reanchor or lines_text(buf, c.first, c.last) ~= c.quote then
			local at = find_quote(buf, c)
			if at then
				local span = c.last - c.first
				c.first, c.last, c.moved = at, at + span, nil
			elseif c.quote and c.quote ~= "" then
				c.moved = true
				c.last = c.first
				c.sc, c.ec = nil, nil
			end
		end
		place(buf, c)
	end
	render(buf)
end

function M.setup()
	local group = vim.api.nvim_create_augroup("agent_bridge_comments", { clear = true })
	vim.api.nvim_create_autocmd("BufReadPost", { group = group, callback = function(a) restore(a.buf, false) end })
	-- :e!, :checktime or an autoread reload replaces the lines and drops the
	-- extmarks' positions; find each comment again
	vim.api.nvim_create_autocmd("BufReadPre", { group = group, callback = function(a) save(a.buf) end })
	vim.api.nvim_create_autocmd("FileChangedShellPost", { group = group, callback = function(a) restore(a.buf, true) end })
	vim.api.nvim_create_autocmd("BufUnload", { group = group, callback = function(a) save(a.buf) end })
	vim.api.nvim_create_autocmd({ "CursorMoved", "BufEnter" }, {
		group = group,
		callback = function(a)
			local path = path_of(a.buf)
			if path and by_path[path] then render(a.buf) end
		end,
	})
	vim.api.nvim_create_autocmd({ "TextChanged", "TextChangedI" }, {
		group = group,
		callback = function(a)
			local path = path_of(a.buf)
			if path and by_path[path] then render(a.buf) end
		end,
	})
	vim.api.nvim_create_autocmd("WinResized", { group = group, callback = rerender_all })
	vim.api.nvim_create_autocmd("VimLeavePre", {
		group = group,
		callback = function()
			local n = M.count()
			if n == 0 or #vim.api.nvim_list_uis() == 0 then return end
			local choice = vim.fn.confirm(
				string.format("%d review comment%s not sent.", n, n == 1 and "" or "s"),
				"&Send\n&Discard", 2)
			if choice ~= 1 then return end
			-- the request is async; wait for it (briefly) before Neovim exits
			local finished = false
			M.send_all(function() finished = true end)
			vim.wait(3000, function() return finished end, 20)
		end,
	})
end

function M.keys()
	local function map(mode, lhs, fn, desc)
		vim.keymap.set(mode, lhs, fn, { desc = desc })
	end
	map("n", "<leader>rc", M.comment_line, "Review: comment on line")
	map("x", "<leader>rc", function()
		vim.api.nvim_feedkeys(vim.keycode("<Esc>"), "nx", false)
		M.comment_selection()
	end, "Review: comment on selection")
	map("n", "<leader>re", M.edit, "Review: edit comment")
	map("n", "<leader>rd", M.delete, "Review: delete comment")
	map("n", "<leader>rs", function() M.send() end, "Review: send this file's comments")
	map("n", "<leader>rS", function() M.send_all() end, "Review: send all comments")
	map("n", "<leader>rl", M.list, "Review: list comments")
	map("n", "<leader>rv", M.toggle_all, "Review: show all comments")
	map("n", "]r", function() M.jump(1) end, "Review: next comment")
	map("n", "[r", function() M.jump(-1) end, "Review: previous comment")
end

-- for tests
M._state = function() return by_path end

return M
