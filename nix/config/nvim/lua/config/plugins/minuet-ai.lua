return {
	"milanglacier/minuet-ai.nvim",
	enabled = false,
	dependencies = {
		{ "nvim-lua/plenary.nvim" },
	},
	opts = {
		virtualtext = {
			auto_trigger_ft = {},
			keymap = {
				accept = "<A-;>",
				prev = "<A-[>",
				next = "<A-]>",
				dismiss = "<A-e>",
			},
		},
		throttle = 250,
		provider = "codestral",
		provider_options = {
			codestral = {
				optional = {
					max_tokens = 512,
					stop = { "\n\n" },
				},
			},
		},
	},
}
