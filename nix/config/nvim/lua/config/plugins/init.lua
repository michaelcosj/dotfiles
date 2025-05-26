------------------=[[Package Manager (lazy.nvim)]]=----------------------------
-- https://github.com/folke/lazy.nvim
local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"
if not (vim.uv or vim.loop).fs_stat(lazypath) then
	local lazyrepo = "https://github.com/folke/lazy.nvim.git"
	local out = vim.fn.system({ "git", "clone", "--filter=blob:none", "--branch=stable", lazyrepo, lazypath })
	if vim.v.shell_error ~= 0 then
		error("Error cloning lazy.nvim:\n" .. out)
	end
end

vim.opt.rtp:prepend(lazypath)

require("lazy").setup({
	install = { colorscheme = { "habamax" } },
	checker = { enabled = true },
	spec = {
		{ import = "config.plugins.snacks" },
		{ import = "config.plugins.ui" },
		{ import = "config.plugins.coding" },
		{ import = "config.plugins.editor" },
		{ import = "config.plugins.tools" },
		{ import = "config.plugins.ai" },
		{ import = "config.plugins.extras" },
	},
})
