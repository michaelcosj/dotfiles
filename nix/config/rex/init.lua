-- Ctrl+A prefix, matching the tmux and Herdr configurations.
rex.bind("ctrl+a>ctrl+a", "pane.send_key", { key = "ctrl+a" })
rex.bind("ctrl+a>r", "client.config.reload")
rex.bind("ctrl+a>shift+r", "client.config.reload")
rex.bind("ctrl+a>c", "client.tab.new")

-- | is Shift+Backslash on a US keyboard; Rex matches unshifted keys.
rex.bind("ctrl+a>shift+\\", "pane.split", { direction = "right" })
rex.bind("ctrl+a>-", "pane.split", { direction = "down" })
rex.bind("ctrl+a>h", "pane.focus", { direction = "left" })
rex.bind("ctrl+a>j", "pane.focus", { direction = "down" })
rex.bind("ctrl+a>k", "pane.focus", { direction = "up" })
rex.bind("ctrl+a>l", "pane.focus", { direction = "right" })
rex.bind("ctrl+a>shift+h", "pane.resize", { direction = "left" })
rex.bind("ctrl+a>shift+j", "pane.resize", { direction = "down" })
rex.bind("ctrl+a>shift+k", "pane.resize", { direction = "up" })
rex.bind("ctrl+a>shift+l", "pane.resize", { direction = "right" })
rex.bind("ctrl+a>z", "pane.zoom")

-- Accept both Herdr's p/n and tmux's Ctrl+P/Ctrl+N.
rex.bind("ctrl+a>p", "client.tab.previous")
rex.bind("ctrl+a>n", "client.tab.next")
rex.bind("ctrl+a>ctrl+p", "client.tab.previous")
rex.bind("ctrl+a>ctrl+n", "client.tab.next")
rex.bind("ctrl+a>shift+,", "client.tab.move", { direction = "backward" })
rex.bind("ctrl+a>shift+.", "client.tab.move", { direction = "forward" })

-- Use Rex's session picker in place of the project sessionizer.
rex.bind("ctrl+a>s", "session.switch")
rex.bind("ctrl+a>shift+s", "session.switch")
