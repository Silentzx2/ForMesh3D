#!/bin/bash
#
# ForMesh3D Backend API Installer
# Installs Python environment, PyTorch, model dependencies, and system libraries.
#
# Usage: bash scripts/install.sh [--cpu|--gpu] [--conda|--venv] [--auto]
#

set -euo pipefail

UV_PIP="uv pip"

# ── Project paths ────────────────────────────────────────────────────────────
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WHEEL_DIR="$PROJECT_ROOT/backend/thirdparty/wheels"
THIRDPARTY_DIR="$PROJECT_ROOT/backend/thirdparty"

# ── Load .env if present ─────────────────────────────────────────────────────
if [[ -f "$PROJECT_ROOT/.env" ]]; then
    set -a
    source "$PROJECT_ROOT/.env"
    set +a
fi

# ── Parse command line flags ─────────────────────────────────────────────────
AUTO_MODE=0
ENV_MANAGER="${FORMASH3D_ENV_MANAGER:-${AI_STUDIO_ENV_MANAGER:-conda}}"
FORCE_CPU=0
FORCE_CUDA=0
WITH_THIRDPARTY=0
CPU_EXTRAS=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --auto|-auto|-y|--yes|--non-interactive)
            AUTO_MODE=1
            export NONINTERACTIVE=1
            shift
            ;;
        --cpu)
            FORCE_CPU=1
            export FORMASH3D_COMPUTE=cpu
            shift
            ;;
        --gpu)
            FORCE_CUDA=1
            export FORMASH3D_COMPUTE=cuda
            shift
            ;;
        --cpu-extras)
            CPU_EXTRAS=1
            shift
            ;;
        --with-thirdparty)
            WITH_THIRDPARTY=1
            shift
            ;;
        --conda)
            ENV_MANAGER="conda"
            export FORMASH3D_ENV_MANAGER="conda"
            shift
            ;;
        --venv)
            ENV_MANAGER="venv"
            export FORMASH3D_ENV_MANAGER="venv"
            shift
            ;;
        --env-manager=*)
            ENV_MANAGER="${1#*=}"
            export FORMASH3D_ENV_MANAGER="$ENV_MANAGER"
            shift
            ;;
        --env-manager)
            ENV_MANAGER="$2"
            export FORMASH3D_ENV_MANAGER="$2"
            shift 2
            ;;
        *)
            shift
            ;;
    esac
done

# ── Compute mode resolver ────────────────────────────────────────────────────
source "$PROJECT_ROOT/scripts/lib/compute_mode.sh"
COMPUTE_MODE=$(resolve_compute_mode) || exit $?
echo "[INFO] Compute mode: ${COMPUTE_MODE}"

# ── Helper functions ─────────────────────────────────────────────────────────

# Test whether a wheel file exists and is valid
_wheel_is_valid() {
    local whl="$1"
    [ -f "$whl" ] || return 1
    if command -v unzip >/dev/null 2>&1; then
        unzip -tqq "$whl" >/dev/null 2>&1
    elif command -v python3 >/dev/null 2>&1; then
        python3 -c "import zipfile, sys; zipfile.ZipFile(sys.argv[1]).testzip()" "$whl" >/dev/null 2>&1
    else
        [ -s "$whl" ]
    fi
}

# Retry a command up to N times
_retry() {
    local max="${1:-3}"
    local delay="${2:-5}"
    shift 2
    local n=1
    while true; do
        if "$@"; then return 0; fi
        if [ "$n" -ge "$max" ]; then return 1; fi
        echo "[WARN] Command failed (attempt $n/$max). Retrying in ${delay}s..."
        sleep "${delay}"
        n=$((n + 1))
    done
}

