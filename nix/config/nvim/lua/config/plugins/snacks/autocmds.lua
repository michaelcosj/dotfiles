vim.api.nvim_create_autocmd("User", {
	pattern = "VeryLazy",
	callback = function()
		local Snacks = require("snacks")

		vim.api.nvim_create_autocmd("BufWinLeave", {
			group = vim.api.nvim_create_augroup("nvim_snacks_explorer_redraw", { clear = true }),
			pattern = "*",
			callback = function()
				if vim.bo.filetype == "snacks_explorer" then
					vim.schedule(function()
						---@diagnostic disable-next-line: param-type-mismatch
						pcall(vim.cmd, "redraw!")
					end)
				end
			end,
		})

		_G.dd = function(...)
			Snacks.debug.inspect(...)
		end

		_G.bt = function()
			Snacks.debug.backtrace()
		end

		vim.print = _G.dd

		Snacks.toggle.diagnostics():map("<leader>ud")
		Snacks.toggle.treesitter():map("<leader>uT")

		Snacks.toggle.indent():map("<leader>ug")
		Snacks.toggle.dim():map("<leader>uD")

		Snacks.toggle.option("spell", { name = "Spelling" }):map("<leader>us")
		Snacks.toggle.option("wrap", { name = "Wrap" }):map("<leader>uw")

		Snacks.toggle.line_number():map("<leader>ul")
		Snacks.toggle.option("relativenumber", { name = "Relative Number" }):map("<leader>uL")

		Snacks.toggle.inlay_hints():map("<leader>uh")
		Snacks.toggle
			.option("conceallevel", { off = 0, on = vim.o.conceallevel > 0 and vim.o.conceallevel or 2 })
			:map("<leader>uc")

		Snacks.toggle.option("background", { off = "light", on = "dark", name = "Dark Background" }):map("<leader>ub")
	end,
})
