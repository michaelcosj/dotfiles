-- What session restore brings back after the Rex server restarts.
-- Rex itself restores sessions, tabs, splits and directories; this decides
-- what each pane was running. pi and claude resume their conversation.
return {
	mode = "ask", -- "ask" (a picker on restart), "auto" or "off"
	-- never saved: the pane comes back as a plain shell
	exclude = { "sudo *", "ssh *", "rm *", "darwin-rebuild *", "nix-rebuild*", "man *", "less *" },
	-- run again; any other command is typed into the prompt but not run
	rerun = { "nvim*", "lazygit*", "btop*", "htop*", "yazi*" },
	-- session labels never saved
	exclude_sessions = {},
}