# Install one matching local wheel; fall back to pip if not found
install_local_wheel() {
    local pattern="$1"
    local label="$2"
    local wheel=""

    if [ -d "$WHEEL_DIR" ]; then
        wheel="$(find "$WHEEL_DIR" -maxdepth 1 -type f -name "$pattern" -print -quit)"
    fi

    if [ -n "$wheel" ]; then
        if ! _wheel_is_valid "$wheel"; then
            echo "[WARN] Local wheel for $label appears corrupted: $(basename "$wheel"); skipping."
            return 1
        fi
        echo "[INFO] Using local wheel for $label: $(basename "$wheel")"
        $UV_PIP install "$wheel" && return 0
        echo "[WARN] Local wheel for $label failed; falling back to source build."
    fi
    return 1
}

# Ensure release wheels are available in WHEEL_DIR
ensure_release_wheels() {
    mkdir -p "$WHEEL_DIR"
    echo "[INFO] Downloading release wheels to $WHEEL_DIR..."
    python3 -c '
import urllib.request, json, os, sys
req = urllib.request.Request("https://api.github.com/repos/Silentzx2/ForMesh3D/releases/tags/Wheels", headers={"User-Agent": "ForMash3D-Installer"})
try:
    for a in json.loads(urllib.request.urlopen(req, timeout=30).read()).get("assets", []):
        if a["name"].endswith(".whl"):
            p = os.path.join(sys.argv[1], a["name"])
            if not os.path.exists(p):
                urllib.request.urlretrieve(a["browser_download_url"], p)
except Exception as e:
    print(f"[WARN] Wheel download warning: {e}")
' "$WHEEL_DIR" 2>/dev/null || true
}

# Ensure Blender executable is available
ensure_blender() {
    if command -v blender >/dev/null 2>&1; then
        echo "[INFO] Blender already available: $(command -v blender)"
        return 0
    fi
    if [[ "${BLENDER_ENABLED:-true}" != "true" ]]; then
        echo "[WARN] Blender disabled by BLENDER_ENABLED=false; skipping."
        return 0
    fi
    if command -v apt-get >/dev/null 2>&1; then
        local sudo_cmd=""
        command -v sudo >/dev/null 2>&1 && sudo_cmd="sudo"
        echo "[INFO] Installing Blender via apt..."
        $sudo_cmd apt-get update -qq 2>/dev/null || true
        $sudo_cmd apt-get install -y --no-install-recommends blender 2>/dev/null || true
    fi
    if ! command -v blender >/dev/null 2>&1; then
        echo "[WARN] Blender not available on PATH. Set BLENDER_EXECUTABLE=/path/to/blender."
    fi
}

# Persist environment config to .env
persist_env_config() {
    local env_file="$PROJECT_ROOT/.env"
    if [[ ! -f "$env_file" && -f "$PROJECT_ROOT/.env.example" ]]; then
        cp "$PROJECT_ROOT/.env.example" "$env_file"
    fi
    if [[ -f "$env_file" ]]; then
        for pair in "FORMASH3D_ENV_MANAGER=${ENV_MANAGER}" \
                    "AI_STUDIO_ENV_MANAGER=${ENV_MANAGER}" \
                    "PYTHON_EXEC=${ACTIVE_PYTHON}" \
                    "UV_PYTHON=${ACTIVE_PYTHON}"; do
            local k="${pair%%=*}"
            local v="${pair#*=}"
            if grep -q "^${k}=" "$env_file"; then
                sed -i "s|^${k}=.*|${k}=${v}|" "$env_file"
            else
                echo "${k}=${v}" >> "$env_file"
            fi
        done
        echo "[INFO] Persisted environment config to $env_file"
    fi
}

# ── Header ───────────────────────────────────────────────────────────────────
echo "========================================"
echo "Starting Backend-API Installation"
echo "========================================"
echo "The installation may take a while, please wait..."
echo ""

