return {
	"3rd/image.nvim",
	build = false, -- so that it doesn't build the rock https://github.com/3rd/image.nvim/issues/91#issuecomment-2453430239
	opts = {
		backend = "ueberzug", -- or "ueberzug" or "sixel"
		processor = "magick_cli", -- or "magick_rock"
		integrations = {
			markdown = {
				enabled = true,
				download_remote_images = true,
				only_render_image_at_cursor = true,
				only_render_image_at_cursor_mode = "popup",
			},
			html = {
				enabled = true,
				download_remote_images = true,
				only_render_image_at_cursor = true,
				only_render_image_at_cursor_mode = "popup",
			},
			css = {
				enabled = true,
				download_remote_images = true,
				only_render_image_at_cursor = true,
				only_render_image_at_cursor_mode = "popup",
			},
		},
	},
}
