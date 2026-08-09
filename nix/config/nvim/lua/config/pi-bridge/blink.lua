local M = {}

local placeholders = {
	{ label = "@this", detail = "Current line or selected range" },
	{ label = "@buffer", detail = "Current buffer" },
	{ label = "@buffers", detail = "All loaded buffers" },
	{ label = "@diagnostics", detail = "Current buffer diagnostics" },
	{ label = "@marks", detail = "Current buffer marks" },
	{ label = "@quickfix", detail = "Quickfix entries" },
	{ label = "@visible", detail = "Visible window ranges" },
}

function M.new()
	return setmetatable({}, { __index = M })
end

function M:enabled()
	return vim.bo.filetype == "pi_bridge_input"
end

function M:get_trigger_characters()
	return { "@" }
end

local function token_range(ctx)
	local before_cursor = ctx.line:sub(1, ctx.cursor[2])
	local start = before_cursor:find("@[%w%._/%-]*$")
	if not start then
		return nil
	end
	return {
		start = { line = ctx.cursor[1] - 1, character = start - 1 },
		["end"] = { line = ctx.cursor[1] - 1, character = ctx.cursor[2] },
	}
end

local function item(label, detail, kind, range)
	return {
		label = label,
		detail = detail,
		kind = kind,
		filterText = label,
		textEdit = { newText = label, range = range },
		insertTextFormat = vim.lsp.protocol.InsertTextFormat.PlainText,
	}
end

function M:get_completions(ctx, callback)
	local range = token_range(ctx)
	if not range then
		callback({ items = {}, is_incomplete_forward = false, is_incomplete_backward = false })
		return
	end

	local kinds = require("blink.cmp.types").CompletionItemKind
	local items = {}
	for _, placeholder in ipairs(placeholders) do
		table.insert(items, item(placeholder.label, placeholder.detail, kinds.Keyword, range))
	end

	local command = vim.system(
		{ "git", "ls-files", "--cached", "--others", "--exclude-standard", "-z" },
		{ cwd = vim.uv.cwd(), text = true },
		function(result)
			if result.code == 0 then
				local count = 0
				for _, filename in ipairs(vim.split(result.stdout, "\0", { plain = true, trimempty = true })) do
					table.insert(items, item("@" .. filename, "Workspace file", kinds.File, range))
					count = count + 1
					if count >= 5000 then
						break
					end
				end
			end
			vim.schedule(function()
				callback({ items = items, is_incomplete_forward = false, is_incomplete_backward = false })
			end)
		end
	)

	return function()
		pcall(command.kill, command, 15)
	end
end

return M