# ── Choose environment manager ───────────────────────────────────────────────
choose_env_manager() {
    local default="${ENV_MANAGER:-conda}"
    local choice=""
    if [[ "${AUTO_MODE:-0}" == "1" || "${NONINTERACTIVE:-0}" == "1" || "${CI:-}" == "true" || -n "${FORMASH3D_ENV_MANAGER:-}" || ! -t 0 ]]; then
        choice="${default}"
        echo "[INFO] Non-interactive / Auto mode: selected '${choice}'"
    elif [ -e /dev/tty ]; then
        read -r -p "Select environment manager [conda|venv] (default: ${default}): " choice < /dev/tty || choice=""
    else
        read -r -p "Select environment manager [conda|venv] (default: ${default}): " choice || choice=""
    fi
    choice="${choice:-${default}}"
    case "${choice}" in
        conda|Conda|CONDA) ENV_MANAGER="conda" ;;
        venv|Venv|VENV) ENV_MANAGER="venv" ;;
        *)
            echo "[WARN] Invalid choice '${choice}'. Falling back to ${default}."
            ENV_MANAGER="${default}"
            ;;
    esac
    export FORMASH3D_ENV_MANAGER="${ENV_MANAGER}"
    export AI_STUDIO_ENV_MANAGER="${ENV_MANAGER}"
    echo "[INFO] Using environment manager: ${ENV_MANAGER}"
    echo "[INFO] Target environment: 3daigc-api (Python 3.10)"
}
choose_env_manager

# ── Activate Python environment (conda or venv) ──────────────────────────────
ENV_NAME="3daigc-api"

if [[ "${ENV_MANAGER}" == "conda" ]]; then
    if ! command -v conda >/dev/null 2>&1; then
        for candidate in "$HOME/miniconda3" "/opt/conda" "$HOME/anaconda3" "/root/miniconda3"; do
            if [[ -f "$candidate/etc/profile.d/conda.sh" ]]; then
                source "$candidate/etc/profile.d/conda.sh"
                export PATH="$candidate/bin:$PATH"
                break
            fi
        done
    fi
    if ! command -v conda >/dev/null 2>&1; then
        echo "[INFO] Conda not found. Installing Miniconda..."
        CONDA_HOME="${CONDA_HOME:-$HOME/miniconda3}"
        MINICONDA_URL="https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh"
        INSTALLER="/tmp/miniconda-installer.sh"
        if curl -fsSL "$MINICONDA_URL" -o "$INSTALLER"; then
            bash "$INSTALLER" -b -u -p "$CONDA_HOME" || true
            rm -f "$INSTALLER"
        else
            echo "[WARN] Could not download Miniconda; falling back to venv."
            rm -f "$INSTALLER"
        fi
        export PATH="$CONDA_HOME/bin:$PATH"
        if [[ -f "$CONDA_HOME/etc/profile.d/conda.sh" ]]; then
            source "$CONDA_HOME/etc/profile.d/conda.sh"
        fi
    fi

    if command -v conda >/dev/null 2>&1; then
        echo "[INFO] Conda: $(conda --version 2>&1)"
        conda tos accept --override-channels --channel https://repo.anaconda.com/pkgs/main 2>/dev/null || true
        conda tos accept --override-channels --channel https://repo.anaconda.com/pkgs/r 2>/dev/null || true
        eval "$(conda shell.bash hook 2>/dev/null || true)"
        if [[ "${CONDA_DEFAULT_ENV:-}" == "$ENV_NAME" ]]; then
            echo "[INFO] Conda env '$ENV_NAME' already active."
        elif conda info --envs 2>/dev/null | awk '{print $1}' | grep -qx "$ENV_NAME"; then
            echo "[INFO] Activating existing conda env '$ENV_NAME'..."
            conda activate "$ENV_NAME" 2>/dev/null || source activate "$ENV_NAME" 2>/dev/null || true
        else
            echo "[INFO] Creating conda env '$ENV_NAME' (Python 3.10)..."
            if conda create -n "$ENV_NAME" python=3.10 -y 2>/dev/null; then
                conda activate "$ENV_NAME" 2>/dev/null || source activate "$ENV_NAME" 2>/dev/null || true
            else
                echo "[WARN] Conda env creation failed; falling back to venv..."
                ENV_MANAGER="venv"
            fi
        fi
        if [[ "${ENV_MANAGER}" == "conda" ]]; then
            CONDA_PY_VER="$(python -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || echo "")"
            if [[ "$CONDA_PY_VER" != "3.10" && "${CONDA_DEFAULT_ENV:-}" != "$ENV_NAME" ]]; then
                echo "[WARN] Conda env '$ENV_NAME' not active (Python $CONDA_PY_VER); falling back to venv..."
                ENV_MANAGER="venv"
            fi
        fi
    else
        echo "[WARN] Conda not available. Falling back to venv..."
        ENV_MANAGER="venv"
    fi
