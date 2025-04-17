-- Based on https://github.com/nvim-lua/kickstart.nvim
--  Set leader key
vim.g.mapleader = " "
vim.g.maplocalleader = " "

require("config.options")
require("config.keymaps")
require("config.autocmds")
require("config.plugins")
