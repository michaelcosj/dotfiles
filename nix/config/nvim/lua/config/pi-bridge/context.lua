local M = {}

local function relative(filename)
	if filename == "" then
		return "[unnamed buffer]"
	end
	return vim.fs.relpath(vim.uv.cwd(), filename) or filename
end

local function lines(bufnr, first, last)
	return vim.api.nvim_buf_get_lines(bufnr, first - 1, last, false)
end

local function fenced(bufnr, first, last)
	local filetype = vim.bo[bufnr].filetype
	return table.concat({ "```" .. filetype, table.concat(lines(bufnr, first, last), "\n"), "```" }, "\n")
end

local function location(bufnr, first, last)
	local filename = vim.api.nvim_buf_get_name(bufnr)
	if filename == "" or vim.bo[bufnr].modified then
		return string.format("%s lines %d-%d:\n%s", relative(filename), first, last, fenced(bufnr, first, last))
	end
	local suffix = first == last and (":L" .. first) or string.format(":L%d-L%d", first, last)
	return "@" .. relative(filename) .. suffix
end

function M.current(range)
	local bufnr = range and range.bufnr or vim.api.nvim_get_current_buf()
	local first = range and range.first or vim.api.nvim_win_get_cursor(0)[1]
	local last = range and range.last or first
	return location(bufnr, first, last)
end

local function buffer_context(bufnr)
	local count = vim.api.nvim_buf_line_count(bufnr)
	return location(bufnr, 1, count)
end

local function diagnostics()
	local result = {}
	for _, diagnostic in ipairs(vim.diagnostic.get(0, { severity = { min = vim.diagnostic.severity.WARN } })) do
		table.insert(result, string.format("%s:%d:%d: %s", relative(vim.api.nvim_buf_get_name(0)), diagnostic.lnum + 1, diagnostic.col + 1, diagnostic.message))
	end
	return #result > 0 and table.concat(result, "\n") or "No warnings or errors in the current buffer."
end

local function marks()
	local result = {}
	for _, mark in ipairs(vim.fn.getmarklist(0)) do
		if mark.mark:match("'[a-zA-Z]") then
			table.insert(result, string.format("%s @%s:L%d", mark.mark, relative(vim.api.nvim_buf_get_name(0)), mark.pos[2]))
		end
	end
	return table.concat(result, "\n")
end

local function quickfix()
	local result = {}
	for _, item in ipairs(vim.fn.getqflist()) do
		local filename = item.bufnr > 0 and vim.api.nvim_buf_get_name(item.bufnr) or item.filename or "?"
		table.insert(result, string.format("@%s:L%d:%d: %s", relative(filename), item.lnum or 1, item.col or 1, item.text or ""))
	end
	return table.concat(result, "\n")
end

function M.expand(text, range)
	local current_buf = range and range.bufnr or vim.api.nvim_get_current_buf()
	local visible = {}
	for _, win in ipairs(vim.api.nvim_tabpage_list_wins(0)) do
		local bufnr = vim.api.nvim_win_get_buf(win)
		local first = vim.fn.line("w0", win)
		local last = vim.fn.line("w$", win)
		table.insert(visible, location(bufnr, first, last))
	end
	local buffers = {}
	for _, bufnr in ipairs(vim.api.nvim_list_bufs()) do
		if vim.api.nvim_buf_is_loaded(bufnr) and vim.bo[bufnr].buftype == "" then
			table.insert(buffers, buffer_context(bufnr))
		end
	end
	local replacements = {
		{ "@diagnostics", diagnostics() },
		{ "@quickfix", quickfix() },
		{ "@buffers", table.concat(buffers, "\n") },
		{ "@visible", table.concat(visible, "\n") },
		{ "@buffer", buffer_context(current_buf) },
		{ "@marks", marks() },
		{ "@this", M.current(range) },
	}
	for _, replacement in ipairs(replacements) do
		text = text:gsub(replacement[1], function()
			return replacement[2]
		end)
	end
	return text
end

return M
