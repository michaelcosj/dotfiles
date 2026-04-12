require("config.helpers").safeSetup("image", {
	backend = "ueberzug",
	processor = "magick_cli",
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
})
