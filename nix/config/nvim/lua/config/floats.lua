-- Lazygit and a shell as Rex floating panes (<leader>gl, <C-;>), toggled
-- like the agent panel. Outside Rex they fall back to Snacks terminals.
-- Inside a float, Ctrl+A m hides it again.
local rex = require("config.rex")

local M = {}

local function bounds()
	return { 0.06, 0.06, 0.88, 0.88 }
end

-- Lazygit opens files back in this Neovim: it gets our server address as
-- $NVIM, and its edit command (lazygit-nvim-edit, set up in home/programs/git.nix)
-- calls M.edit over it.
function M.lazygit()
	if not rex.available() then return Snacks.terminal("lazygit") end
	local root = vim.fs.root(0, ".git") or vim.uv.cwd()
	rex.toggle("lazygit", nil, {
		cwd = root,
		bounds = bounds(),
		input = string.format("exec env NVIM=%s lazygit\r", vim.fn.shellescape(vim.v.servername)),
	})
end

function M.terminal()
	if not rex.available() then return Snacks.terminal() end
	rex.toggle("terminal", nil, { bounds = bounds() })
end

-- Called by lazygit-nvim-edit: open path (at line) here, hide the lazygit
-- float and switch back to Neovim.
function M.edit(path, line)
	-- inside a Neovim terminal (the Snacks fallback), get out of the float first
	local win = vim.api.nvim_get_current_win()
	if vim.api.nvim_win_get_config(win).relative ~= "" then pcall(vim.api.nvim_win_hide, win) end
	if vim.api.nvim_get_mode().mode == "t" then vim.cmd("stopinsert") end
	vim.cmd("edit " .. vim.fn.fnameescape(path))
	line = tonumber(line)
	if line and line > 0 then
		pcall(vim.api.nvim_win_set_cursor, 0, { math.min(line, vim.api.nvim_buf_line_count(0)), 0 })
		vim.cmd("normal! zvzz")
	end
	if rex.available() then
		rex.inspect(function(info)
			local float = info and info.floats.lazygit
			if float and not float.minimized then rex.hide(float) end
			rex.focus_block(rex.block)
		end)
	end
	return ""
end

function M.setup()
	vim.keymap.set("n", "<leader>gl", M.lazygit, { desc = "Lazygit (float)" })
	vim.keymap.set("n", "<c-;>", M.terminal, { desc = "Terminal (float)" })
end

return M
