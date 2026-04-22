#!/usr/bin/env bash
# Install git hooks for this repo. Run once after cloning.
# Currently: gitleaks pre-commit hook that blocks commits containing secrets.

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "gitleaks not installed. Install first:"
  echo "  Windows: winget install Gitleaks.Gitleaks"
  echo "  macOS:   brew install gitleaks"
  echo "  Linux:   see https://github.com/gitleaks/gitleaks"
  exit 1
fi

HOOK=.git/hooks/pre-commit
cat > "$HOOK" <<'EOF'
#!/usr/bin/env bash
# Auto-installed by scripts/install-hooks.sh. Blocks commits with secrets.
gitleaks protect --staged --redact -c .gitleaks.toml --no-banner
EOF
chmod +x "$HOOK"

echo "Installed pre-commit hook at $HOOK"
