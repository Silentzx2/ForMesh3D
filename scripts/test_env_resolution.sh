#!/usr/bin/env bash
# Quick self-check for Python environment resolution logic
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "Testing environment resolution..."

# Check 1: syntax check
bash -n "$PROJECT_ROOT/backend/scripts/run_server.sh"
bash -n "$PROJECT_ROOT/backend/scripts/install.sh"
bash -n "$PROJECT_ROOT/backend/scripts/python_env.sh"
bash -n "$PROJECT_ROOT/scripts/test_python_env_resolution.sh"
echo "✓ Syntax valid"
bash "$PROJECT_ROOT/scripts/test_python_env_resolution.sh"

# Check 2: run_server fails safely without creating .venv when no env exists
TMP_TEST_DIR="$(mktemp -d)"
cleanup() {
    rm -rf "$TMP_TEST_DIR"
}
trap cleanup EXIT

FAKE_ROOT="$TMP_TEST_DIR/fake_repo"
mkdir -p "$FAKE_ROOT/backend/scripts" "$FAKE_ROOT/backend/config" "$TMP_TEST_DIR/bin"
cp "$PROJECT_ROOT/backend/scripts/run_server.sh" "$FAKE_ROOT/backend/scripts/run_server.sh"
cp "$PROJECT_ROOT/backend/scripts/python_env.sh" "$FAKE_ROOT/backend/scripts/python_env.sh"
chmod +x "$FAKE_ROOT/backend/scripts/run_server.sh" "$FAKE_ROOT/backend/scripts/python_env.sh"

echo "dummy: true" > "$FAKE_ROOT/backend/config/system.yaml"
echo "dummy: true" > "$FAKE_ROOT/backend/config/models.yaml"

# Mock redis-cli to return success
cat << 'EOF' > "$TMP_TEST_DIR/bin/redis-cli"
#!/bin/sh
exit 0
EOF
chmod +x "$TMP_TEST_DIR/bin/redis-cli"

set +e
OUT=$(cd "$FAKE_ROOT/backend" && env -u CONDA_PREFIX -u CONDA_DEFAULT_ENV -u VIRTUAL_ENV -u PYTHON_EXEC HOME="$TMP_TEST_DIR" PATH="$TMP_TEST_DIR/bin:/usr/bin:/bin" bash scripts/run_server.sh 2>&1)
CODE=$?
set -e

if [ "$CODE" -ne 1 ]; then
    echo "✗ Expected exit code 1 when no env exists, got $CODE"
    exit 1
fi

if [ -d "$FAKE_ROOT/.venv" ]; then
    echo "✗ Destructive .venv creation detected when no env exists!"
    exit 1
fi

echo "✓ Fails safely without creating .venv"

# Check 3: custom venv and Conda environment selection are covered by
# scripts/test_python_env_resolution.sh above. The old --help probe did not
# execute the environment resolver and therefore was not a meaningful test.

# Check 4: install.sh halts with non-zero exit code if required apt installation fails
echo "Testing installer failure handling..."
MOCK_APT_DIR="$TMP_TEST_DIR/mock_apt"
mkdir -p "$MOCK_APT_DIR"

cat << 'EOF' > "$MOCK_APT_DIR/sudo"
#!/bin/sh
exec "$@"
EOF
chmod +x "$MOCK_APT_DIR/sudo"

cat << 'EOF' > "$MOCK_APT_DIR/apt-get"
#!/bin/sh
for arg in "$@"; do
    if [ "$arg" = "install" ]; then
        echo "E: Sub-process /usr/bin/dpkg returned an error code (1)" >&2
        exit 1
    fi
done
exit 0
EOF
chmod +x "$MOCK_APT_DIR/apt-get"

cat << 'EOF' > "$MOCK_APT_DIR/python"
#!/bin/sh
case "$*" in
    *"sys.prefix"*) echo "$MOCK_PYTHON_PREFIX"; exit 0 ;;
    *"sys.version_info"*) echo "3.10"; exit 0 ;;
    *"import uv"*) exit 0 ;;
    *"import sys"*) echo "$MOCK_PYTHON_PREFIX/bin/python"; exit 0 ;;
    *) exit 0 ;;
esac
EOF
chmod +x "$MOCK_APT_DIR/python"

# Mock uv
cat << 'EOF' > "$MOCK_APT_DIR/uv"
#!/bin/sh
exit 0
EOF
chmod +x "$MOCK_APT_DIR/uv"

cat << 'EOF' > "$MOCK_APT_DIR/git"
#!/bin/sh
exit 0
EOF
chmod +x "$MOCK_APT_DIR/git"

cat << 'EOF' > "$MOCK_APT_DIR/pip"
#!/bin/sh
exit 0
EOF
chmod +x "$MOCK_APT_DIR/pip"

FAKE_INSTALL_ROOT="$TMP_TEST_DIR/fake_install_repo"
mkdir -p "$FAKE_INSTALL_ROOT/backend/scripts" "$FAKE_INSTALL_ROOT/3daigc-api/bin"
: > "$FAKE_INSTALL_ROOT/3daigc-api/pyvenv.cfg"
cp "$PROJECT_ROOT/backend/scripts/install.sh" "$FAKE_INSTALL_ROOT/backend/scripts/install.sh"
chmod +x "$FAKE_INSTALL_ROOT/backend/scripts/install.sh"
cp "$MOCK_APT_DIR/python" "$FAKE_INSTALL_ROOT/3daigc-api/bin/python"
chmod +x "$FAKE_INSTALL_ROOT/3daigc-api/bin/python"
cat > "$FAKE_INSTALL_ROOT/3daigc-api/bin/activate" <<EOF
export VIRTUAL_ENV="$FAKE_INSTALL_ROOT/3daigc-api"
export PATH="\$VIRTUAL_ENV/bin:\$PATH"
EOF

set +e
APT_TEST_OUT=$(cd "$FAKE_INSTALL_ROOT/backend" && env -u CONDA_PREFIX -u CONDA_DEFAULT_ENV -u PYTHON_EXEC MOCK_PYTHON_PREFIX="$FAKE_INSTALL_ROOT/3daigc-api" FORMASH3D_ENV_MANAGER="venv" HOME="$TMP_TEST_DIR" PATH="$MOCK_APT_DIR:/usr/bin:/bin" bash scripts/install.sh 2>&1)
APT_TEST_CODE=$?
set -e

if [ "$APT_TEST_CODE" -eq 0 ]; then
    echo "✗ Expected install.sh to fail on apt error, but it exited with 0"
    exit 1
fi

if echo "$APT_TEST_OUT" | grep -q "All installation done successfully!"; then
    echo "✗ install.sh printed success banner after apt installation failure!"
    exit 1
fi

echo "✓ Installer halts with non-zero exit code on required apt failure"

echo "All environment resolution checks passed!"
