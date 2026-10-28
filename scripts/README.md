# Scripts

One-off and operational scripts (imports, data checks, research helpers). Rules:

- Each script says at the top what it reads, what it writes, and whether it touches a database.
- Anything that writes to a database is dry-run by default and needs an explicit flag to apply.
- Scratch output goes to `.temp/` (git-ignored), never into `documentation/` or the repo root.
- Secrets come from environment variables, never from arguments or source.
