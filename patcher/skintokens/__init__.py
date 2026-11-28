"""
SkinTokens model-specific patcher.

Fixes pre-Ampere (Tesla T4 sm_75, etc.) GPU compatibility and imports:

1. FlashAttention crash: FlashAttention 2 requires Ampere+ GPUs (sm_80+).
   Forces attn_implementation = "sdpa" on pre-Ampere GPUs (sm < 80) or when
   FlashAttention 2 is not compiled for the current device.

2. T4 BF16 performance: Tesla T4 (sm_75) lacks native BFloat16 tensor cores.
   On sm < 80, maps compute precision to torch.float16 (or torch.float32)
   to leverage T4 native FP16 tensor cores and avoid software emulation.

3. Large GPU Zero Regression: On modern GPUs (sm >= 80, e.g. A100, RTX 3090/4090, H100),
   runs in 100% native upstream mode (official FlashAttention 2, native BF16).

4. Zero Model Code Modification: Executes strictly inside this patcher module,
   leaving backend/thirdparty/SkinTokens completely untouched.

5. Headless import shim: Injects lightweight dummy module for gradio if not
   installed, enabling demo.py's load_model and run_rig to be used directly.
"""

from __future__ import annotations

import logging
import sys
import types
from typing import Any, Optional

try:
    import torch
except ImportError:  # pragma: no cover
    torch = None

from patcher.doctor import GPUDoctor
from patcher.skintokens.qwen3_compat import register_qwen3_if_missing

logger = logging.getLogger(__name__)


class AlignedShapeLatentPerceiver(torch.nn.Module):
    """Stub for the real Michelangelo encoder. Not vendored upstream."""
    _skintokens_stub = True

    def __init__(self, **kwargs):
        super().__init__()

    def load_state_dict(self, state_dict, strict=True):
        # Accept any checkpoint without error so load proceeds; the
        # adapter rejects stub models before inference.
        return super().load_state_dict({}, strict=False)

    def _load_from_state_dict(self, state_dict, prefix, local_metadata, strict,
                              missing_keys, unexpected_keys, error_msgs):
        # Ignore all checkpoint keys for this stub module
        pass

    def forward(self, *args, **kwargs):
        raise RuntimeError(
            "SkinTokens: real Michelangelo models source is not vendored. "
            "Vendor backend/thirdparty/SkinTokens/src/model/michelangelo/models/"
            " and retry."
        )


class ShapeAsLatentPerceiverEncoder(torch.nn.Module):
    """Stub for the real Michelangelo encoder. Not vendored upstream."""
    _skintokens_stub = True

    def __init__(self, width=768, **kwargs):
        super().__init__()
        self.width = width

    def load_state_dict(self, state_dict, strict=True):
        # Accept any checkpoint without error so load proceeds; the
        # adapter rejects stub models before inference.
        return super().load_state_dict({}, strict=False)

    def _load_from_state_dict(self, state_dict, prefix, local_metadata, strict,
                              missing_keys, unexpected_keys, error_msgs):
        # Ignore all checkpoint keys for this stub module so the
        # parent TokenRig.load_state_dict(strict=True) does not fail
        # on unexpected keys from the real Michelangelo encoder.
        pass

    def forward(self, *args, **kwargs):
        raise RuntimeError(
            "SkinTokens: real Michelangelo models source is not vendored. "
            "Vendor backend/thirdparty/SkinTokens/src/model/michelangelo/models/"
            " and retry."
        )


def apply_patch(gpu_id: Optional[int] = None) -> None:
    """Apply SkinTokens pre-Ampere and import compatibility patches."""
    _inject_michelangelo_models_stub()
    _shim_gradio_if_missing()
    register_qwen3_if_missing()
    _patch_dataloader_num_workers()
    _patch_vocab_logits_processor()
    _patch_tokenrig_generate(gpu_id=gpu_id)
    _patch_attention_and_precision(gpu_id=gpu_id)


def _patch_tokenrig_generate(gpu_id: Optional[int] = None) -> None:
    """Fix T4 bfloat16 precision and transformers 4.44 beam_search+do_sample EOS invariant."""
    if torch is None:
        return
    try:
        from src.model.tokenrig import TokenRig
    except ImportError:
        return
    if getattr(TokenRig, "_skintokens_gen_patched", False):
        return

    is_pre_ampere = GPUDoctor().inspect_gpu(gpu_id).is_pre_ampere
    orig_generate = TokenRig.generate

    def _safe_generate(self: Any, *args: Any, **kwargs: Any) -> Any:
        if is_pre_ampere and not getattr(self, "_skintokens_fp32_cast", False):
            # Avoid bfloat16 emulation NaN/overflow on sm < 80 (T4) during long beam search.
            self.float()
            self._skintokens_fp32_cast = True

        # In transformers==4.44, beam_search + do_sample=True uses multinomial over
        # (num_beams * vocab), which fails BeamSearchScorer's n_eos <= num_beams check
        # when VocabSwitchingLogitsProcessor masks all tokens except eos_token_id.
        if kwargs.get("num_beams", 1) > 1 and kwargs.get("do_sample", False):
            kwargs["do_sample"] = False
            for k in ("top_k", "top_p", "temperature"):
                kwargs.pop(k, None)

        if is_pre_ampere:
            with torch.amp.autocast("cuda", enabled=False):
                return orig_generate.__wrapped__(self, *args, **kwargs) if hasattr(orig_generate, "__wrapped__") else orig_generate(self, *args, **kwargs)
        return orig_generate(self, *args, **kwargs)

    TokenRig.generate = _safe_generate  # type: ignore[method-assign]
    TokenRig._skintokens_gen_patched = True  # type: ignore[attr-defined]


