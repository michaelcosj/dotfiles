-- How pickers show, by the platform of the client showing the session
-- (client.list info.platform: macos, linux, ...). It is the client that
-- draws floating panes, so a Linux server seen from the Mac app still floats.
--   picker = "float"   a floating pane over the session (needs client support)
--   picker = "tab"     a new tab that closes when the picker ends
-- Rex Linux (rex-rune) has no floating panes yet, so anything but macOS uses tabs.
return {
	macos = { picker = "float" },
	default = { picker = "tab" },
}
