# lazygit's edit command. When lazygit was started from Neovim's <leader>gl
# float, $NVIM is that Neovim's server: open the file there (it hides the
# float and switches back). Otherwise open a new nvim in lazygit's terminal.
file=$1
line=${2:-0}
case $file in /*) ;; *) file="$PWD/$file" ;; esac

if [ -n "${NVIM:-}" ] && nvim --server "$NVIM" --remote-expr 1 >/dev/null 2>&1; then
  esc=$(printf '%s' "$file" | sed "s/'/''/g") # Vim single-quoted string
  exec nvim --server "$NVIM" --remote-expr \
    "luaeval('require(\"config.floats\").edit(_A[1], _A[2])', ['$esc', '$line'])" >/dev/null
fi

if [ "$line" -gt 0 ] 2>/dev/null; then
  exec nvim "+$line" -- "$file"
fi
exec nvim -- "$file"