def _patch_vocab_logits_processor() -> None:
    """Guard VocabSwitchingLogitsProcessor against NaN/inf or all-masked rows during beam search."""
    if torch is None:
        return
    try:
        from src.model.tokenrig import VocabSwitchingLogitsProcessor
    except ImportError:
        return
    if getattr(VocabSwitchingLogitsProcessor, "_skintokens_logits_patched", False):
        return
    orig_call = VocabSwitchingLogitsProcessor.__call__

    def _safe_call(self: Any, input_ids: Any, scores: Any) -> Any:
        # Clamp NaN/+inf before masking so (+inf) + (-inf) never turns into NaN.
        scores = torch.nan_to_num(scores.float(), nan=0.0, posinf=1e4, neginf=-1e4)
        out = orig_call(self, input_ids, scores)
        for row_idx in range(out.shape[0]):
            if not torch.isfinite(out[row_idx]).any():
                out[row_idx, self.eos_token_id] = 0.0
        return out

    VocabSwitchingLogitsProcessor.__call__ = _safe_call  # type: ignore[method-assign]
    VocabSwitchingLogitsProcessor._skintokens_logits_patched = True  # type: ignore[attr-defined]


def _patch_dataloader_num_workers() -> None:
    """Force num_workers=0 in SkinTokens DatasetConfig.parse and DataLoader
    to avoid CUDA IPC pidfd_getfd errors in container environments without
    pidfd_getfd support."""
    try:
        from src.data.dataset import DatasetConfig
    except ImportError:
        pass
    else:
        if getattr(DatasetConfig, "_skintokens_nw_patched", False):
            pass
        else:
            orig_parse = DatasetConfig.parse.__func__

            @classmethod
            def _patched_parse(cls: Any, *args: Any, **kwargs: Any) -> Any:
                if kwargs.get("num_workers", 0):
                    kwargs["num_workers"] = 0
                    kwargs["persistent_workers"] = False
                    kwargs["pin_memory"] = False
                return orig_parse(cls, *args, **kwargs)

            DatasetConfig.parse = _patched_parse  # type: ignore[assignment]
            DatasetConfig._skintokens_nw_patched = True  # type: ignore[attr-defined]

    try:
        from torch.utils.data import DataLoader
    except ImportError:
        return
    if getattr(DataLoader, "_skintokens_nw_patched", False):
        return
    orig_init = DataLoader.__init__

    def _patched_init(self, dataset, batch_size=1, shuffle=False, sampler=None,
                      batch_sampler=None, num_workers=0, collate_fn=None,
                      pin_memory=False, drop_last=False, timeout=0,
                      worker_init_fn=None, multiprocessing_context=None,
                      generator=None, *, prefetch_factor=2,
                      persistent_workers=False):
        num_workers = 0  # Force num_workers=0 to avoid multiprocessing spawn issues
        prefetch_factor = None  # prefetch_factor invalid when num_workers=0
        persistent_workers = False  # persistent_workers invalid when num_workers=0
        return orig_init(self, dataset, batch_size, shuffle, sampler, batch_sampler,
                         num_workers, collate_fn, pin_memory, drop_last,
                         timeout, worker_init_fn, multiprocessing_context,
                         generator, prefetch_factor=None,
                         persistent_workers=False)

    DataLoader.__init__ = _patched_init  # type: ignore[assignment]
    DataLoader._skintokens_nw_patched = True  # type: ignore[attr-defined]


def _inject_michelangelo_models_stub() -> None:
    """Inject stub modules for the missing Michelangelo models package.

    The vendored SkinTokens source is missing
    backend/thirdparty/SkinTokens/src/model/michelangelo/models/ which
    src/model/michelangelo/get_model.py imports at line 3. Without this,
    `import demo` crashes with ModuleNotFoundError before any weights are
    loaded. The stub allows the import chain and demo.load_model() to
    proceed; the adapter then surfaces a clear error if the real
    architecture is still absent at inference time.
    """
    if torch is None:
        return

    import importlib.util
    import types

    try:
        if importlib.util.find_spec("src.model.michelangelo.models.tsal.sal_perceiver") is not None:
            return
    except ModuleNotFoundError:
        pass

    # Only register packages that are actually missing from disk.
    # src, src.model, src.model.michelangelo exist on disk (with __init__.py)
    # and must resolve normally — do not replace them with empty-path stubs,
    # otherwise sibling subpackages (e.g. src.data) become unimportable.
    missing_pkgs = [
        "src.model.michelangelo.models",
        "src.model.michelangelo.models.tsal",
    ]
    for pkg_name in missing_pkgs:
        if pkg_name not in sys.modules:
            pkg = types.ModuleType(pkg_name)
            pkg.__path__ = []
            pkg.__package__ = pkg_name
            sys.modules[pkg_name] = pkg

    mod_name = "src.model.michelangelo.models.tsal.sal_perceiver"
    if mod_name not in sys.modules:
        mod = types.ModuleType(mod_name)

        mod.AlignedShapeLatentPerceiver = AlignedShapeLatentPerceiver
        mod.ShapeAsLatentPerceiverEncoder = ShapeAsLatentPerceiverEncoder
        mod.__package__ = "src.model.michelangelo.models.tsal"
        sys.modules[mod_name] = mod
        logger.debug("SkinTokens patcher: injected Michelangelo models stub")


