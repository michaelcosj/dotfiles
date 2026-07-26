local ok, gruvbox = pcall(require, "gruvbox")

if not ok then
	return
end

gruvbox.setup({
	contrast = "",
	transparent_mode = true,
	overrides = {
		NormalFloat = { bg = "none" },
		FloatBorder = { bg = "none" },
		FloatTitle = { bg = "none" },
		OpencodeBorder = { bg = "none", fg = "none" },
	},
})

vim.cmd([[colorscheme gruvbox]])
