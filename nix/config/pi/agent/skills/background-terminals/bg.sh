#!/usr/bin/env bash
# Ad-hoc background terminals. Each job is a log, pid and exit-code file in $dir,
# so any later shell can inspect or stop it.
set -euo pipefail

dir="${PI_BG_DIR:-${TMPDIR:-/tmp}/pi-bg}"
dir="${dir%/}"
mkdir -p "$dir"

usage() {
  cat <<EOF
usage: bg.sh <command> [args]

  start <name> <cmd...>          run cmd in the background (no stdin)
  status <name> [lines=40]       state plus the last lines of output
  wait <name> [timeout=600]      block until the job exits
  until <name> <regex> [timeout=60]
                                 block until the log matches regex or the job exits
  list                           all jobs and their state
  kill <name>|--all              stop the job's whole process group
  clean                          forget jobs that are no longer running

state dir: $dir
EOF
  exit 2
}

need_name() {
  [[ -n "${1:-}" ]] || usage
  [[ "$1" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "invalid name: $1" >&2; exit 2; }
  [[ -f "$dir/$1.pid" ]] || [[ "${2:-}" == new ]] || { echo "no such job: $1" >&2; exit 1; }
}

running() {
  [[ -f "$dir/$1.pid" ]] && kill -0 "$(cat "$dir/$1.pid")" 2>/dev/null
}

state() {
  if running "$1"; then
    echo "running (pid $(cat "$dir/$1.pid"))"
  elif [[ -f "$dir/$1.exit" ]]; then
    echo "exited $(cat "$dir/$1.exit")"
  else
    echo "stopped"
  fi
}

show() {
  echo "$1: $(state "$1")  log: $dir/$1.log"
  tail -n "${2:-40}" "$dir/$1.log" 2>/dev/null || true
}

stop() {
  running "$1" || return 0
  local pid
  pid="$(cat "$dir/$1.pid")"
  kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  for _ in $(seq 50); do
    running "$1" || { echo "$1: stopped"; return 0; }
    sleep 0.1
  done
  kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
  echo "$1: killed"
}

cmd="${1:-}"
shift || true

case "$cmd" in
  start)
    name="${1:-}"
    need_name "$name" new
    shift
    [[ $# -gt 0 ]] || usage
    if running "$name"; then
      echo "$name is already running (pid $(cat "$dir/$name.pid"))" >&2
      exit 1
    fi
    rm -f "$dir/$name.exit"
    # Job control gives the job its own process group, so kill reaches its children.
    set -m
    nohup bash -c '(eval "$1"); echo $? > "$2"' _ "$*" "$dir/$name.exit" \
      > "$dir/$name.log" 2>&1 < /dev/null &
    echo $! > "$dir/$name.pid"
    echo "$name: started (pid $!)  log: $dir/$name.log"
    ;;
  status)
    need_name "${1:-}"
    show "$1" "${2:-40}"
    ;;
  wait)
    need_name "${1:-}"
    deadline=$((SECONDS + ${2:-600}))
    while running "$1"; do
      ((SECONDS < deadline)) || { show "$1"; echo "timed out" >&2; exit 124; }
      sleep 1
    done
    show "$1"
    ;;
  until)
    need_name "${1:-}"
    [[ -n "${2:-}" ]] || usage
    deadline=$((SECONDS + ${3:-60}))
    until grep -Eq -- "$2" "$dir/$1.log" 2>/dev/null; do
      running "$1" || { show "$1"; echo "exited before matching" >&2; exit 1; }
      ((SECONDS < deadline)) || { show "$1"; echo "timed out" >&2; exit 124; }
      sleep 0.5
    done
    show "$1" 20
    ;;
  list)
    shopt -s nullglob
    for f in "$dir"/*.pid; do
      name="$(basename "$f" .pid)"
      echo "$name: $(state "$name")"
    done
    ;;
  kill)
    if [[ "${1:-}" == --all ]]; then
      shopt -s nullglob
      for f in "$dir"/*.pid; do stop "$(basename "$f" .pid)"; done
    else
      need_name "${1:-}"
      stop "$1"
    fi
    ;;
  clean)
    shopt -s nullglob
    for f in "$dir"/*.pid; do
      name="$(basename "$f" .pid)"
      running "$name" || rm -f "$dir/$name".{pid,log,exit}
    done
    ;;
  *)
    usage
    ;;
esac
