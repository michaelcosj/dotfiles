---
description: Generate a Bitbucket pull request link from source and destination branches
argument-hint: "<source-branch> <destination-branch>"
---
Generate a Bitbucket Cloud pull request creation link for:

- Source branch: `$1`
- Destination branch: `$2`

Determine the Bitbucket workspace and repository from the current Git repository's `origin` remote. Support both SSH and HTTPS Bitbucket remote formats and remove a trailing `.git` from the repository name.

URL-encode both branch names and output only this Markdown link:

`[Create Bitbucket PR: $1 → $2](https://bitbucket.org/<workspace>/<repository>/pull-requests/new?source=<encoded-source-branch>&dest=<encoded-destination-branch>)`

Do not push branches or create the pull request. If either branch argument is missing, respond only with: `Usage: /bitbucket-pr-link <source-branch> <destination-branch>`
