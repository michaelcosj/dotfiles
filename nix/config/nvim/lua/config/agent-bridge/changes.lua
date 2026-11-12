-- Review everything the agent changed, like Zed's agent review: pi saves
-- each file as it was before its first edit (see trackBaseline in the
-- agent-bridge extension), and this diffs that baseline against the file
-- now, one file at a time, ignoring git entirely.
--
-- Two layouts (changes.layout in config.lua; <leader>rt switches):
--   inline        one window: the real file, editable, with the agent's
--                 changes drawn over it by mini.diff's overlay (added lines
--                 highlighted, removed lines as virtual lines above them)
--   side-by-side  left: before the agent, right: the real file, editable
-- Keys in the review tab:
--   ]c / [c          next / previous hunk
--   <leader>rt       switch between inline and side-by-side
--   <leader>rc       comment on the change (sent to the agent that made it
--                    with <leader>rs; see comments.lua)
--   ]f / [f          next / previous file;  <leader>rf  pick a file
--   <leader>ra / rr  accept / reject the hunk under the cursor
--   <leader>rA / rR  accept / reject the whole file
--   <leader>rq       close the review
-- Accepting moves the baseline forward, so accepted hunks drop out of the
-- diff; rejecting restores pi's baseline in the real file and tells pi.
-- A file leaves the list once it matches its baseline, or once you commit
-- it: committed changes count as reviewed (see committed() below).
-- Each entry names the agent that changed the file first (`by`: "main" or
-- a child agent's name); reject notes go to that agent.
local config = require("config.agent-bridge.config")

local M = {}

M.dir = vim.fs.joinpath(
	vim.env.XDG_STATE_HOME or vim.fs.joinpath(vim.env.HOME, ".local", "state"),
	"pi",
	"agent-changes"
)

local function read(path)
	local f = io.open(path, "rb")
	if not f then return nil end
	local s = f:read("*a")
	f:close()
	return s
end

local function write(path, text)
	local tmp = path .. ".tmp"
	local f = assert(io.open(tmp, "wb"))
	f:write(text)
	f:close()
	assert(os.rename(tmp, path))
end

local function relative(path)
	return vim.fs.relpath(vim.uv.cwd(), path) or vim.fn.fnamemodify(path, ":~")
end

local function split_lines(text)
	if text == "" then return {} end
	return vim.split(text:sub(-1) == "\n" and text:sub(1, -2) or text, "\n", { plain = true })
end

local function git(dir, ...)
	local r = vim.system({ "git", "-C", dir, ... }, { text = false }):wait()
	return r.code == 0 and r.stdout or nil, r.code
end

local function entry_json(e)
	return vim.json.encode({ version = 1, agent = e.agent, by = e.by, path = e.path, exists = e.exists, baseline = e.baseline, created = e.created, head = e.head })
end

-- Committing counts as reviewing. Each entry remembers the repo's HEAD
-- (pi records it with the baseline); once a newer commit touches the
-- file, the baseline moves to the committed version, so only changes made
-- since the commit stay listed, and none if the file is unchanged since.
-- Entries without a head (older pi) take HEAD's version as the baseline
-- if a commit touched the file after the baseline was taken.
local function committed(e, file)
	-- git needs an existing directory; pi may have created the file's folder
	local dir = vim.fs.dirname(e.path)
	while not vim.uv.fs_stat(dir) and vim.fs.dirname(dir) ~= dir do dir = vim.fs.dirname(dir) end
	local head = git(dir, "rev-parse", "HEAD")
	head = head and vim.trim(head)
	if not head or head == e.head then return end
	local name = "./" .. vim.fs.relpath(dir, e.path)
	if type(e.head) == "string" then
		local _, code = git(dir, "diff", "--quiet", e.head, head, "--", name)
		if code ~= 0 and code ~= 1 then return end -- e.g. the old commit is gone
		if code == 1 then
			local text = git(dir, "show", "HEAD:" .. name)
			e.exists, e.baseline = text ~= nil, text or ""
		end
	elseif type(e.created) == "number" then
		local t = tonumber(vim.trim(git(dir, "log", "-1", "--format=%ct", "HEAD", "--", name) or ""))
		if t and t * 1000 > e.created then
			local text = git(dir, "show", "HEAD:" .. name)
			e.exists, e.baseline = text ~= nil, text or ""
		end
	end
	e.head = head
	pcall(write, file, entry_json(e))
end

-- Changed files, sorted by path. Entries that match their baseline again
-- (reverted, or an edit you rejected) are deleted on the way.
-- Each: { entry, path, exists, baseline, current_exists }.
function M.list(all)
	local out = {}
	if vim.fn.isdirectory(M.dir) == 0 then return out end
	local cwd = vim.uv.cwd()
	local scoped = not all and config.values.changes.cwd_only
	for name, kind in vim.fs.dir(M.dir) do
		if kind == "file" and name:match("%.json$") then
			local file = vim.fs.joinpath(M.dir, name)
			local ok, e = pcall(vim.json.decode, read(file) or "")
			-- Skip other projects before the git and file reads below: the
			-- statusline calls this on every write and focus change.
			if ok and type(e) == "table" and type(e.path) == "string" and not (scoped and not vim.fs.relpath(cwd, e.path)) then
				e.entry = file
				e.baseline = e.baseline or ""
				committed(e, file)
				local current = read(e.path)
				if (current == nil and not e.exists) or (current ~= nil and e.exists and current == e.baseline) then
					os.remove(file)
				else
					e.current_exists = current ~= nil
					out[#out + 1] = e
				end
			end
		end
	end
	table.sort(out, function(a, b) return a.path < b.path end)
	return out
end

-- Counts changed files like #M.list(), for the statusline, without
-- blocking: the same steps as committed() and M.list(), with each git call
-- run asynchronously. callback(n) runs on the main loop. Overlapping
-- calls are merged: only the newest one reports.
local function git_async(dir, args, callback)
	vim.system(vim.list_extend({ "git", "-C", dir }, args), { text = false }, function(r)
		vim.schedule(function() callback(r.code == 0 and r.stdout or nil, r.code) end)
	end)
end

local function git_dir(path)
	local dir = vim.fs.dirname(path)
	while not vim.uv.fs_stat(dir) and vim.fs.dirname(dir) ~= dir do dir = vim.fs.dirname(dir) end
	return dir
end

-- Async committed(): moves e's baseline forward when a commit touched it.
local function committed_async(e, file, head, done)
	if not head or head == e.head then return done() end
	local function save()
		e.head = head
		pcall(write, file, entry_json(e))
		done()
	end
	local dir = git_dir(e.path)
	local name = "./" .. vim.fs.relpath(dir, e.path)
	if type(e.head) ~= "string" then
		if type(e.created) ~= "number" then return save() end
		return git_async(dir, { "log", "-1", "--format=%ct", "HEAD", "--", name }, function(out)
			local t = tonumber(vim.trim(out or ""))
			if not (t and t * 1000 > e.created) then return save() end
			git_async(dir, { "show", "HEAD:" .. name }, function(text)
				e.exists, e.baseline = text ~= nil, text or ""
				save()
			end)
		end)
	end
	git_async(dir, { "diff", "--quiet", e.head, head, "--", name }, function(_, code)
		if code ~= 0 and code ~= 1 then return done() end -- e.g. the old commit is gone
		if code == 0 then return save() end
		git_async(dir, { "show", "HEAD:" .. name }, function(text)
			e.exists, e.baseline = text ~= nil, text or ""
			save()
		end)
	end)
end

local count_gen = 0
function M.count_async(callback)
	count_gen = count_gen + 1
	local gen = count_gen
	if vim.fn.isdirectory(M.dir) == 0 then return callback(0) end
	local cwd = vim.uv.cwd()
	local scoped = config.values.changes.cwd_only

	local entries = {}
	for name, kind in vim.fs.dir(M.dir) do
		if kind == "file" and name:match("%.json$") then
			local file = vim.fs.joinpath(M.dir, name)
			local ok, e = pcall(vim.json.decode, read(file) or "")
			if ok and type(e) == "table" and type(e.path) == "string" and not (scoped and not vim.fs.relpath(cwd, e.path)) then
				e.baseline = e.baseline or ""
				entries[#entries + 1] = { e = e, file = file, dir = git_dir(e.path) }
			end
		end
	end
	if #entries == 0 then return callback(0) end

	-- One `git rev-parse HEAD` per directory, not per file.
	local heads, dirs = {}, {}
	for _, x in ipairs(entries) do
		if heads[x.dir] == nil then heads[x.dir] = false; dirs[#dirs + 1] = x.dir end
	end

	local function finish()
		if gen ~= count_gen then return end -- a newer count replaced this one
		local n = 0
		for _, x in ipairs(entries) do
			local current = read(x.e.path)
			local same = (current == nil and not x.e.exists) or (current ~= nil and x.e.exists and current == x.e.baseline)
			if same then os.remove(x.file) else n = n + 1 end
		end
		callback(n)
	end

	local pending = #dirs
	for _, dir in ipairs(dirs) do
		git_async(dir, { "rev-parse", "HEAD" }, function(out)
			heads[dir] = out and vim.trim(out) or false
			pending = pending - 1
			if pending > 0 then return end
			if gen ~= count_gen then return end
			local left = #entries
			for _, x in ipairs(entries) do
				committed_async(x.e, x.file, heads[x.dir] or nil, function()
					left = left - 1
					if left == 0 then finish() end
				end)
			end
		end)
	end
end

-- agent: who made the change (entry.by); pi passes notes for a child agent on to it.
local function note(text, agent)
	local bridge = require("config.agent-bridge.bridge")
	if bridge.pipe then bridge.request("note", { text = text, agent = agent }, function() end) end
end

-- " (by alpha)" for a child agent's change; nothing for the main pi.
local function by(e)
	return (e.by and e.by ~= "main") and (" (by " .. e.by .. ")") or ""
end

-- ---- the review tab ----

-- R: { tab, entries, index, layout, left_win (side-by-side only), right_win,
--      left (the baseline buffer, hidden when inline), right (the real file),
--      mapped = { [buf] = true }, saved = { [buf] = { [lhs] = mapping } }, noted = {} }
local R

local keys = { "]f", "[f", "]c", "[c", "<leader>rf", "<leader>rt", "<leader>ra", "<leader>rr", "<leader>rA", "<leader>rR", "<leader>rq" }

-- The inline layout needs mini.diff (see plugins/mini.lua).
local function layout()
	if config.values.changes.layout == "inline" and _G.MiniDiff then return "inline" end
	return "side-by-side"
end

local function mapping(buf, lhs)
	return vim.api.nvim_buf_call(buf, function() return vim.fn.maparg(lhs, "n", false, true) end)
end

local function ours(buf, lhs)
	local m = mapping(buf, lhs)
	return m.buffer == 1 and type(m.desc) == "string" and m.desc:find("^Agent changes") ~= nil
end

-- Removes the review's keys and overlay from buf, and puts back the
-- buffer-local mappings they replaced (gitsigns' ]c / [c).
local function unmap(buf)
	if not (buf and vim.api.nvim_buf_is_valid(buf)) then return end
	for _, lhs in ipairs(keys) do
		if ours(buf, lhs) then pcall(vim.keymap.del, "n", lhs, { buffer = buf }) end
	end
	for _, m in pairs(R and R.saved[buf] or {}) do
		if m then pcall(vim.api.nvim_buf_call, buf, function() vim.fn.mapset("n", false, m) end) end
	end
	if R then R.saved[buf] = nil end
	if _G.MiniDiff then pcall(MiniDiff.disable, buf) end
	vim.b[buf].agent_review_by = nil
end

-- Scratch buffers are hidden, not wiped, when their window closes:
-- Neovim 0.12 can crash wiping a buffer that is still in diff mode. They
-- are deleted here, once no window shows them.
local scratch_bufs = {}

local function drop_scratch()
	for buf in pairs(scratch_bufs) do
		if not vim.api.nvim_buf_is_valid(buf) then
			scratch_bufs[buf] = nil
		elseif vim.fn.bufwinid(buf) == -1 and not (R and buf == R.left) then -- inline keeps R.left hidden
			pcall(vim.api.nvim_buf_delete, buf, { force = true })
			scratch_bufs[buf] = nil
		end
	end
end

local function cleanup()
	if not R then return end
	for buf in pairs(R.mapped) do unmap(buf) end
	R = nil
	vim.schedule(drop_scratch)
end

function M.close()
	if not R then return end
	local tab = R.tab
	cleanup()
	if vim.api.nvim_tabpage_is_valid(tab) then
		for _, win in ipairs(vim.api.nvim_tabpage_list_wins(tab)) do
			vim.api.nvim_win_call(win, function() vim.cmd("diffoff") end)
		end
		if #vim.api.nvim_list_tabpages() > 1 then
			pcall(vim.cmd, vim.api.nvim_tabpage_get_number(tab) .. "tabclose")
		else
			vim.cmd("silent! only | enew")
		end
	end
end

local show

local function tell_pi(e, whole)
	local key = e.path .. (whole and ":file" or ":hunk")
	if R.noted[key] then return end
	R.noted[key] = true
	local rel = relative(e.path)
	note(whole
		and ("The user rejected all of your changes to " .. rel .. " in Neovim and restored the file to how it was before you edited it. Read it again before editing it further.")
		or ("The user reverted some of your changes to " .. rel .. " in Neovim. Read it again before editing it further."), e.by)
end

-- Drops the current file from the list and shows the next one.
local function resolved()
	local e = R.entries[R.index]
	os.remove(e.entry)
	table.remove(R.entries, R.index)
	vim.schedule(function() require("config.agent-bridge.statusline").refresh() end)
	if #R.entries == 0 then
		M.close()
		return vim.notify("All agent changes reviewed", vim.log.levels.INFO)
	end
	show(math.min(R.index, #R.entries))
end

local function same()
	local a = vim.api.nvim_buf_get_lines(R.left, 0, -1, false)
	local b = vim.api.nvim_buf_get_lines(R.right, 0, -1, false)
	if #a == 1 and a[1] == "" then a = {} end
	if #b == 1 and b[1] == "" then b = {} end
	return vim.deep_equal(a, b)
end

local function save_baseline()
	local e = R.entries[R.index]
	local lines = vim.api.nvim_buf_get_lines(R.left, 0, -1, false)
	local empty = #lines == 1 and lines[1] == ""
	e.baseline = empty and "" or (table.concat(lines, "\n") .. "\n")
	e.exists = e.exists or e.baseline ~= ""
	write(e.entry, entry_json(e))
	vim.bo[R.left].modified = false
end

-- Hunks between the baseline (R.left) and the file (R.right), as
-- { start_a, count_a, start_b, count_b }. Computed here rather than with
-- :diffget/:diffput, which misapply blocks that diffopt's linematch splits
-- up. Inline uses mini.diff's options, so these are the hunks it draws.
local function diff_hunks()
	local function text(buf)
		local l = vim.api.nvim_buf_get_lines(buf, 0, -1, false)
		if #l == 1 and l[1] == "" then return {}, "" end
		return l, table.concat(l, "\n") .. "\n"
	end
	local a, at = text(R.left)
	local b, bt = text(R.right)
	local opts = { result_type = "indices", algorithm = "histogram" }
	if R.layout == "inline" then
		local o = MiniDiff.config.options
		opts.algorithm, opts.indent_heuristic, opts.linematch = o.algorithm, o.indent_heuristic, o.linematch
	end
	return (vim.text and vim.text.diff or vim.diff)(at, bt, opts), a, b
end

-- Inline: shows the baseline as mini.diff's reference text, with the overlay on.
local function overlay()
	if not R or R.layout ~= "inline" or not vim.api.nvim_buf_is_valid(R.right) then return end
	-- A string: an empty table means "no reference" in mini.diff 0.18.
	local lines = vim.api.nvim_buf_get_lines(R.left, 0, -1, false)
	local empty = #lines == 1 and lines[1] == "" -- an empty file, not one blank line
	MiniDiff.set_ref_text(R.right, empty and "" or table.concat(lines, "\n") .. "\n")
	local function on()
		if not R or R.layout ~= "inline" or not vim.api.nvim_buf_is_valid(R.right) then return end
		local d = MiniDiff.get_buf_data(R.right)
		if d and not d.overlay then MiniDiff.toggle_overlay(R.right) end
	end
	on()
	-- mini.diff turns the overlay off in a scheduled BufWinEnter callback
	-- (e.g. after the baseline window closes); turn it on again after that.
	vim.schedule(on)
end

-- Inline ]c / [c: the next hunk starting after the cursor line (or at it,
-- with `at`), or the previous one before it. No wrap, like Vim's ]c.
local function goto_hunk(dir, at)
	local line = vim.api.nvim_win_get_cursor(R.right_win)[1]
	local target
	for _, h in ipairs((diff_hunks())) do
		local start = math.max(h[3], 1)
		if dir == "next" and (start > line or (at and start == line)) then target = target or start end
		if dir == "prev" and start < line then target = start end
	end
	if target then vim.api.nvim_win_set_cursor(R.right_win, { target, 0 }) end
end

local function hunk(accept)
	local e = R.entries[R.index]
	if not e.current_exists then
		return vim.notify("pi deleted this file; accept or reject the whole file", vim.log.levels.WARN)
	end
	local win = vim.api.nvim_get_current_win()
	local in_right = win == R.right_win
	if not in_right and win ~= R.left_win then return end
	local hs, a, b = diff_hunks()
	if #hs == 0 then return resolved() end
	-- the hunk at the cursor, or the nearest one above it (like :diffget)
	local line = vim.api.nvim_win_get_cursor(win)[1]
	local h = hs[1]
	for _, x in ipairs(hs) do
		local start = in_right and x[3] or x[1]
		if math.max(start, 1) <= line then h = x end
	end
	local sa, ca, sb, cb = h[1], h[2], h[3], h[4]
	-- replace one side's span of the hunk with the other side's lines
	local function put(buf, s, c, lines)
		local first = c == 0 and s or s - 1 -- c == 0: insert after line s
		vim.bo[buf].modifiable = true
		vim.api.nvim_buf_set_lines(buf, first, first + c, false, lines)
	end
	if accept then
		put(R.left, sa, ca, vim.list_slice(b, sb, sb + cb - 1))
	else
		put(R.right, sb, cb, vim.list_slice(a, sa, sa + ca - 1))
	end
	if accept then
		save_baseline()
	else
		vim.api.nvim_win_call(R.right_win, function() vim.cmd("silent write") end)
		tell_pi(e, false)
	end
	if same() then return resolved() end
	-- land on the next hunk
	if R.layout == "inline" then
		overlay()
		goto_hunk("next", true)
	else
		vim.cmd("diffupdate")
		pcall(vim.cmd, "normal! ]c")
	end
end

local function toggle_layout()
	R.layout = R.layout == "inline" and "side-by-side" or "inline"
	if R.layout == "inline" and not _G.MiniDiff then
		R.layout = "side-by-side"
		return vim.notify("The inline layout needs mini.diff", vim.log.levels.WARN)
	end
	show(R.index, vim.api.nvim_win_get_cursor(R.right_win))
end

local function whole(accept)
	local e = R.entries[R.index]
	if accept then return resolved() end
	local rel = relative(e.path)
	if not e.exists then
		if vim.fn.confirm("pi created " .. rel .. ". Delete it?", "&Delete\n&Cancel", 2) ~= 1 then return end
		os.remove(e.path)
		local buf = vim.fn.bufnr(e.path)
		if buf > 0 then pcall(vim.api.nvim_buf_delete, buf, { force = true }) end
	else
		vim.fn.mkdir(vim.fs.dirname(e.path), "p")
		write(e.path, e.baseline)
		local buf = vim.fn.bufnr(e.path)
		if buf > 0 and vim.api.nvim_buf_is_loaded(buf) then
			vim.api.nvim_buf_call(buf, function() vim.cmd("silent edit!") end)
		end
	end
	tell_pi(e, true)
	resolved()
end

local function map_buf(buf)
	local function map(lhs, fn, desc)
		-- Deferred: these wipe or remap the buffer whose mapping is running,
		-- which crashes Neovim if done inside the mapping.
		vim.keymap.set("n", lhs, function() vim.schedule(fn) end, { buffer = buf, desc = desc, nowait = true })
	end
	map("]f", function() show(R.index % #R.entries + 1) end, "Agent changes: next file")
	map("[f", function() show((R.index - 2) % #R.entries + 1) end, "Agent changes: previous file")
	map("<leader>rf", function() M.pick() end, "Agent changes: pick file")
	map("<leader>rt", toggle_layout, "Agent changes: inline / side-by-side")
	if R.layout == "inline" and buf == R.right then
		-- Vim's ]c needs two diff windows; save what these replace (gitsigns')
		R.saved[buf] = R.saved[buf] or {}
		for _, lhs in ipairs({ "]c", "[c" }) do
			if R.saved[buf][lhs] == nil and not ours(buf, lhs) then
				local m = mapping(buf, lhs)
				R.saved[buf][lhs] = m.buffer == 1 and m or false
			end
		end
		map("]c", function() goto_hunk("next") end, "Agent changes: next hunk")
		map("[c", function() goto_hunk("prev") end, "Agent changes: previous hunk")
	end
	map("<leader>ra", function() hunk(true) end, "Agent changes: accept hunk")
	map("<leader>rr", function() hunk(false) end, "Agent changes: reject hunk")
	map("<leader>rA", function() whole(true) end, "Agent changes: accept file")
	map("<leader>rR", function() whole(false) end, "Agent changes: reject file")
	map("<leader>rq", M.close, "Agent changes: close review")
	R.mapped[buf] = true
	-- review comments on this file go to the agent that changed it
	local e = R.entries[R.index]
	if e and buf == R.right then vim.b[buf].agent_review_by = e.by or "main" end
end

local function scratch(name, lines, ft, modifiable)
	local buf = vim.api.nvim_create_buf(false, true)
	vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
	if name then pcall(vim.api.nvim_buf_set_name, buf, name) end
	vim.bo[buf].bufhidden = "hide"
	scratch_bufs[buf] = true
	vim.bo[buf].modified = false
	vim.bo[buf].modifiable = modifiable
	if ft then vim.bo[buf].filetype = ft end
	return buf
end

-- cursor: keep this { line, col } (switching layouts) instead of jumping
-- to the first hunk.
show = function(i, cursor)
	R.index = i
	local e = R.entries[i]
	local rel = relative(e.path)
	local ft = vim.filetype.match({ filename = e.path })
	for _, win in ipairs({ R.left_win, R.right_win }) do
		if win and vim.api.nvim_win_is_valid(win) then
			vim.api.nvim_win_call(win, function() vim.cmd("diffoff") end)
		end
	end
	for _, buf in pairs({ R.left, R.right }) do
		unmap(buf)
		R.mapped[buf] = nil
	end

	-- windows: the baseline's only in side-by-side
	if R.layout == "inline" and R.left_win and vim.api.nvim_win_is_valid(R.left_win) then
		vim.api.nvim_win_close(R.left_win, true)
		R.left_win = nil
	elseif R.layout == "side-by-side" and not (R.left_win and vim.api.nvim_win_is_valid(R.left_win)) then
		vim.api.nvim_set_current_win(R.right_win)
		vim.cmd("leftabove vsplit")
		R.left_win = vim.api.nvim_get_current_win()
	end

	-- right: the real file (or a placeholder if pi deleted it)
	if e.current_exists then
		vim.api.nvim_win_call(R.right_win, function()
			vim.cmd("edit " .. vim.fn.fnameescape(e.path))
			vim.cmd("silent! checktime")
		end)
	else
		vim.api.nvim_win_set_buf(R.right_win, scratch("agent-changes://" .. rel .. " (deleted)", {}, ft, false))
	end
	R.right = vim.api.nvim_win_get_buf(R.right_win)

	-- left: the baseline; modifiable so accepted hunks can be put into it
	local left_name = "agent-changes://" .. rel .. " (before agent)"
	R.left = scratch(nil, e.exists and split_lines(e.baseline) or {}, ft, true)
	vim.bo[R.left].buftype = "nofile"
	if R.left_win then vim.api.nvim_win_set_buf(R.left_win, R.left) end
	-- named once the old baseline (which may have the same name) is gone
	local left = R.left
	vim.schedule(function()
		drop_scratch()
		if vim.api.nvim_buf_is_valid(left) then pcall(vim.api.nvim_buf_set_name, left, left_name) end
	end)

	map_buf(R.left)
	map_buf(R.right)
	if R.layout == "inline" then
		overlay()
	else
		for _, win in ipairs({ R.left_win, R.right_win }) do
			vim.api.nvim_win_call(win, function() vim.cmd("diffthis") end)
		end
		vim.wo[R.left_win].winbar = "%#Comment# before agent" .. (e.exists and "" or " (new file)") .. "%*"
	end
	local label = rel:gsub("%%", "%%%%")
	vim.wo[R.right_win].winbar = string.format(
		"%%#DiagnosticWarn# 󰚩 %s%%*%%#Comment#%s%s (%d/%d)%%*",
		label, (by(e):gsub("%%", "%%%%")), (R.layout == "inline" and not e.exists) and " (new file)" or "", i, #R.entries)
	vim.api.nvim_set_current_win(R.right_win)
	if cursor then
		pcall(vim.api.nvim_win_set_cursor, R.right_win, cursor)
	else
		vim.api.nvim_win_set_cursor(R.right_win, { 1, 0 })
		if R.layout == "inline" then
			goto_hunk("next", true)
		elseif vim.fn.diff_hlID(1, 1) == 0 then
			pcall(vim.cmd, "normal! ]c")
		end
	end
end

function M.pick()
	if not R then return end
	local items = {}
	for i, e in ipairs(R.entries) do items[i] = i end
	vim.ui.select(items, {
		prompt = "Agent changes",
		format_item = function(i)
			local e = R.entries[i]
			return relative(e.path) .. by(e) .. (not e.exists and "  (new)" or not e.current_exists and "  (deleted)" or "")
		end,
	}, function(i) if i then show(i) end end)
end

function M.open()
	local entries = M.list()
	if #entries == 0 then return vim.notify("No agent changes to review", vim.log.levels.INFO) end
	if R then M.close() end
	vim.cmd("tabnew")
	vim.t.agent_changes = true
	R = { tab = vim.api.nvim_get_current_tabpage(), entries = entries, layout = layout(), mapped = {}, saved = {}, noted = {} }
	R.right_win = vim.api.nvim_get_current_win()
	local placeholder = vim.api.nvim_get_current_buf()
	show(1)
	if vim.api.nvim_buf_is_valid(placeholder) and placeholder ~= R.right then
		pcall(vim.api.nvim_buf_delete, placeholder, { force = true })
	end
end

local function all(accept)
	local entries = M.list()
	if #entries == 0 then return vim.notify("No agent changes", vim.log.levels.INFO) end
	local verb = accept and "Accept" or "Reject"
	if vim.fn.confirm(string.format("%s pi's changes to %d file(s)?", verb, #entries), "&Yes\n&No", 2) ~= 1 then return end
	if R then M.close() end
	for _, e in ipairs(entries) do
		if not accept then
			if not e.exists then
				os.remove(e.path)
			else
				vim.fn.mkdir(vim.fs.dirname(e.path), "p")
				write(e.path, e.baseline)
			end
			local buf = vim.fn.bufnr(e.path)
			if buf > 0 and vim.api.nvim_buf_is_loaded(buf) then
				if e.exists then
					vim.api.nvim_buf_call(buf, function() vim.cmd("silent edit!") end)
				else
					pcall(vim.api.nvim_buf_delete, buf, { force = true })
				end
			end
		end
		os.remove(e.entry)
	end
	if not accept then
		-- one note per agent, listing only its files
		local per = {}
		for _, e in ipairs(entries) do
			local who = e.by or "main"
			per[who] = per[who] or {}
			table.insert(per[who], relative(e.path))
		end
		for who, names in pairs(per) do
			note("The user rejected all of your changes in Neovim and restored these files to how they were before you edited them: "
				.. table.concat(names, ", ") .. ". Read them again before editing further.", who)
		end
	end
	vim.notify(string.format("%sed changes to %d file(s)", verb, #entries), vim.log.levels.INFO)
	require("config.agent-bridge.statusline").refresh()
end

function M.setup()
	local group = vim.api.nvim_create_augroup("agent_bridge_changes", { clear = true })
	vim.api.nvim_create_autocmd("TabClosed", {
		group = group,
		callback = function()
			if R and not vim.api.nvim_tabpage_is_valid(R.tab) then cleanup() end
		end,
	})
	-- The review keys are buffer-local; a buffer that is reloaded or opened
	-- again in a diff window would otherwise lose them, and <leader>rA would
	-- fall through to `r`. Re-apply them whenever a review window shows one.
	vim.api.nvim_create_autocmd({ "BufEnter", "BufWinEnter" }, {
		group = group,
		callback = function(a)
			if not R or vim.api.nvim_get_current_tabpage() ~= R.tab then return end
			local win = vim.api.nvim_get_current_win()
			if win ~= R.left_win and win ~= R.right_win then return end
			if win == R.right_win and a.buf ~= R.right then
				-- the file was wiped and opened again: a new buffer for the same path
				local e = R.entries[R.index]
				if not e or vim.fs.normalize(vim.api.nvim_buf_get_name(a.buf)) ~= vim.fs.normalize(e.path) then return end
				R.right = a.buf
			end
			if a.buf == R.left or a.buf == R.right then map_buf(a.buf) end
			-- a reload (:edit) disables mini.diff in the buffer; turn it back on
			if a.buf == R.right and R.layout == "inline" then
				local d = MiniDiff.get_buf_data(a.buf)
				if not (d and d.ref_text and d.overlay) then overlay() end
			end
		end,
	})
	local last
	vim.api.nvim_create_autocmd("User", {
		group = group,
		pattern = "AgentEvent:agent_settled",
		callback = function()
			if not config.values.changes.notify then return end
			vim.defer_fn(function()
				local n = #M.list()
				if n > 0 and n ~= last then
					vim.notify(string.format("agent changed %d file%s · <leader>ad to review", n, n == 1 and "" or "s"), vim.log.levels.INFO)
				end
				last = n
			end, 200)
		end,
	})
	vim.api.nvim_create_user_command("AgentChanges", function(c)
		if c.args == "" or c.args == "review" then return M.open() end
		if c.args == "accept-all" then return all(true) end
		if c.args == "reject-all" then return all(false) end
		if c.args == "list" then
			local lines = vim.tbl_map(function(e) return relative(e.path) .. by(e) end, M.list())
			return vim.notify(#lines > 0 and table.concat(lines, "\n") or "No agent changes", vim.log.levels.INFO)
		end
		vim.notify("AgentChanges: review | list | accept-all | reject-all", vim.log.levels.ERROR)
	end, {
		nargs = "?",
		complete = function() return { "review", "list", "accept-all", "reject-all" } end,
		desc = "Review the files the agent changed",
	})
	vim.keymap.set("n", "<leader>ad", M.open, { desc = "Agent: review changes" })
end

return M
