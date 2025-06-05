return {
	name = "nix-rebuild",
	condition = {
		dir = "/Users/synth/.dotfiles/",
	},
	desc = "Rebuild nix flake config",
	builder = function()
		return {
			cmd = { "darwin-rebuild" },
			args = { "switch", "--flake", "./nix#macbook" },
			cwd = "/Users/synth/.dotfiles/",
			components = {
				"default",
				"on_complete_dispose",
			},
		}
	end,
}
