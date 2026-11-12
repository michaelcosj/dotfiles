local treesitter_ok, treesitter = pcall(require, "nvim-treesitter")

if not treesitter_ok then
	return
end

treesitter.setup({})

vim.api.nvim_create_autocmd("PackChanged", {
	callback = function(ev)
		local name, kind = ev.data.spec.name, ev.data.kind
		if name == "nvim-treesitter" and (kind == "install" or kind == "update") then
			if not ev.data.active then
				vim.cmd.packadd("nvim-treesitter")
			end
			-- the usual parsers; the FileType autocmd below installs others on demand
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
				"svelte",
				"typescript",
				"tsx",
				"yaml",
			})
			vim.cmd("TSUpdate")
		end
	end,
})

local available -- parsers nvim-treesitter can install (a Lua local: a g: var copies it on every read)

-- https://github.com/nvim-treesitter/nvim-treesitter/discussions/8621#discussioncomment-16411732
vim.api.nvim_create_autocmd("FileType", {
	pattern = { "*" },
	callback = function(args)
		local ft = vim.bo[args.buf].filetype
		local lang = vim.treesitter.language.get_lang(ft)
		if not lang then
			return
		end

		if not vim.treesitter.language.add(lang) then
			available = available or treesitter.get_available()
			if vim.tbl_contains(available, lang) then
				treesitter.install(lang)
			end
		end

		if vim.treesitter.language.add(lang) then
			vim.treesitter.start(args.buf, lang)
			vim.wo[0][0].foldexpr = "v:lua.vim.treesitter.foldexpr()"
			vim.wo[0][0].foldmethod = "expr"
		end
	end,
})

local context_ok, context = pcall(require, "treesitter-context")

if not context_ok then
	return
end

context.setup({
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
	context.go_to_context(vim.v.count1)
end, { silent = true })
