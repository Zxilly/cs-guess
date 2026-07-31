# Vendored WebSocket transport

These crates are patched locally because Socketioxide 0.18.5 depends on
Engineioxide 0.17.6, whose Tokio-Tungstenite transport cannot negotiate
RFC 7692 `permessage-deflate`.

- `engineioxide` 0.17.6, upstream commit
  `511e6e8a525b8047bd9c5bc8199578b014044f85`: WebSocket transport replaced
  with Yawc while retaining Engine.IO polling upgrades and the raw-stream test
  harness.
- `yawc` 0.3.3, upstream commit
  `2a887731fafbb89115728af2267ce1080c72fcad`: configurable compression threshold,
  raw-stream constructor, threshold test, and runtime AVX2 detection.

The root `server/Cargo.toml` selects these copies through `[patch.crates-io]`.
Keep both upstream license files when updating the vendored sources.
