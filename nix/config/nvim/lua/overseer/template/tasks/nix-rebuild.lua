local dotfiles = vim.fn.expand("~/.dotfiles/")
local is_mac = vim.fn.has("mac") == 1

return {
	name = "nix-rebuild",
	condition = {
		dir = dotfiles,
	},
	desc = "Rebuild nix flake config",
	builder = function()
		return {
			cmd = is_mac and { "sudo" } or { "home-manager" },
			args = is_mac and { "darwin-rebuild", "switch", "--flake", "./nix#macbook" }
				or { "switch", "--flake", "./nix#m@fedora" },
			cwd = dotfiles,
			components = {
				"default",
				"on_complete_dispose",
			},
		}
	end,
}
