# Security Policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private
advisory form on the repository's Security tab, or email the maintainer.

Include: what you did, what you expected, what happened, and the exact input
and request path if relevant. You should get an acknowledgement within a few
days.

## What this app does and does not expose

Worth knowing before you report something that is by design:

- **No accounts.** There is no login, no password, no OAuth, and no personal
  data. A visitor gets an anonymous 128-bit session id in an `HttpOnly`,
  `SameSite=Lax` cookie named `orbitgene_sid`.
- **No keys.** The app calls only public, keyless endpoints: UniProt REST, NCBI
  E-utilentials, and NOAA SWPC. Upstream hosts are allowlisted, and a request
  URL that is not on that list is refused rather than fetched.
- **Per-session isolation.** Every record read is filtered by owner. A record
  belonging to another session is reported exactly like one that does not
  exist, so ids cannot be probed for existence.
- **Records are sealed.** Update and retire both require the caller to echo the
  record's current terminal SHA-384 seal. A stale or wrong seal is refused with
  `409`, which is what prevents a stale tab from clobbering a newer state.
- **Retirement is a tombstone.** The row and its audit chain are retained so the
  history stays replayable. Retirement is therefore not a privacy erasure tool
  for content you pasted into `notes`.
- **No rate limiting yet.** `/api/score` and `/api/assays` are unauthenticated
  and currently unmetered, so they can be used to burn upstream quota. Treat
  this as a known gap.

## Do not paste sensitive material into notes

`notes` is stored verbatim and included in sealed audit events. Anything you
type into a record's notes field is part of that record's permanent history.

## Versions

The deployed `main` branch is the supported version.