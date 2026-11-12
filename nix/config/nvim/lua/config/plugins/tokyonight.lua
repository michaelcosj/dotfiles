local ok, tokyonight = pcall(require, "tokyonight")

if ok then
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
end

-- In Rex, use the rex scheme (colors follow Rex's theme); tokyonight elsewhere.
if require("config.rex-theme").in_rex() then
	vim.cmd.colorscheme("rex")
elseif ok then
	vim.cmd.colorscheme("tokyonight")
end