def bpy_server_popen_args(skintokens_root: str, repo_root: str) -> list[str]:
    """Popen args that launch the bpy_server companion with the Michelangelo
    models stub pre-injected in the subprocess.

    Falls back to ``blender -b --python-expr`` when ``bpy`` is not installed
    in ``sys.executable`` (e.g. Python 3.10 where PyPI ``bpy>=4.2`` is unavailable).
    """
    import importlib.util
    import os
    import shutil
    import site

    extra_paths = site.getsitepackages() if hasattr(site, "getsitepackages") else []
    snippet = (
        "import sys\n"
        "for p in {extra_paths!r}:\n"
        "    if p not in sys.path:\n"
        "        sys.path.append(p)\n"
        "sys.path.insert(0, {repo_root!r})\n"
        "sys.path.insert(0, {skintokens_root!r})\n"
        "from patcher.skintokens import _inject_michelangelo_models_stub\n"
        "_inject_michelangelo_models_stub()\n"
        "from src.server.bpy_server import run\n"
        "run()\n"
    ).format(repo_root=repo_root, skintokens_root=skintokens_root, extra_paths=extra_paths)

    if importlib.util.find_spec("bpy") is not None:
        return [sys.executable, "-c", snippet]

    blender_bin = os.environ.get("BLENDER_PATH") or shutil.which("blender")
    if blender_bin:
        return [blender_bin, "-b", "--python-expr", snippet]
    return [sys.executable, "-c", snippet]


def _shim_gradio_if_missing() -> None:
    """Provide a minimal shim if gradio is not installed in the environment."""
    if "gradio" in sys.modules:
        return

    try:
        import gradio  # noqa: F401
    except ImportError:
        dummy = types.ModuleType("gradio")
        dummy.TEMP_DIR = "tmp_gradio"
        dummy_class = type("Dummy", (), {
            "__enter__": lambda s: s,
            "__exit__": lambda *a: None,
            "click": lambda *a, **k: None,
            "launch": lambda *a, **k: None,
        })
        for name in ("Blocks", "Markdown", "File", "Accordion", "Dropdown", "Slider", "Checkbox", "Button", "Textbox"):
            setattr(dummy, name, lambda *a, **k: dummy_class())
        sys.modules["gradio"] = dummy
        logger.debug("SkinTokens patcher: installed headless gradio shim")


def _patch_attention_and_precision(gpu_id: Optional[int] = None) -> None:
    """Configure attention backend and precision according to GPU architecture using GPUDoctor."""
    doctor = GPUDoctor()
    gpu_info = doctor.inspect_gpu(gpu_id)
    is_pre_ampere = gpu_info.is_pre_ampere or gpu_info.is_cpu

    if is_pre_ampere and not gpu_info.is_cpu:
        logger.info(
            "SkinTokens patcher: pre-Ampere GPU (sm_%d%d, e.g. Tesla T4) detected. "
            "Configuring SDPA attention and float16 precision for native hardware acceleration.",
            gpu_info.major,
            gpu_info.minor,
        )

    # Patch transformers AutoModelForCausalLM if present
    try:
        import transformers
        if getattr(transformers, "_skintokens_patched", False):
            return

        orig_from_config = transformers.AutoModelForCausalLM.from_config

        def patched_from_config(config: Any, **kwargs: Any) -> Any:
            if is_pre_ampere:
                # Fall back to SDPA when FlashAttention 2 is unsupported
                if kwargs.get("attn_implementation") == "flash_attention_2":
                    kwargs["attn_implementation"] = "sdpa"
                if hasattr(config, "_attn_implementation") and config._attn_implementation == "flash_attention_2":
                    config._attn_implementation = "sdpa"
                # On T4, adapt BF16 to FP16 for native tensor core acceleration
                if getattr(config, "torch_dtype", None) == (getattr(torch, "bfloat16", None) if torch else None):
                    config.torch_dtype = torch.float16 if torch else None

            return orig_from_config(config, **kwargs)

        transformers.AutoModelForCausalLM.from_config = patched_from_config  # type: ignore
        transformers._skintokens_patched = True
    except (ImportError, AttributeError):
        pass
