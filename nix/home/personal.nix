# Personal identity; do not import this into the work account.
{ ... }:
{
  programs.git.settings.user = {
    name = "Michael";
    email = "michaelcosj@proton.me";
  };
}