fi

if [[ "${ENV_MANAGER}" == "venv" ]]; then
    ENV_DIR="$PROJECT_ROOT/3daigc-api"
    if [[ ! -d "$ENV_DIR" && -d "$PROJECT_ROOT/.venv" && -x "$PROJECT_ROOT/.venv/bin/python" ]]; then
        ENV_DIR="$PROJECT_ROOT/.venv"
    fi
    if [[ ! -d "$ENV_DIR" ]]; then
        echo "[INFO] Creating Python 3.10 venv at $ENV_DIR..."
        if command -v python3.10 >/dev/null 2>&1; then
            python3.10 -m venv "$ENV_DIR" || exit 1
        elif command -v uv >/dev/null 2>&1; then
            uv venv "$ENV_DIR" --python 3.10 --seed 2>/dev/null || uv venv "$ENV_DIR" --python 3.10 || exit 1
        else
            python3 -m venv "$ENV_DIR" || exit 1
        fi
    fi
    source "$ENV_DIR/bin/activate" || exit 1
fi

echo "[INFO] Environment manager: $ENV_MANAGER"
echo "[INFO] Active Python: $(python -c 'import sys; print(sys.executable)')"
ACTIVE_PYTHON="$(python -c 'import sys; print(sys.executable)')"
export UV_PYTHON="$ACTIVE_PYTHON"

persist_env_config

if ! python -c "import uv" >/dev/null 2>&1; then
    echo "[INFO] Installing uv..."
    python -m pip install --upgrade pip 2>/dev/null || true
    python -m pip install uv 2>/dev/null || $UV_PIP install uv 2>/dev/null || true
fi

# ── Build toolchain ──────────────────────────────────────────────────────────
echo "[INFO] Installing build toolchain..."
$UV_PIP install scikit-build-core pybind11 ninja setuptools wheel cython packaging setuptools-scm
if [ $? -eq 0 ]; then
    echo "[SUCCESS] Build toolchain installed"
else
    echo "[WARN] Build toolchain had warnings; continuing..."
fi

# ── PyTorch ──────────────────────────────────────────────────────────────────
if [[ "${COMPUTE_MODE:-}" == "cpu" ]]; then
    echo "[INFO] Installing PyTorch (CPU)..."
    $UV_PIP install torch==2.6.0 torchvision==0.21.0 torchaudio==2.6.0 --index-url https://download.pytorch.org/whl/cpu || { echo "[ERROR] PyTorch install failed"; exit 1; }
    echo "[SUCCESS] PyTorch (CPU) installed."
else
    echo "[INFO] Installing PyTorch (CUDA)..."
    $UV_PIP install torch==2.6.0 torchvision==0.21.0 torchaudio==2.6.0 --index-url https://download.pytorch.org/whl/cu124 || { echo "[ERROR] PyTorch install failed"; exit 1; }
    echo "[SUCCESS] PyTorch installed."
fi

# Disable build isolation (needed by flash-attn, nvdiffrec_render, etc.)
echo "[INFO] Build isolation: disabled (PIP_NO_BUILD_ISOLATION=1)"
export PIP_NO_BUILD_ISOLATION=1
export UV_NO_BUILD_ISOLATION=1

