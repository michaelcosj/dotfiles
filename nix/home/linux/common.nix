# Shared Linux user environment, for desktops and headless devboxes.
{
  config,
  pkgs,
  lib,
  rex,
  homeConfiguration,
  ...
}:
{
  imports = [ rex.homeManagerModules.default ];

  targets.genericLinux.enable = true;
  # genericLinux enables GPU integration by default; headless machines must not.
  targets.genericLinux.gpu.enable = lib.mkDefault false;

  home.packages = with pkgs; [
    # Headless Chrome for rex-web (HTML in a Rex pane). It runs on the machine
    # whose Rex pane shows the page, so every Linux machine needs one.
    chromium
    # rex-web is a Bun script. macOS has Bun in ~/.bun (fish.nix).
    bun
    # Fonts for headless Chromium: a headless host has none, and pages render
    # without text. Desktops add their own on top (desktop.nix).
    dejavu_fonts
    noto-fonts
    noto-fonts-color-emoji
    jetbrains-mono
    claude-code
    # Use the official prebuilt release instead of compiling the Rust workspace.
    (callPackage ../../pkgs/codex-bin.nix { })
    gcc
    # Pi installs extension packages with npm, even outside a project Node environment.
    nodejs
    pi-coding-agent
    svelte-language-server
    unar
  ];

  # Nix owns the installed Claude Code version.
  home.sessionVariables.DISABLE_AUTOUPDATER = "1";

  # Lets Nix Chromium find the fonts above; desktop.nix sets it too.
  fonts.fontconfig.enable = true;
  # A complete fontconfig file. Home Manager's conf.d is read only through
  # /etc/fonts/fonts.conf, and a headless host may have no /etc/fonts. rex-web
  # points Chromium here (FONTCONFIG_FILE) when /etc/fonts/fonts.conf is missing.
  xdg.configFile."fontconfig/fonts.conf".text = ''
    <?xml version="1.0"?>
    <!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
    <fontconfig>
      <include ignore_missing="yes">${pkgs.fontconfig.out}/etc/fonts/fonts.conf</include>
      <include ignore_missing="yes">${config.xdg.configHome}/fontconfig/conf.d</include>
      <dir>${config.home.profileDirectory}/share/fonts</dir>
    </fontconfig>
  '';

  programs.rex.enable = true;
  services.rex.enable = true;

  # Rex session restore (nix/config/rex/bin/rex-watch.lua): resumes what panes
  # were running after the server restarts, then saves a snapshot every 15 s.
  # It starts and stops with the server; launchd runs it on macOS (darwin.nix).
  systemd.user.services.rex-watch = {
    Unit = {
      Description = "Rex session restore";
      After = [ "rex.service" ];
      BindsTo = [ "rex.service" ];
    };
    Service = {
      # The server's own rex, on its default socket (same XDG_RUNTIME_DIR).
      ExecStart = "${lib.getExe config.services.rex.package} --autostart=false do %h/.config/rex/bin/rex-watch.lua --all";
      Restart = "on-failure";
      RestartSec = 15;
      # rex do exits 130 on SIGTERM (as for Ctrl-C). A normal stop is not a failure.
      SuccessExitStatus = [ 130 ];
    };
    # rex.service: starts with the server. default.target: home-manager switch
    # (sd-switch) starts new units through targets, so a switch starts it too
    # without restarting the server.
    Install.WantedBy = [
      "rex.service"
      "default.target"
    ];
  };
  nix = {
    package = pkgs.nix;
    gc.automatic = true;
    settings.experimental-features = "nix-command flakes";
  };

  programs.fish.functions.nix-rebuild.body = ''
    home-manager switch --flake "$HOME/.dotfiles/nix#${homeConfiguration}" $argv; or return
  '';
}
