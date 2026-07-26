vim.opt.foldlevel = 99
vim.opt.foldlevelstart = 99

local ok, origami = pcall(require, "origami")

if not ok then
	return
end

origami.setup({
	foldtext = {
		lineCount = {
			template = "  %d",
		},
	},
})
