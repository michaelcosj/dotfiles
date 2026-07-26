local ok, tokyonight = pcall(require, "tokyonight")

if not ok then
	return
end

tokyonight.setup({
	style = "night",
	transparent = true,
	on_highlights = function(hl)
		hl.NormalFloat = { bg = "none" }
		hl.FloatBorder = { bg = "none" }
		hl.FloatTitle = { bg = "none" }
		hl.OpencodeBorder = { bg = "none", fg = "none" }
	end,
})

vim.cmd([[colorscheme tokyonight]])
