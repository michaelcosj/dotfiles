local function gh(str)
	return "https://www.github.com/" .. str
end

--
-- [[ Add plugins ]]
--
vim.pack.add({
	-- Colorscheme
	gh("ellisonleao/gruvbox.nvim"),

	-- Utils
	gh("nvim-lua/plenary.nvim"),

	-- lsp
	gh("neovim/nvim-lspconfig"),

	-- Treesitter
	gh("nvim-treesitter/nvim-treesitter"),
	gh("nvim-treesitter/nvim-treesitter-context"),

	-- Git
	gh("lewis6991/gitsigns.nvim"),

	-- Editing
	gh("echasnovski/mini.icons"),
	{ src = gh("echasnovski/mini.comment"), version = vim.version.range("*") },
	{ src = gh("echasnovski/mini.pairs"), version = vim.version.range("*") },
	{ src = gh("echasnovski/mini.surround"), version = vim.version.range("*") },

	-- Snacks (Finder/Pickers and other things)
	gh("folke/snacks.nvim"),

	-- Coding
	gh("folke/lazydev.nvim"),
	gh("rafamadriz/friendly-snippets"),
	gh("xzbdmw/colorful-menu.nvim"),
	{ src = gh("saghen/blink.cmp"), version = vim.version.range("1.*") },

	-- UI
	gh("nvim-lualine/lualine.nvim"),
	gh("nvim-tree/nvim-web-devicons"),
	gh("folke/which-key.nvim"),
	gh("MeanderingProgrammer/render-markdown.nvim"),
	gh("rachartier/tiny-cmdline.nvim"),

	-- Folding
	gh("chrisgrieser/nvim-origami"),

	-- Todo
	gh("folke/todo-comments.nvim"),

	-- Formatting
	gh("stevearc/conform.nvim"),

	-- Commands
	gh("stevearc/overseer.nvim"),

	-- Session
	gh("stevearc/resession.nvim"),
	gh("stevearc/quicker.nvim"),

	-- Images
	gh("HakonHarnes/img-clip.nvim"),
	gh("3rd/image.nvim"),

	-- AI
	gh("sudo-tee/opencode.nvim"),
	gh("guill/mcp-tools.nvim"),
})

--
-- [[ Configuration ]]
--
require("config.plugins.gruvbox")
require("config.plugins.nvim-treesitter")
require("config.plugins.git-signs")
require("config.plugins.mini")
require("config.plugins.snacks")
require("config.plugins.blink-nvim")
require("config.plugins.lualine")
-- require("config.plugins.noice")
require("config.plugins.whick-key")
require("config.plugins.render-markdown")
require("config.plugins.nvim-origami")
require("config.plugins.img-clip-nvim")
require("config.plugins.todo-comments")
require("config.plugins.conform")
require("config.plugins.overseer")
require("config.plugins.resession")
require("config.plugins.quicker")
require("config.plugins.image-nvim")
require("config.plugins.opencode")

vim.g.tiny_cmdline = {
	position = { y = "30%" },
}

require("config.helpers").safeSetup("lazydev", {
	library = {
		{ path = "${3rd}/luv/library", words = { "vim%.uv" } },
	},
})

--
-- [[ Hooks ]]
--
vim.api.nvim_create_autocmd("PackChanged", {
	callback = function(ev)
		local name, kind = ev.data.spec.name, ev.data.kind
		if name == "nvim-treesitter" and kind == "update" then
			if not ev.data.active then
				vim.cmd.packadd("nvim-treesitter")
			end
			vim.cmd("TSUpdate")
		end
	end,
})

--
-- [[ Lazy loading ]]
--
-- Only load ale in php files (only used for diagnostics in php files)
vim.api.nvim_create_autocmd("FileType", {
	pattern = "php",
	callback = function()
		vim.pack.add({ gh("dense-analysis/ale") })

		local g = vim.g

		g.ale_linters = {
			php = { "phpstan" },
		}

		g.ale_linters_explicit = 1
		g.ale_echo_cursor = 0
		g.ale_use_neovim_diagnostics_api = 1
	end,
})

-- Code actions on lsp attach
vim.api.nvim_create_autocmd("LspAttach", {
	callback = function()
		vim.pack.add({ gh("rachartier/tiny-code-action.nvim") })

		require("tiny-code-action").setup({
			backend = "vim",
			picker = "snacks",
		})

		vim.keymap.set({ "n", "x" }, "g.", function()
			require("tiny-code-action").code_action({})
		end, { desc = "Code Actions", noremap = true, silent = true })
	end,
})

-- [[ Undo tree ]]
vim.cmd.packadd("nvim.undotree")
