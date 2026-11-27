"""Pluggable loader for upstream repos inside backend/thirdparty/<repo>."""

from __future__ import annotations

import importlib.util
import os
import sys
from contextlib import contextmanager
from pathlib import Path
from types import ModuleType
from typing import Iterator

THIRDPARTY_ROOT = Path(__file__).resolve().parents[2] / "thirdparty"
PRETRAINED_ROOT = Path(__file__).resolve().parents[2] / "pretrained"


def resolve_thirdparty(repo_name: str) -> Path:
    repo_root = THIRDPARTY_ROOT / repo_name
    if not repo_root.is_dir():
        raise FileNotFoundError(f"Third-party repo not found: {repo_root}")
    return repo_root


def resolve_pretrained(model_dir: str) -> Path:
    weights_dir = PRETRAINED_ROOT / model_dir
    if not weights_dir.is_dir():
        raise FileNotFoundError(f"Pretrained weights missing: {weights_dir}")
    return weights_dir


@contextmanager
def use_thirdparty(repo_name: str, chdir: bool = True) -> Iterator[Path]:
    """Add backend/thirdparty/<repo_name> to sys.path and temporarily chdir into it."""
    repo_root = resolve_thirdparty(repo_name)
    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))
    prev_cwd = os.getcwd()
    try:
        if chdir:
            os.chdir(repo_root)
        yield repo_root
    finally:
        if chdir:
            os.chdir(prev_cwd)


def load_thirdparty_script(repo_name: str, rel_path: str) -> ModuleType:
    """Load a third-party script by path under a unique module name to avoid package clashes."""
    repo_root = resolve_thirdparty(repo_name)
    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))
    script_path = repo_root / rel_path
    if not script_path.is_file():
        raise FileNotFoundError(f"Third-party script not found: {script_path}")
    mod_name = f"_thirdparty_{repo_name}_{script_path.stem}"
    if mod_name in sys.modules:
        return sys.modules[mod_name]
    spec = importlib.util.spec_from_file_location(mod_name, script_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load third-party script: {script_path}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[mod_name] = mod
    spec.loader.exec_module(mod)
    return mod
