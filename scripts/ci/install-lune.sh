#!/usr/bin/env bash
# Installs the Lune version pinned in rokit.toml into $HOME/.local/bin on a Linux CI runner (docs/CI.md).
# CI needs only Lune (the spec runner and the facts dump); Rojo is not used by `verify`, so Rokit itself is
# not installed. The version has one source: rokit.toml.
set -euo pipefail

version="$(sed -n 's/^lune *= *"lune-org\/lune@\(.*\)"$/\1/p' rokit.toml)"
if [ -z "$version" ]; then
	echo "install-lune: no lune version in rokit.toml" >&2
	exit 1
fi

case "$(uname -m)" in
	x86_64) arch="x86_64" ;;
	aarch64 | arm64) arch="aarch64" ;;
	*) echo "install-lune: unsupported architecture $(uname -m)" >&2; exit 1 ;;
esac

dest="$HOME/.local/bin"
mkdir -p "$dest"
tmp="$(mktemp -d)"
curl -fsSL -o "$tmp/lune.zip" "https://github.com/lune-org/lune/releases/download/v${version}/lune-${version}-linux-${arch}.zip"
unzip -oq "$tmp/lune.zip" -d "$tmp"
install -m 0755 "$tmp/lune" "$dest/lune"
rm -rf "$tmp"

if [ -n "${GITHUB_PATH:-}" ]; then
	echo "$dest" >> "$GITHUB_PATH"
fi
"$dest/lune" --version
