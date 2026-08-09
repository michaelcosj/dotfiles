local M = {}

local placeholders = { "@this", "@buffer", "@buffers", "@diagnostics", "@marks", "@quickfix", "@visible" }

local function highlights(text)
	local result = {}
	for _, placeholder in ipairs(placeholders) do
		local start = 1
		while true do
			local first, last = text:find(placeholder, start, true)
			if not first then
				break
			end
			table.insert(result, { first - 1, last, "Special" })
			start = last + 1
		end
	end
	return result
end

function M.input(default, callback)
	Snacks.input({
		prompt = require("config.pi-bridge.config").values.prompt,
		default = default,
		highlight = highlights,
		win = {
			b = { completion = true },
			bo = { filetype = "pi_bridge_input" },
		},
	}, function(value)
		if value and vim.trim(value) ~= "" then
			callback(value)
		end
	end)
end

function M.select_prompt(callback)
	local prompts = require("config.pi-bridge.config").values.prompts
	local items = {}
	for name, prompt in pairs(prompts) do
		table.insert(items, { name = name, prompt = prompt })
	end
	table.sort(items, function(a, b)
		return a.name < b.name
	end)
	vim.ui.select(items, {
		prompt = "Pi prompt",
		format_item = function(item)
			return item.name .. "  " .. item.prompt
		end,
	}, function(item)
		if item then
			callback(item.prompt)
		end
	end)
end

return M
