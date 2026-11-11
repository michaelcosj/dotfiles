-- Comments shown as virtual lines under a row, wrapped to the window:
--
--   ▎ you: the first part of a long comment that goes on and
--   ▎      on, continued at the same indent
--
-- Used by criticmarkup.lua (plan review) and the review comments.
local M = {}

-- The width text can use in buf's widest window (virtual lines don't wrap).
function M.width(buf)
	if buf == 0 then buf = vim.api.nvim_get_current_buf() end
	local w = 0
	for _, win in ipairs(vim.fn.win_findbuf(buf)) do
		local info = vim.fn.getwininfo(win)[1]
		w = math.max(w, vim.api.nvim_win_get_width(win) - (info and info.textoff or 0))
	end
	return w > 0 and w or vim.o.columns
end

-- Splits text into lines of at most `width` display cells, at spaces where it can.
function M.wrap(text, width)
	width = math.max(width, 10)
	local out = {}
	for _, para in ipairs(vim.split(text, "\n", { plain = true })) do
		local line = ""
		for word in para:gmatch("%S+") do
			while vim.fn.strdisplaywidth(word) > width do
				-- a word longer than a line: cut it
				if line ~= "" then table.insert(out, line); line = "" end
				local n = vim.fn.strcharlen(word)
				local cut = width
				while cut > 1 and vim.fn.strdisplaywidth(vim.fn.strcharpart(word, 0, cut)) > width do cut = cut - 1 end
				table.insert(out, vim.fn.strcharpart(word, 0, cut))
				word = vim.fn.strcharpart(word, cut, n - cut)
			end
			if line == "" then
				line = word
			elseif vim.fn.strdisplaywidth(line) + 1 + vim.fn.strdisplaywidth(word) <= width then
				line = line .. " " .. word
			else
				table.insert(out, line)
				line = word
			end
		end
		table.insert(out, line)
	end
	return out
end

-- virt_lines for one comment: `who` labels the first line, later lines line up under it.
function M.lines(buf, who, text, hl, extra)
	local head = "  ▎ " .. who .. ": "
	local indent = "  ▎ " .. string.rep(" ", vim.fn.strdisplaywidth(who .. ": "))
	local out = {}
	for i, line in ipairs(M.wrap(text, M.width(buf) - vim.fn.strdisplaywidth(head) - 1)) do
		local chunks = { { (i == 1 and head or indent) .. line, hl } }
		if i == 1 and extra then table.insert(chunks, extra) end
		table.insert(out, chunks)
	end
	return out
end

return M
