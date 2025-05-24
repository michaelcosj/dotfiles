require("overseer").register_template({
	name = "nix-rebuild",
	params = {},
	condition = {
		dir = vim.fn.getcwd(),
	},
	builder = function()
		return {
			cmd = { "darwin-rebuild" },
			args = { "switch", "--flake", "./nix#macbook" },
		}
	end,
})
