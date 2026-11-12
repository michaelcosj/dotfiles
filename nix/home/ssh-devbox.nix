# Client-side aliases. OpenSSH selects the normal local identity files.
# The devbox is reached over Tailscale (MagicDNS), so its public address stays
# out of this public repo.
{ ... }:
{
  programs.ssh = {
    enable = true;
    enableDefaultConfig = false;
    settings = {
      devbox = {
        HostName = "devbox.danio-wezen.ts.net";
        User = "m";
      };
      devbox-work = {
        HostName = "devbox.danio-wezen.ts.net";
        User = "work";
      };
    };
  };
}
