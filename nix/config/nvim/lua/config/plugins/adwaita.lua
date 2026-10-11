vim.g.adwaita_darker = false
vim.g.adwaita_transparent = true

vim.cmd.colorscheme("adwaita")

for _, group in ipairs({ "SignColumn", "FoldColumn", "NormalFloat", "FloatBorder", "FloatTitle" }) do
	local highlight = vim.api.nvim_get_hl(0, { name = group, link = false })
	highlight.bg = nil
	vim.api.nvim_set_hl(0, group, highlight)
end

vim.api.nvim_set_hl(0, "OpencodeBorder", { bg = "none", fg = "none" })
