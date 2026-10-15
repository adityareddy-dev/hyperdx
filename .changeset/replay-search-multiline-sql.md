---
'@hyperdx/app': patch
---

fix(dashboards): preserve multi-line SQL when replaying a search from a dashboard tile

The "Replay search" action built the `/search` URL with a plain `URLSearchParams`, which single-encodes values. The search page reads and rewrites those params with nuqs (double-encoded), and nuqs's URL re-render drops raw newlines/tabs/carriage returns. On the first time-range update the single-encoded `where` was read back as a literal newline and then stripped by the browser, silently joining lines (`and\nNamespace` → `andNamespace`) and breaking the query. The URL is now serialized with nuqs so multi-line SQL survives the round-trip.
