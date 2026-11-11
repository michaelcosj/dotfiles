-- CriticMarkup review comments in a buffer, with the markup hidden.
--
--   {==commented text==}{>>comment<<}   a comment on a span
--   {>>comment<<}                       a comment at a spot
--   {>>pi: reply<<}                     the agent's reply
--
-- The markers and comments are concealed; commented text is highlighted and
-- marked with an icon. A comment shows as a virtual line when the cursor is
-- on it, or all of them with toggle_all(). raw() shows the file as written.
local M = {}

local ns = vim.api.nvim_create_namespace("criticmarkup")
local ns_show = vim.api.nvim_create_namespace("criticmarkup_show")

-- per buffer: { items, raw, show_all, timer }
local state = {}

vim.api.nvim_set_hl(0, "CriticHighlight", { default = true, link = "DiffChange" })
vim.api.nvim_set_hl(0, "CriticIcon", { default = true, link = "DiagnosticInfo" })
vim.api.nvim_set_hl(0, "CriticComment", { default = true, link = "DiagnosticVirtualTextInfo" })
vim.api.nvim_set_hl(0, "CriticReply", { default = true, link = "DiagnosticVirtualTextHint" })

local function buf_text(buf)
	return table.concat(vim.api.nvim_buf_get_lines(buf, 0, -1, false), "\n")
end

-- Byte offset (1-based) -> 0-based row, col.
local function locator(text)
	local starts = { 1 }
	for pos in text:gmatch("()\n") do
		table.insert(starts, pos + 1)
	end
	return function(off)
		local lo, hi = 1, #starts
		while lo < hi do
			local mid = math.floor((lo + hi + 1) / 2)
			if starts[mid] <= off then lo = mid else hi = mid - 1 end
		end
		return lo - 1, off - starts[lo]
	end
end

-- Items, each { hl = {s, e}?, cm = {s, e}?, quote?, comment?, author } with
-- 1-based inclusive byte offsets into the buffer text joined by "\n".
function M.parse(text)
	local items = {}
	local i = 1
	while true do
		local h = text:find("{==", i, true)
		local c = text:find("{>>", i, true)
		if not h and not c then break end
		if h and (not c or h < c) then
			local e = text:find("==}", h + 3, true)
			if not e then break end
			local item = { hl = { h, e + 2 }, quote = text:sub(h + 3, e - 1) }
			local _, open_end = text:find("^[ \t]*{>>", e + 3)
			local close = open_end and text:find("<<}", open_end + 1, true)
			if close then
				item.cm = { e + 3, close + 2 }
				item.comment = text:sub(open_end + 1, close - 1)
				i = close + 3
			else
				i = e + 3
			end
			table.insert(items, item)
		else
			local close = text:find("<<}", c + 3, true)
			if not close then break end
			table.insert(items, { cm = { c, close + 2 }, comment = text:sub(c + 3, close - 1) })
			i = close + 3
		end
	end
	for _, item in ipairs(items) do
		local body = item.comment and item.comment:match("^%s*pi:%s*(.*)$")
		item.author = body and "pi" or "you"
		if body then item.comment = body end
		if item.comment then item.comment = vim.trim(item.comment) end
	end
	-- consecutive comments on one span form a thread; attach replies to it
	return items
end

-- The text with every comment and marker removed.
function M.strip(text)
	return (text:gsub("[ \t]*{>>.-<<}", ""):gsub("{==", ""):gsub("==}", ""))
end

local function render(buf)
	local st = state[buf]
	if not st or not vim.api.nvim_buf_is_valid(buf) then return end
	vim.api.nvim_buf_clear_namespace(buf, ns, 0, -1)
	local text = buf_text(buf)
	local at = locator(text)
	st.items = M.parse(text)
	st.at = at
	if st.raw then return M.show_comments(buf) end
	local function mark(s, e, opts)
		local sr, sc = at(s)
		local er, ec = at(e + 1)
		opts.end_row, opts.end_col = er, ec
		pcall(vim.api.nvim_buf_set_extmark, buf, ns, sr, sc, opts)
	end
	for _, item in ipairs(st.items) do
		if item.hl then
			mark(item.hl[1], item.hl[1] + 2, { conceal = "" })
			mark(item.hl[2] - 2, item.hl[2], { conceal = "" })
			mark(item.hl[1] + 3, item.hl[2] - 3, { hl_group = "CriticHighlight" })
		end
		if item.cm then
			mark(item.cm[1], item.cm[2], { conceal = "" })
			local row = at(item.cm[2])
			local icon = item.author == "pi" and " 󰚩" or " 󰆉"
			pcall(vim.api.nvim_buf_set_extmark, buf, ns, row, 0, {
				virt_text = { { icon, "CriticIcon" } },
				virt_text_pos = "eol",
			})
		end
	end
	M.show_comments(buf)
end

local function item_rows(st, item)
	local first = item.hl or item.cm
	local last = item.cm or item.hl
	local sr = st.at(first[1])
	local er = st.at(last[2])
	return sr, er
end

