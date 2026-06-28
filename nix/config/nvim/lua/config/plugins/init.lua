local gh = require("config.helpers").gh

--
-- [[ Add plugins ]]
--
vim.pack.add({
	-- Colorscheme
	gh("folke/tokyonight.nvim"),

	-- Utils
	gh("nvim-lua/plenary.nvim"),

	-- lsp
	gh("neovim/nvim-lspconfig"),

	-- Treesitter
	gh("nvim-treesitter/nvim-treesitter"),
	gh("nvim-treesitter/nvim-treesitter-context"),

	-- Snacks (Finder/Pickers and other things)
	gh("folke/snacks.nvim"),

	-- Git
	gh("m00qek/baleia.nvim"),
	gh("esmuellert/codediff.nvim"), -- diff viewer
	gh("lewis6991/gitsigns.nvim"),
	gh("NeogitOrg/neogit"),

	-- Editing
	gh("echasnovski/mini.icons"),
	{ src = gh("echasnovski/mini.comment"), version = vim.version.range("*") },
	{ src = gh("echasnovski/mini.pairs"), version = vim.version.range("*") },
	{ src = gh("echasnovski/mini.surround"), version = vim.version.range("*") },

	-- Coding
	gh("folke/lazydev.nvim"),
	gh("rafamadriz/friendly-snippets"),
	gh("xzbdmw/colorful-menu.nvim"),
	{ src = gh("saghen/blink.cmp"), version = vim.version.range("1.*") },

	-- UI
	gh("nvim-lualine/lualine.nvim"),
	gh("folke/which-key.nvim"),
	gh("MeanderingProgrammer/render-markdown.nvim"),
	gh("rachartier/tiny-cmdline.nvim"),
	gh("rachartier/tiny-code-action.nvim"),

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

	-- AI
	gh("sudo-tee/opencode.nvim"),
})

--
-- [[ Configuration ]]
--
require("config.plugins.tokyonight")
require("config.plugins.nvim-treesitter")
require("config.plugins.git-signs")
require("config.plugins.mini")
require("config.plugins.snacks")
require("config.plugins.lazydev")
require("config.plugins.blink-nvim")
require("config.plugins.lualine")
require("config.plugins.which-key")
require("config.plugins.render-markdown")
require("config.plugins.tiny-cmdline")
require("config.plugins.tiny-code-action")
require("config.plugins.nvim-origami")
require("config.plugins.img-clip-nvim")
require("config.plugins.todo-comments")
require("config.plugins.conform")
require("config.plugins.overseer")
require("config.plugins.resession")
require("config.plugins.quicker")
require("config.plugins.opencode")
require("config.plugins.ale")
require("config.plugins.undotree")
require("config.plugins.neogit")
