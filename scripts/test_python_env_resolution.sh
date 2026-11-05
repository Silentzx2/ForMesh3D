#!/usr/bin/env bash
# Focused tests for selected Conda/venv runtime resolution.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck disable=SC1091
source "$PROJECT_ROOT/backend/scripts/python_env.sh"

TMP_TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_TEST_DIR"' EXIT

make_mock_python() {
    local executable="$1"
    local prefix="$2"
    mkdir -p "$(dirname "$executable")" "$prefix"
    cat > "$executable" <<'MOCKPY'
#!/usr/bin/env bash
if [[ "$1" == "-c" ]]; then
    case "$2" in
        *sys.prefix*) printf '%s\n' "__PYTHON_PREFIX__" ;;
        *sys.version_info*) printf '%s\n' "3.10" ;;
        *fastapi*) exit 0 ;;
        *) exit 0 ;;
    esac
fi
exit 0
MOCKPY
    sed -i "s|__PYTHON_PREFIX__|$prefix|g" "$executable"
    chmod +x "$executable"
}

CUSTOM_VENV="$TMP_TEST_DIR/envs/python310-runtime"
mkdir -p "$CUSTOM_VENV"
: > "$CUSTOM_VENV/pyvenv.cfg"
make_mock_python "$CUSTOM_VENV/bin/python" "$CUSTOM_VENV"

CONDA_BASE="$TMP_TEST_DIR/miniconda3"
mkdir -p "$CONDA_BASE/conda-meta"
make_mock_python "$CONDA_BASE/bin/python" "$CONDA_BASE"

PROJECT_ROOT="$TMP_TEST_DIR/project"
mkdir -p "$PROJECT_ROOT"
FORMASH3D_ENV_MANAGER=venv
FORMASH3D_VENV_PATH="$CUSTOM_VENV"
PYTHON_EXEC="$CONDA_BASE/bin/python"
VIRTUAL_ENV=""
CONDA_PREFIX="$CONDA_BASE"
CONDA_DEFAULT_ENV=base
if ! formesh_resolve_python venv; then
    echo "FAIL: custom venv was not resolved"
    exit 1
fi
[[ "$FORMESH_PYTHON_BIN" == "$CUSTOM_VENV/bin/python" ]] || {
    echo "FAIL: selected venv resolved to '$FORMESH_PYTHON_BIN'"
    exit 1
}
echo "PASS: selected venv wins over an unrelated active Conda base"

CUSTOM_CONDA="$TMP_TEST_DIR/conda/envs/mesh-runtime-310"
mkdir -p "$CUSTOM_CONDA/conda-meta"
make_mock_python "$CUSTOM_CONDA/bin/python" "$CUSTOM_CONDA"
MOCK_CONDA_BIN="$TMP_TEST_DIR/mock-bin"
mkdir -p "$MOCK_CONDA_BIN"
cat > "$MOCK_CONDA_BIN/conda" <<'MOCKCONDA'
#!/usr/bin/env bash
if [[ "$1" == "run" ]]; then
    printf '%s\n' "$MOCK_CONDA_PYTHON"
elif [[ "$1" == "info" && "$2" == "--base" ]]; then
    printf '%s\n' "$MOCK_CONDA_BASE"
fi
MOCKCONDA
chmod +x "$MOCK_CONDA_BIN/conda"

export PATH="$MOCK_CONDA_BIN:$PATH"
export MOCK_CONDA_PYTHON="$CUSTOM_CONDA/bin/python"
export MOCK_CONDA_BASE="$CONDA_BASE"
FORMASH3D_CONDA_ENV_NAME=mesh-runtime-310
FORMASH3D_CONDA_ENV_PATH=""
PYTHON_EXEC=""
CONDA_PREFIX="$CONDA_BASE"
CONDA_DEFAULT_ENV=base
if ! formesh_resolve_python conda; then
    echo "FAIL: named Conda environment was not resolved"
    exit 1
fi
[[ "$FORMESH_PYTHON_BIN" == "$CUSTOM_CONDA/bin/python" ]] || {
    echo "FAIL: selected Conda env resolved to '$FORMESH_PYTHON_BIN'"
    exit 1
}
echo "PASS: selected custom Conda env wins over active base"

FORMASH3D_CONDA_ENV_PATH="$CUSTOM_CONDA"
if ! formesh_resolve_python conda; then
    echo "FAIL: explicit Conda prefix path was not resolved"
    exit 1
fi
[[ "$FORMESH_PYTHON_BIN" == "$CUSTOM_CONDA/bin/python" ]] || {
    echo "FAIL: explicit Conda prefix resolved to '$FORMESH_PYTHON_BIN'"
    exit 1
}
echo "PASS: explicit Conda prefix path is honored"
echo "All selected Python environment tests passed."
