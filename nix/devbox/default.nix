# Ubuntu owns the kernel, SSH and firewall. Nix pins service tools and source.
{ pkgs }:
let
  revision = "984883c56b6b3e4a86a138291cce174067ddbf85";
  publicHost = "doop.michaelosajeh.com";
  runtime = pkgs.symlinkJoin {
    name = "devbox-service-runtime";
    paths = with pkgs; [
      tailscale
      bun
      nodejs
      chromium
      dejavu_fonts
      liberation_ttf
      noto-fonts-color-emoji
    ];
  };
  source = pkgs.fetchzip {
    url = "https://github.com/kgoedecke/doop/archive/${revision}.tar.gz";
    hash = "sha256-lT8kGExVJGXO5ku224s69l/8yN7GQMILQ4EoBfdBhcA=";
  };
in
pkgs.runCommand "devbox-services" { } ''
  mkdir -p "$out/bin"
  cp -r ${./config} "$out/config"
  chmod u+w "$out/config"
  substitute ${./config/doop-cloudflared.service.in} "$out/config/doop-cloudflared.service" \
    --subst-var-by cloudflared ${pkgs.cloudflared}
  substitute ${./setup-cloudflare.sh} "$out/bin/setup-doop-cloudflare" \
    --subst-var-by publicHost ${publicHost} \
    --subst-var-by self "$out"
  substitute ${./setup.sh} "$out/bin/setup-devbox-services" \
    --subst-var-by runtime ${runtime} \
    --subst-var-by revision ${revision} \
    --subst-var-by source ${source} \
    --subst-var-by self "$out"
  substitute ${./connect-doop.sh} "$out/bin/connect-doop-tailnet" \
    --subst-var-by runtime ${runtime}
  chmod +x "$out/bin/"*
''
