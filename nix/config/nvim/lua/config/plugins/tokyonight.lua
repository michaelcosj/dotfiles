local tokyonight = require("config.helpers").safeSetup("tokyonight", {
	style = "night",
	transparent = true,
	on_highlights = function(hl)
		hl.NormalFloat = { bg = "none" }
		hl.FloatBorder = { bg = "none" }
		hl.FloatTitle = { bg = "none" }
		hl.OpencodeBorder = { bg = "none", fg = "none" }
	end,
})

if tokyonight then
	vim.cmd([[colorscheme tokyonight]])
end
