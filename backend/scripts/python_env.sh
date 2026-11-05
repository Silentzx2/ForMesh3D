#!/usr/bin/env bash
# Shared Python environment resolver. Source this file from backend scripts.

formesh_python_prefix() {
    "$1" -c 'import os, sys; print(os.path.realpath(sys.prefix))' 2>/dev/null
}

formesh_python_matches_manager() {
    local manager="$1" python_bin="$2" prefix
    [[ -x "$python_bin" ]] || return 1
    prefix="$(formesh_python_prefix "$python_bin")" || return 1
    case "$manager" in
        venv) [[ -f "$prefix/pyvenv.cfg" ]] ;;
        conda) [[ -d "$prefix/conda-meta" ]] ;;
        *) return 1 ;;
    esac
}

formesh_find_conda() {
    command -v conda >/dev/null 2>&1 && return 0
    local root
    for root in "${CONDA_HOME:-}" "$HOME/miniconda3" "$HOME/anaconda3" "/opt/conda" "/root/miniconda3" "/usr/local/miniconda3" "/usr/local/anaconda3"; do
        [[ -n "$root" ]] || continue
        if [[ -x "$root/bin/conda" ]]; then
            export PATH="$root/bin:$PATH"
            return 0
        fi
    done
    return 1
}

formesh_resolve_python() {
    local manager="${1:-}" candidate="" root="" env_name=""
    FORMESH_PYTHON_BIN=""

    case "$manager" in
        venv)
            # Prefer exact installer path, but reject it if it belongs to Conda.
            if [[ -n "${PYTHON_EXEC:-}" ]] && formesh_python_matches_manager venv "$PYTHON_EXEC"; then
                FORMESH_PYTHON_BIN="$PYTHON_EXEC"
                return 0
            fi
            for root in "${FORMASH3D_VENV_PATH:-}" "${VIRTUAL_ENV:-}" "$PROJECT_ROOT/3daigc-api" "$PROJECT_ROOT/.venv" "$PROJECT_ROOT/backend/.venv"; do
                [[ -n "$root" ]] || continue
                root="${root/#\~/$HOME}"
                [[ "$root" == /* ]] || root="$PROJECT_ROOT/$root"
                candidate="$root/bin/python"
                if formesh_python_matches_manager venv "$candidate"; then
                    FORMESH_PYTHON_BIN="$candidate"
                    return 0
                fi
            done
            ;;
        conda)
            # Prefer exact installer path, but reject it if it belongs to a venv.
            if [[ -n "${PYTHON_EXEC:-}" ]] && formesh_python_matches_manager conda "$PYTHON_EXEC"; then
                FORMESH_PYTHON_BIN="$PYTHON_EXEC"
                return 0
            fi
            if [[ -n "${FORMASH3D_CONDA_ENV_PATH:-}" ]]; then
                root="${FORMASH3D_CONDA_ENV_PATH/#\~/$HOME}"
                [[ "$root" == /* ]] || root="$PROJECT_ROOT/$root"
                candidate="$root/bin/python"
                if formesh_python_matches_manager conda "$candidate"; then
                    FORMESH_PYTHON_BIN="$candidate"
                    return 0
                fi
                echo "[WARN] Invalid Conda prefix: $root" >&2
            fi
            env_name="${FORMASH3D_CONDA_ENV_NAME:-${CONDA_ENV_NAME:-3daigc-api}}"
            if formesh_find_conda; then
                if [[ "$env_name" == "base" ]]; then
                    root="$(conda info --base 2>/dev/null || true)"
                    candidate="$root/bin/python"
                else
                    candidate="$(conda run -n "$env_name" python -c 'import sys; print(sys.executable)' 2>/dev/null | tail -n 1 || true)"
                fi
                if formesh_python_matches_manager conda "$candidate"; then
                    FORMESH_PYTHON_BIN="$candidate"
                    return 0
                fi
            fi
            # Never let an unrelated active base environment shadow the chosen env.
            if [[ -n "${CONDA_PREFIX:-}" && "${CONDA_DEFAULT_ENV:-$(basename "$CONDA_PREFIX")}" == "$env_name" ]]; then
                candidate="$CONDA_PREFIX/bin/python"
                if formesh_python_matches_manager conda "$candidate"; then
                    FORMESH_PYTHON_BIN="$candidate"
                    return 0
                fi
            fi
            ;;
        *)
            echo "[ERROR] Unsupported FORMASH3D_ENV_MANAGER '$manager' (expected conda or venv)." >&2
            return 1
            ;;
    esac

    echo "[ERROR] Could not resolve the selected '$manager' Python environment." >&2
    echo "[ERROR] Check PYTHON_EXEC and the selected environment path/name in .env." >&2
    return 1
}
