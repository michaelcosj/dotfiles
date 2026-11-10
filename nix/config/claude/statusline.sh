#!/usr/bin/env bash
# Claude Code status line: colored segments separated by │.
# Reads statusLine JSON on stdin. Any missing field just drops its segment.

input=$(cat)

IFS=$'\037' read -r model cwd ctx cache five five_reset week week_reset < <(
  printf '%s' "$input" | jq -r '
    def pct: if . == null then "" else (. | floor | tostring) end;
    # resets_at may be epoch seconds or an ISO string; normalize to epoch
    def epoch: if . == null then ""
      elif type == "number" then (. | floor | tostring)
      else (try (sub("\\.[0-9]+"; "") | sub("[+-][0-9]{2}:?[0-9]{2}$"; "Z") | fromdateiso8601 | tostring) catch "")
      end;
    (.context_window.current_usage) as $u
    | [
        (.model.display_name // ""),
        (.workspace.current_dir // .cwd // ""),
        (.context_window.used_percentage | pct),
        (if $u == null then ""
         else (($u.input_tokens // 0) + ($u.cache_read_input_tokens // 0) + ($u.cache_creation_input_tokens // 0)) as $den
           | if $den > 0 then ((($u.cache_read_input_tokens // 0) * 100 / $den) | floor | tostring) else "" end
         end),
        (.rate_limits.five_hour.used_percentage | pct),
        (.rate_limits.five_hour.resets_at | epoch),
        (.rate_limits.seven_day.used_percentage | pct),
        (.rate_limits.seven_day.resets_at | epoch)
      ] | join("\u001f")' 2>/dev/null
)

[ -z "$cwd" ] && cwd=$PWD

RESET=$'\033[0m' DIM=$'\033[2m' BOLD=$'\033[1m'
RED=$'\033[31m' GREEN=$'\033[32m' YELLOW=$'\033[33m' BLUE=$'\033[34m' MAGENTA=$'\033[35m' CYAN=$'\033[36m'

# color by how much is left: green > 50%, yellow > 20%, red otherwise
left_color() {
  if [ "$1" -gt 50 ]; then printf '%s' "$GREEN"
  elif [ "$1" -gt 20 ]; then printf '%s' "$YELLOW"
  else printf '%s' "$RED"; fi
}

# time until an epoch timestamp, e.g. 2h13m or 3d4h
until_str() {
  local s=$(($1 - $(date +%s)))
  [ "$s" -lt 0 ] && s=0
  local d=$((s / 86400)) h=$((s % 86400 / 3600)) m=$((s % 3600 / 60))
  if [ "$d" -gt 0 ]; then printf '%dd%dh' "$d" "$h"
  elif [ "$h" -gt 0 ]; then printf '%dh%dm' "$h" "$m"
  else printf '%dm' "$m"; fi
}

segs=()

[ -n "$model" ] && segs+=("${BOLD}${MAGENTA}${model}${RESET}")

short=$cwd
case "$cwd" in
  "$HOME") short='~' ;;
  "$HOME"/*) short="~${cwd#"$HOME"}" ;;
esac
segs+=("${CYAN}${short}${RESET}")

if [ -d "$cwd" ] && git -C "$cwd" --no-optional-locks rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  branch=$(git -C "$cwd" --no-optional-locks symbolic-ref --short -q HEAD 2>/dev/null \
    || git -C "$cwd" --no-optional-locks rev-parse --short HEAD 2>/dev/null)
  if [ -n "$branch" ]; then
    if [ -n "$(git -C "$cwd" --no-optional-locks status --porcelain 2>/dev/null | head -n 1)" ]; then
      segs+=("${YELLOW}${branch}*${RESET}")
    else
      segs+=("${GREEN}${branch}${RESET}")
    fi
  fi
fi

[ -n "$ctx" ] && segs+=("ctx $(left_color $((100 - ctx)))${ctx}%${RESET}")

[ -n "$cache" ] && segs+=("cache ${BLUE}${cache}%${RESET}")

# limit_seg <label> <used%> <reset epoch>
limit_seg() {
  [ -z "$2" ] && return
  local left=$((100 - $2))
  [ "$left" -lt 0 ] && left=0
  local s="$1 $(left_color "$left")${left}% left${RESET}"
  [ -n "$3" ] && s+=" ${DIM}↻ $(until_str "$3")${RESET}"
  segs+=("$s")
}
limit_seg 5h "$five" "$five_reset"
limit_seg 7d "$week" "$week_reset"

sep=" ${DIM}│${RESET} "
out=""
for s in "${segs[@]}"; do
  if [ -z "$out" ]; then out=$s; else out+="$sep$s"; fi
done
printf '%s\n' "$out"
