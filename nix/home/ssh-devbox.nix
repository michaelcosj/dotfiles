# Client-side aliases. OpenSSH selects the normal local identity files.
{ ... }:
{
  programs.ssh = {
    enable = true;
    enableDefaultConfig = false;
    settings = {
      devbox = {
        HostName = "104.204.68.172";
        User = "m";
      };
      devbox-work = {
        HostName = "104.204.68.172";
        User = "work";
      };
      devbox-admin = {
        HostName = "104.204.68.172";
        User = "devbox-root";
      };
    };
  };
}
