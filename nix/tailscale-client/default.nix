# Host client for non-NixOS Linux desktops; no published services.
{ pkgs }:
pkgs.runCommand "tailscale-client" { } ''
  mkdir -p "$out/bin" "$out/libexec"
  ln -s ${pkgs.tailscale}/bin/tailscale "$out/bin/tailscale"
  # Avoid Nix's shell wrapper for a Fedora system daemon. Its interpreter and
  # helpers also live in the store, whose default SELinux label blocks init_t.
  cp ${pkgs.tailscale}/bin/.tailscaled-wrapped "$out/libexec/tailscaled"
  if ${pkgs.binutils}/bin/readelf -l "$out/libexec/tailscaled" | grep -q INTERP; then
    echo 'tailscaled is no longer static; review host SELinux integration' >&2
    exit 1
  fi
  substitute ${./setup.sh} "$out/bin/setup-tailscale-client" \
    --subst-var-by tailscale ${pkgs.tailscale} \
    --subst-var-by self "$out"
  chmod +x "$out/bin/setup-tailscale-client"
''
