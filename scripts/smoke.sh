#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

: "${ANTHROPIC_API_KEY:?Set ANTHROPIC_API_KEY for smoke test}"
: "${TAVILY_API_KEY:?Set TAVILY_API_KEY for smoke test}"

FIXTURE="test/fixtures/smoke-disclosure.md"
if [[ ! -f "$FIXTURE" ]]; then
  cat > "$FIXTURE" <<'EOF'
A distributed cache coherence protocol using bloom-filter-based invalidation over a gossip network.
Current approaches (Redis Cluster, Memcached) rely on centralized coordinators or broadcast invalidation,
neither of which scales past ~100 nodes. The invention uses probabilistic bloom-filter digests
exchanged via gossip; nodes locally reconstruct which keys to invalidate based on digest intersection.
Novel because it eliminates central coordination without broadcast cost.
EOF
fi

OUT_DIR="$(mktemp -d)"
echo "→ Running smoke test, output dir: $OUT_DIR"

node dist/cli.js --input "$FIXTURE" --out "$OUT_DIR" --max-iter 2 --quiet

if ! compgen -G "$OUT_DIR/*/draft.md" > /dev/null; then
  echo "✗ No draft.md produced under $OUT_DIR" >&2
  exit 1
fi
echo "✓ Smoke test passed. Final draft at: $(ls "$OUT_DIR"/*/draft.md)"