-- The comment under the cursor (its span or the comment's own spot).
function M.at_cursor(buf, row, col)
	buf = buf or vim.api.nvim_get_current_buf()
	local st = state[buf]
	if not st or not st.items then return end
	if not row then
		local cur = vim.api.nvim_win_get_cursor(0)
		row, col = cur[1] - 1, cur[2]
	end
	local best
	for _, item in ipairs(st.items) do
		local first, last = item.hl or item.cm, item.cm or item.hl
		local sr, sc = st.at(first[1])
		local er, ec = st.at(last[2])
		local after_start = row > sr or (row == sr and col >= sc)
		local before_end = row < er or (row == er and col <= ec)
		if after_start and before_end then return item end
		-- with concealed markup the cursor often sits just past a comment
		if not best and row >= sr and row <= er then best = item end
	end
	return best
end

function M.show_comments(buf)
	local st = state[buf]
	if not st or not vim.api.nvim_buf_is_valid(buf) then return end
	vim.api.nvim_buf_clear_namespace(buf, ns_show, 0, -1)
	if st.raw then return end
	local shown = {}
	local function show(item)
		if not item or not item.comment or shown[item] then return end
		shown[item] = true
		local _, er = item_rows(st, item)
		local hl = item.author == "pi" and "CriticReply" or "CriticComment"
		local who = item.author == "pi" and "pi" or "you"
		local lines = require("config.virtlines").lines(buf, who, item.comment, hl)
		pcall(vim.api.nvim_buf_set_extmark, buf, ns_show, er, 0, { virt_lines = lines })
	end
	if st.show_all then
		for _, item in ipairs(st.items or {}) do show(item) end
	elseif vim.api.nvim_get_current_buf() == buf then
		local cur = M.at_cursor(buf)
		if cur then
			-- show the whole thread at this spot
			local _, er = item_rows(st, cur)
			for _, item in ipairs(st.items) do
				local _, ier = item_rows(st, item)
				if ier == er then show(item) end
			end
		end
	end
end

local function set_conceal(buf)
	local st = state[buf]
	for _, win in ipairs(vim.fn.win_findbuf(buf)) do
		vim.wo[win].conceallevel = (st and not st.raw) and 2 or 0
		vim.wo[win].concealcursor = "nc"
	end
end

function M.attach(buf)
	if not buf or buf == 0 then buf = vim.api.nvim_get_current_buf() end
	if state[buf] then
		render(buf)
		return
	end
	state[buf] = { raw = false, show_all = false }
	local group = vim.api.nvim_create_augroup("criticmarkup_" .. buf, { clear = true })
	vim.api.nvim_create_autocmd({ "TextChanged", "TextChangedI" }, {
		group = group,
		buffer = buf,
		callback = function()
			local st = state[buf]
			if not st then return end
			if st.timer then st.timer:stop() end
			st.timer = vim.defer_fn(function() render(buf) end, 150)
		end,
	})
	vim.api.nvim_create_autocmd({ "CursorMoved", "CursorMovedI" }, {
		group = group,
		buffer = buf,
		callback = function() M.show_comments(buf) end,
	})
	vim.api.nvim_create_autocmd("BufWinEnter", { group = group, buffer = buf, callback = function() set_conceal(buf) end })
	-- re-wrap comments to the new width
	vim.api.nvim_create_autocmd("WinResized", {
		group = group,
		callback = function()
			if vim.api.nvim_buf_is_valid(buf) then M.show_comments(buf) end
		end,
	})
	vim.api.nvim_create_autocmd("BufWipeout", { group = group, buffer = buf, callback = function() M.detach(buf) end })
	set_conceal(buf)
	render(buf)
end

function M.detach(buf)
	if not state[buf] then return end
	state[buf] = nil
	pcall(vim.api.nvim_del_augroup_by_name, "criticmarkup_" .. buf)
	if vim.api.nvim_buf_is_valid(buf) then
		vim.api.nvim_buf_clear_namespace(buf, ns, 0, -1)
		vim.api.nvim_buf_clear_namespace(buf, ns_show, 0, -1)
	end
end

function M.toggle_raw(buf)
	buf = buf or vim.api.nvim_get_current_buf()
	local st = state[buf]
	if not st then return end
	st.raw = not st.raw
	set_conceal(buf)
	render(buf)
end

function M.toggle_all(buf)
	buf = buf or vim.api.nvim_get_current_buf()
	local st = state[buf]
	if not st then return end
	st.show_all = not st.show_all
	M.show_comments(buf)
end

local function clean(comment)
	return (comment:gsub("<<}", "<<"):gsub("\n", " "))
end

local function ask(prompt, default, callback)
	vim.ui.input({ prompt = prompt, default = default }, function(value)
		if value and vim.trim(value) ~= "" then callback(clean(vim.trim(value))) end
	end)
end

-- Comments on the last visual selection.
function M.comment_selection()
	local buf = vim.api.nvim_get_current_buf()
	local mode = vim.fn.visualmode()
	local s, e = vim.fn.getpos("'<"), vim.fn.getpos("'>")
	local sr, sc, er = s[2] - 1, s[3] - 1, e[2] - 1
	local last = vim.api.nvim_buf_get_lines(buf, er, er + 1, false)[1] or ""
	local ec
	if mode == "V" then
		sc = 0
		ec = #last
	else
		local col = math.min(e[3], #last)
		ec = col > 0 and (col + vim.str_utf_end(last, col)) or 0
	end
	ask("Comment: ", "", function(comment)
		vim.api.nvim_buf_set_text(buf, er, ec, er, ec, { "==}{>>" .. comment .. "<<}" })
		vim.api.nvim_buf_set_text(buf, sr, sc, sr, sc, { "{==" })
		render(buf)
	end)
end

-- A comment at the end of the cursor's line.
function M.comment_line()
	local buf = vim.api.nvim_get_current_buf()
	local row = vim.api.nvim_win_get_cursor(0)[1] - 1
	local line = vim.api.nvim_buf_get_lines(buf, row, row + 1, false)[1] or ""
	ask("Comment: ", "", function(comment)
		vim.api.nvim_buf_set_text(buf, row, #line, row, #line, { "{>>" .. comment .. "<<}" })
		render(buf)
	end)
end

local function replace(buf, s, e, lines)
	local st = state[buf]
	local sr, sc = st.at(s)
	local er, ec = st.at(e + 1)
	vim.api.nvim_buf_set_text(buf, sr, sc, er, ec, lines)
end

function M.edit_at_cursor()
	local buf = vim.api.nvim_get_current_buf()
	local item = M.at_cursor(buf)
	if not item or not item.cm then return vim.notify("No comment here", vim.log.levels.WARN) end
	ask("Comment: ", item.comment, function(comment)
		local prefix = item.author == "pi" and "pi: " or ""
		replace(buf, item.cm[1], item.cm[2], { "{>>" .. prefix .. comment .. "<<}" })
		render(buf)
	end)
end

-- Removes the comment under the cursor, keeping the text it was on.
function M.delete_at_cursor()
	local buf = vim.api.nvim_get_current_buf()
	local item = M.at_cursor(buf)
	if not item then return vim.notify("No comment here", vim.log.levels.WARN) end
	-- back to front so offsets stay valid
	if item.cm then replace(buf, item.cm[1], item.cm[2], { "" }) end
	if item.hl then
		replace(buf, item.hl[2] - 2, item.hl[2], { "" })
		replace(buf, item.hl[1], item.hl[1] + 2, { "" })
	end
	render(buf)
end

function M.jump(dir)
	local buf = vim.api.nvim_get_current_buf()
	local st = state[buf]
	if not st or not st.items then return end
	local row = vim.api.nvim_win_get_cursor(0)[1] - 1
	local rows = {}
	for _, item in ipairs(st.items) do
		local sr, sc = st.at((item.hl or item.cm)[1])
		table.insert(rows, { sr, sc })
	end
	if dir > 0 then
		for _, p in ipairs(rows) do
			if p[1] > row then return vim.api.nvim_win_set_cursor(0, { p[1] + 1, p[2] }) end
		end
	else
		for i = #rows, 1, -1 do
			if rows[i][1] < row then return vim.api.nvim_win_set_cursor(0, { rows[i][1] + 1, rows[i][2] }) end
		end
	end
end

-- The user's comments, for sending to the agent: { quote?, comment, line }.
function M.comments(buf)
	buf = buf or vim.api.nvim_get_current_buf()
	local text = buf_text(buf)
	local at = locator(text)
	local out = {}
	for _, item in ipairs(M.parse(text)) do
		if item.comment and item.author ~= "pi" and item.comment ~= "" then
			local row = at((item.hl or item.cm)[1])
			table.insert(out, { quote = item.quote, comment = item.comment, line = row + 1 })
		end
	end
	return out
end

-- Buffer-local keys for commenting; `extra` adds more.
function M.keys(buf, extra)
	if not buf or buf == 0 then buf = vim.api.nvim_get_current_buf() end
	local function map(mode, lhs, fn, desc)
		vim.keymap.set(mode, lhs, fn, { buffer = buf, desc = desc, nowait = true })
	end
	map("x", "<leader>rc", function()
		vim.api.nvim_feedkeys(vim.keycode("<Esc>"), "nx", false)
		M.comment_selection()
	end, "Review: comment on selection")
	map("n", "<leader>rc", M.comment_line, "Review: comment on line")
	map("n", "<leader>re", M.edit_at_cursor, "Review: edit comment")
	map("n", "<leader>rd", M.delete_at_cursor, "Review: delete comment")
	map("n", "<leader>rv", function() M.toggle_all(buf) end, "Review: show all comments")
	map("n", "<leader>rm", function() M.toggle_raw(buf) end, "Review: show raw markup")
	map("n", "]r", function() M.jump(1) end, "Review: next comment")
	map("n", "[r", function() M.jump(-1) end, "Review: previous comment")
	for _, k in ipairs(extra or {}) do map(k[1], k[2], k[3], k[4]) end
end

return M
