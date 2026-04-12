require("nvim-treesitter").install({
	"bash",
	"c",
	"cpp",
	"css",
	"dockerfile",
	"go",
	"html",
	"javascript",
	"json",
	"lua",
	"markdown",
	"python",
  "regex",
	"rust",
	"sql",
	"typescript",
	"yaml",
})

-- https://github.com/nvim-treesitter/nvim-treesitter/discussions/8621#discussioncomment-16411732
vim.api.nvim_create_autocmd("FileType", {
	pattern = { "*" },
	callback = function(args)
		local ft = vim.bo[args.buf].filetype
		local lang = vim.treesitter.language.get_lang(ft)

		if not vim.treesitter.language.add(lang) then
			-- this stupid tracking is here only because
			-- they have added warnings on absent parsers
			local available = vim.g.ts_available or require("nvim-treesitter").get_available()
			if not vim.g.ts_available then
				vim.g.ts_available = available
			end
			if vim.tbl_contains(available, lang) then
				require("nvim-treesitter").install(lang)
			end
		end

		if vim.treesitter.language.add(lang) then
			vim.treesitter.start(args.buf, lang)
			-- this is an experimental feature
			-- vim.bo.indentexpr = "v:lua.require'nvim-treesitter'.indentexpr()"
			vim.wo[0][0].foldexpr = "v:lua.vim.treesitter.foldexpr()"
			vim.wo[0][0].foldmethod = "expr"
		end
	end,
})

require("config.helpers").safeSetup("treesitter-context", {
	enable = false,
	multiwindow = false,
	max_lines = 0,
	min_window_height = 0,
	line_numbers = true,
	multiline_threshold = 20,
	trim_scope = "outer",
	mode = "cursor",
	separator = nil,
	zindex = 20,
	on_attach = nil,
})

vim.keymap.set("n", "[t", function()
	require("treesitter-context").go_to_context(vim.v.count1)
end, { silent = true })
