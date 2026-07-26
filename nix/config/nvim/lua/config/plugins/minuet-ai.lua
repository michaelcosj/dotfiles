require("minuet").setup({
	virtualtext = {
		auto_trigger_ft = { "lua", "go", "python", "javascript", "typescript", "svelte", "rust" },
		keymap = {
			-- accept whole completion
			accept = "<A-Tab>",
			-- accept one line
			accept_line = "<A-a>",
			-- accept n lines (prompts for number)
			-- e.g. "A-z 2 CR" will accept 2 lines
			accept_n_lines = "<A-z>",
			-- Cycle to prev completion item, or manually invoke completion
			prev = "<A-[>",
			-- Cycle to next completion item, or manually invoke completion
			next = "<A-]>",
			dismiss = "<A-e>",
		},
		show_on_completion_menu = true,
	},
	provider = "openai_fim_compatible",
	provider_options = {
		openai_fim_compatible = {
			model = "mercury-edit-2",
			end_point = "https://api.inceptionlabs.ai/v1/fim/completions",
			api_key = "INCEPTION_API_KEY",
			stream = true,
		},
	},
})
