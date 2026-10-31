------------------=[[Options]]=----------------------------
-- Remove numbers by default (minimal ui)
vim.opt.number = true
vim.opt.relativenumber = true

-- Enable mouse mode
vim.opt.mouse = "a"

-- set cmd height
vim.opt.cmdheight = 0

-- Don't show the mode
vim.opt.showmode = false

-- Enable break indent
vim.opt.breakindent = true

-- Save undo history
vim.opt.undofile = true

-- Case-insensitive searching UNLESS \C or one or more capital letters in the search term
vim.opt.ignorecase = true
vim.opt.smartcase = true

-- Keep signcolumn on by default
vim.opt.signcolumn = "yes"

-- Decrease update time
vim.opt.updatetime = 250

-- Decrease mapped sequence wait time
vim.opt.timeoutlen = 300

-- Configure how new splits should be opened
vim.opt.splitright = true
vim.opt.splitbelow = true

-- session options
vim.opt.sessionoptions = {
	"buffers",
	"curdir",
	"tabpages",
	"winsize",
	"help",
	"globals",
	"skiprtp",
	"folds",
}

-- Sets how neovim will display certain whitespace characters in the editor.
--  See `:help 'list'`
--  and `:help 'listchars'`
vim.opt.list = true
vim.opt.listchars = { tab = "» ", trail = "·", nbsp = "␣" }

-- Preview substitutions live, as you type!
vim.opt.inccommand = "split"

-- Show which line your cursor is on
vim.opt.cursorline = true

-- Minimal number of screen lines to keep above and below the cursor.
vim.opt.scrolloff = 10

-- If performing an operation that would fail due to unsaved changes in the buffer (like `:q`),
-- instead raise a dialog asking if you wish to save the current file(s)
vim.opt.confirm = true

-- Dark mode
-- vim.o.background = "dark" -- "dark" or "light" 

-- Titles
vim.opt.title = true
vim.opt.titlelen = 0 -- do not shorten title
vim.opt.titlestring = 'nvim %{expand("%:p:t")}'

-- Tabs
vim.opt.expandtab = true
vim.opt.tabstop = 2
vim.opt.shiftwidth = 0

-- Global statusline
vim.opt.laststatus = 3

-- exrc (I use this for overseer)
vim.opt.exrc = true

-- Copy through Herdr via OSC 52, but never query it (reads can time out).
-- Neovim pastes use the last copied text; use terminal paste for external text.
-- Other terminals retain Neovim's native clipboard auto-detection.
if vim.env.TERM_PROGRAM == "herdr" then
	local clipboard = { name = "OSC 52 (copy only)", copy = {}, paste = {} }
	for _, register in ipairs({ "+", "*" }) do
		local cached = { { "" }, "v" }
		local copy = require("vim.ui.clipboard.osc52").copy(register)
		clipboard.copy[register] = function(lines, regtype)
			cached = { vim.deepcopy(lines), regtype }
			copy(lines)
		end
		clipboard.paste[register] = function()
			return vim.deepcopy(cached)
		end
	end
	vim.g.clipboard = clipboard
end

-- Sync clipboard between OS and Neovim, deferred to avoid startup overhead.
vim.schedule(function()
	vim.opt.clipboard = "unnamedplus"
end)