if [[ "${COMPUTE_MODE:-}" == "cuda" ]]; then
    ensure_release_wheels
fi

# ── Project requirements ──────────────────────────────────────────────────────
echo ""
echo "========================================"
echo "Installing Project Requirements"
echo "========================================"
echo "The installation may take a while, please wait..."
echo ""
ensure_blender

echo "[INFO] Installing requirements.txt..."
$UV_PIP install -r "$PROJECT_ROOT/backend/requirements.txt" || { echo "[ERROR] Requirements install failed"; exit 1; }
echo "[SUCCESS] Project requirements installed."

# ── Model requirements & custom dependencies (GPU only) ──────────────────────
if [[ "${COMPUTE_MODE:-}" == "cuda" ]]; then
    echo ""
    echo "========================================"
    echo "Installing Model Dependencies"
    echo "========================================"
    echo "The installation may take a while, please wait..."
    echo ""

    if [[ -f "$PROJECT_ROOT/backend/requirements-models.txt" ]]; then
        echo "[INFO] Installing requirements-models.txt..."
        $UV_PIP install --find-links="$WHEEL_DIR" -r "$PROJECT_ROOT/backend/requirements-models.txt" --index-strategy unsafe-best-match || { echo "[ERROR] Model requirements install failed"; exit 1; }
        echo "[SUCCESS] Model requirements installed."
    fi

    echo ""
    echo "========================================"
    echo "Installing Custom GitHub/Wheel Dependencies"
    echo "========================================"
    echo "The installation may take a while, please wait..."
    echo ""
    echo "[INFO] Installing model dependencies from GitHub/wheel sources..."

    # flash-attn — prebuilt wheel only, no source build
    echo "[INFO] Installing flash-attn..."
    install_local_wheel "flash_attn-*.whl" "flash-attn" || { echo "[ERROR] flash-attn wheel not found in $WHEEL_DIR"; exit 1; }

    # diso — prebuilt wheel only, no source build
    echo "[INFO] Installing diso..."
    install_local_wheel "diso-*.whl" "diso" || { echo "[ERROR] diso wheel not found in $WHEEL_DIR"; exit 1; }

    # nvdiffrast — prebuilt wheel only, no source build
    echo "[INFO] Installing nvdiffrast..."
    install_local_wheel "nvdiffrast-*.whl" "nvdiffrast" || { echo "[ERROR] nvdiffrast wheel not found in $WHEEL_DIR"; exit 1; }

    # nvdiffrec_render — prebuilt wheel only, no source build
    echo "[INFO] Installing nvdiffrec..."
    install_local_wheel "nvdiffrec_render-*.whl" "nvdiffrec" || { echo "[ERROR] nvdiffrec wheel not found in $WHEEL_DIR"; exit 1; }

    # CuMesh — prebuilt wheel only, no source build
    echo "[INFO] Installing CuMesh..."
    install_local_wheel "cumesh-*.whl" "CuMesh" || { echo "[ERROR] CuMesh wheel not found in $WHEEL_DIR"; exit 1; }

    # o-voxel — prebuilt wheel only, no source build
    echo "[INFO] Installing o-voxel..."
    install_local_wheel "o_voxel-*.whl" "o-voxel" || { echo "[ERROR] o-voxel wheel not found in $WHEEL_DIR"; exit 1; }

    # kaolin (NVIDIA S3 wheel — no wheel-house copy)
    echo "[INFO] Installing kaolin..."
    $UV_PIP install --find-links="$WHEEL_DIR" kaolin -f https://nvidia-kaolin.s3.us-east-2.amazonaws.com/torch-2.6.0_cu124.html \
        || { echo "[ERROR] kaolin install failed"; exit 1; }

    # diff_gaussian_rasterization — prebuilt wheel only, no source build
    echo "[INFO] Installing diff-gaussian-rasterization..."
    install_local_wheel "diff_gaussian_rasterization-*.whl" "diff-gaussian-rasterization" || { echo "[ERROR] diff-gaussian-rasterization wheel not found in $WHEEL_DIR"; exit 1; }

    # pytorch3d — prebuilt wheel only, no source build
    echo "[INFO] Installing pytorch3d..."
    install_local_wheel "pytorch3d-*.whl" "pytorch3d" || { echo "[ERROR] pytorch3d wheel not found in $WHEEL_DIR"; exit 1; }

    # torch_scatter — prebuilt wheel only, no source build
    echo "[INFO] Installing torch_scatter..."
    install_local_wheel "torch_scatter-*.whl" "torch_scatter" || { echo "[ERROR] torch_scatter wheel not found in $WHEEL_DIR"; exit 1; }

    # spconv-cu124 — prebuilt wheel only, no source build
    echo "[INFO] Installing spconv-cu124..."
    install_local_wheel "spconv-cu124-*.whl" "spconv-cu124" || { echo "[ERROR] spconv-cu124 wheel not found in $WHEEL_DIR"; exit 1; }

    echo "[SUCCESS] Model dependencies installed."
