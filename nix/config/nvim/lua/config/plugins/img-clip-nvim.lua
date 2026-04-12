require("config.helpers").safeSetup("img-clip", {})

vim.keymap.set("n", "<leader>p", "<cmd>PasteImage<cr>", { desc = "Paste image from system clipboard" })
