#!/usr/bin/env bash
# install blast-radius for claude code and/or codex.
#
#   curl -fsSL https://raw.githubusercontent.com/jakubkrauza/blast-radius/main/install.sh | bash
#
# what it does:
#   1. clones the repo to ~/.local/share/blast-radius (or pulls if it's there)
#   2. symlinks skills/blast-radius into each agent you have:
#        claude code  ->  ~/.claude/skills/blast-radius
#        codex        ->  ~/.agents/skills/blast-radius
#
# run it again to update. pass --uninstall to remove everything it made.
# it never deletes a folder it didn't create.

set -euo pipefail

REPO="https://github.com/jakubkrauza/blast-radius.git"
HOME_DIR="${BLAST_RADIUS_HOME:-$HOME/.local/share/blast-radius}"
CLAUDE_DIR="$HOME/.claude/skills"
CODEX_DIR="$HOME/.agents/skills"

say() { printf 'blast-radius: %s\n' "$*"; }

has_claude() { command -v claude >/dev/null 2>&1 || [ -d "$HOME/.claude" ]; }
has_codex() { command -v codex >/dev/null 2>&1 || [ -d "$HOME/.codex" ]; }

# point $1/blast-radius at our skill folder.
link() {
  local dir="$1" name="$2" target="$1/blast-radius"
  mkdir -p "$dir"
  if [ -e "$target" ] && [ ! -L "$target" ]; then
    say "skipped $name: $target exists and isn't a symlink. move it and run again."
    return
  fi
  ln -sfn "$HOME_DIR/skills/blast-radius" "$target"
  say "installed for $name -> $target"
}

# remove $1/blast-radius only if it's our symlink.
unlink_ours() {
  local target="$1/blast-radius"
  if [ -L "$target" ] && [ "$(readlink "$target")" = "$HOME_DIR/skills/blast-radius" ]; then
    rm "$target"
    say "removed $target"
  fi
}

if [ "${1:-}" = "--uninstall" ]; then
  unlink_ours "$CLAUDE_DIR"
  unlink_ours "$CODEX_DIR"
  if [ -d "$HOME_DIR/.git" ]; then
    rm -rf "$HOME_DIR"
    say "removed $HOME_DIR"
  fi
  exit 0
fi

command -v git >/dev/null 2>&1 || { say "needs git"; exit 1; }

if [ -d "$HOME_DIR/.git" ]; then
  git -C "$HOME_DIR" pull --ff-only --quiet
  say "updated $HOME_DIR"
else
  mkdir -p "$(dirname "$HOME_DIR")"
  git clone --depth 1 --quiet "$REPO" "$HOME_DIR"
  say "cloned to $HOME_DIR"
fi

found=0
if has_claude; then link "$CLAUDE_DIR" "claude code"; found=1; fi
if has_codex; then link "$CODEX_DIR" "codex"; found=1; fi

if [ "$found" -eq 0 ]; then
  say "didn't find claude code or codex. installing for both anyway."
  link "$CLAUDE_DIR" "claude code"
  link "$CODEX_DIR" "codex"
fi

echo
say "done. restart your agent, then:"
say "  claude code:  /blast-radius"
say "  codex:        \$blast-radius"