else
    echo "[INFO] Skipping model dependencies (no GPU detected)."
fi

# ── System runtime libraries ─────────────────────────────────────────────────
echo ""
echo "========================================"
echo "Installing System Runtime Libraries"
echo "========================================"
if command -v apt-get >/dev/null 2>&1 || command -v apt >/dev/null 2>&1; then
    APT_BIN="$(command -v apt-get 2>/dev/null || command -v apt 2>/dev/null)"
    echo "[INFO] Debian/Ubuntu detected. Installing system runtime libraries..."
    SUDO_CMD=""
    if [ "$(id -u)" -ne 0 ]; then
        if command -v sudo >/dev/null 2>&1; then
            SUDO_CMD="sudo"
        else
            echo "[ERROR] Root/sudo required for apt installs."
            exit 1
        fi
    fi
    if ! $SUDO_CMD "$APT_BIN" update -qq; then
        echo "[ERROR] Failed to update apt repositories."
        exit 1
    fi
    if ! $SUDO_CMD "$APT_BIN" install -y --no-install-recommends libsm6 libegl-mesa0 libgl1-mesa-dev; then
        echo "[ERROR] Failed to install system runtime libraries."
        exit 1
    fi
    echo "[SUCCESS] System runtime libraries installed."
else
    echo "[WARN] apt not found. Skipping system libraries."
    echo "[WARN] Ensure libsm6, libegl-mesa0, libgl1-mesa-dev are installed."
fi

# ── Validate runtime environment ─────────────────────────────────────────────
echo ""
echo "========================================"
echo "Validating Runtime Environment"
echo "========================================"
python -c "
import sys
print(f'Python Executable: {sys.executable}')
print(f'Python Version: {sys.version.split()[0]}')
try:
    import torch
    print(f'PyTorch Version: {torch.__version__}')
    print(f'PyTorch CUDA Version: {torch.version.cuda}')
    print(f'CUDA Available: {torch.cuda.is_available()}')
    if torch.cuda.is_available():
        print(f'GPU Device: {torch.cuda.get_device_name(0)}')
    else:
        print('GPU Device: None (CPU mode)')
except Exception as e:
    print(f'PyTorch/CUDA check error: {e}')
for pkg in ['numpy', 'diffusers', 'transformers', 'pymeshlab', 'open3d', 'trimesh', 'rembg']:
    try:
        mod = __import__(pkg)
        print(f'{pkg}: {getattr(mod, \"__version__\", \"installed\")}')
    except Exception as e:
        print(f'{pkg}: NOT FOUND ({e})')
"

persist_env_config 2>/dev/null || true

echo ""
echo "========================================"
echo "Installation Complete!"
echo "========================================"
echo "All installation done successfully!"