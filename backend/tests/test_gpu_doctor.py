"""Unit tests for GPUDoctor (patcher.doctor).

Verifies:
1. Hardware inspection on CPU and mocked modern/pre-Ampere GPUs.
2. Zero regression for modern GPUs (sm >= 80): native BF16, FlashAttention preservation.
3. Pre-Ampere fallback routing (sm < 80): chunked SDPA, memory offload, safe dtypes.
4. Mathematical equality of chunked SDPA vs standard SDPA.
5. Error taxonomy and classification across all known failure modes.
6. Stage tracking, memory telemetry, and bounded recovery logic.
7. Model preparation and memory planning.
8. Patcher package export parity.
"""

from __future__ import annotations

import pytest
import torch
import torch.nn as nn
import torch.nn.functional as F

from patcher import GPUDoctor as PatcherInitGPUDoctor
from patcher.doctor import (
    DoctorConfig,
    DoctorReport,
    GPUDoctor,
    GPUInfo,
    ModelProfile,
    RecoveryEvent,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def doctor() -> GPUDoctor:
    return GPUDoctor(DoctorConfig(mode="auto", enable_recovery=True, max_retries=2))


@pytest.fixture
def modern_gpu_info() -> GPUInfo:
    """Mock an NVIDIA A100 (sm_80, 40GB, native BF16 & FlashAttention)."""
    return GPUInfo(
        device_id=0,
        device_name="NVIDIA A100-SXM4-40GB",
        major=8,
        minor=0,
        compute_capability=(8, 0),
        total_vram_gb=40.0,
        free_vram_gb=38.5,
        supports_bf16=True,
        supports_flash_attn=True,
        is_pre_ampere=False,
        is_cpu=False,
    )


@pytest.fixture
def hopper_gpu_info() -> GPUInfo:
    """Mock an NVIDIA H100 (sm_90, 80GB, native BF16 & FlashAttention)."""
    return GPUInfo(
        device_id=0,
        device_name="NVIDIA H100 80GB HBM3",
        major=9,
        minor=0,
        compute_capability=(9, 0),
        total_vram_gb=80.0,
        free_vram_gb=78.0,
        supports_bf16=True,
        supports_flash_attn=True,
        is_pre_ampere=False,
        is_cpu=False,
    )


@pytest.fixture
def pre_ampere_t4_info() -> GPUInfo:
    """Mock an NVIDIA Tesla T4 (sm_75, 15GB, no native BF16, no FlashAttention)."""
    return GPUInfo(
        device_id=0,
        device_name="Tesla T4",
        major=7,
        minor=5,
        compute_capability=(7, 5),
        total_vram_gb=15.0,
        free_vram_gb=14.2,
        supports_bf16=False,
        supports_flash_attn=False,
        is_pre_ampere=True,
        is_cpu=False,
    )


@pytest.fixture
def pre_ampere_v100_info() -> GPUInfo:
    """Mock an NVIDIA Tesla V100 (sm_70, 16GB, Volta, no BF16)."""
    return GPUInfo(
        device_id=0,
        device_name="Tesla V100-PCIE-16GB",
        major=7,
        minor=0,
        compute_capability=(7, 0),
        total_vram_gb=16.0,
        free_vram_gb=15.5,
        supports_bf16=False,
        supports_flash_attn=False,
        is_pre_ampere=True,
        is_cpu=False,
    )


# ---------------------------------------------------------------------------
# Test Cases
# ---------------------------------------------------------------------------

class TestGPUDoctorInspection:
    def test_inspect_cpu(self, doctor: GPUDoctor):
        info = doctor.inspect_gpu()
        assert info.is_cpu is True
        assert info.compute_capability == (0, 0)
        assert not info.is_pre_ampere
        assert not info.supports_flash_attn

    def test_package_export_parity(self):
        assert PatcherInitGPUDoctor is GPUDoctor


class TestModernGPUZeroRegression:
    """Verify Rule #1: Under NO circumstances should logic, attention kernels, or BF16
    precision on modern GPUs (sm >= 80) be degraded or altered."""

    def test_a100_preserves_native_bf16(self, doctor: GPUDoctor, modern_gpu_info: GPUInfo):
        for model_name in ["trellis2", "taoflowforge", "pixal3d"]:
            profile = doctor.get_model_profile(model_name)
            chosen_dtype = doctor.select_precision(profile, gpu_info=modern_gpu_info)
            assert chosen_dtype == torch.bfloat16, f"{model_name} must retain native BF16 on sm_80"

    def test_h100_preserves_native_bf16(self, doctor: GPUDoctor, hopper_gpu_info: GPUInfo):
        profile = doctor.get_model_profile("taoflowforge")
        chosen_dtype = doctor.select_precision(profile, gpu_info=hopper_gpu_info)
        assert chosen_dtype == torch.bfloat16, "TaoFlowForge must retain native BF16 on sm_90"

    def test_a100_selects_flash_attn(self, doctor: GPUDoctor, modern_gpu_info: GPUInfo):
        backend = doctor.select_attention_backend(gpu_info=modern_gpu_info)
        assert backend == "flash_attn"

    def test_a100_memory_plan_resident(self, doctor: GPUDoctor, modern_gpu_info: GPUInfo):
        profile = doctor.get_model_profile("taoflowforge")
        plan = doctor.build_memory_plan("taoflowforge", profile, gpu_info=modern_gpu_info)
        assert plan["strategy"] == "resident"
        assert plan["precision_dtype"] == torch.bfloat16
        assert plan["attention_backend"] == "flash_attn"


class TestPreAmpereFallbacks:
    """Verify smart pre-Ampere (sm < 80) handling: fallback precision & chunked SDPA."""

    def test_t4_selects_fallback_precision(self, doctor: GPUDoctor, pre_ampere_t4_info: GPUInfo):
        profile = doctor.get_model_profile("trellis2")
        chosen_dtype = doctor.select_precision(profile, gpu_info=pre_ampere_t4_info)
        assert chosen_dtype == torch.float16

    def test_v100_selects_sdpa_or_xformers(self, doctor: GPUDoctor, pre_ampere_v100_info: GPUInfo):
        backend = doctor.select_attention_backend(gpu_info=pre_ampere_v100_info)
        assert backend in ("sdpa", "xformers")

    def test_t4_low_vram_activates_offload_and_chunking(
        self, doctor: GPUDoctor, pre_ampere_t4_info: GPUInfo
    ):
        profile = doctor.get_model_profile("taoflowforge")
        plan = doctor.build_memory_plan("taoflowforge", profile, gpu_info=pre_ampere_t4_info)
        assert plan["strategy"] == "cpu_offload"
        assert plan["use_low_vram"] is True
        assert plan["enable_query_chunking"] is True


class TestChunkedSDPAMathematicalEquality:
    """Verify query chunking produces exact mathematical output matching full SDPA."""

    def test_chunked_sdpa_matches_full_sdpa(self, doctor: GPUDoctor):
        batch, heads, seq_len, head_dim = 1, 4, 1024, 64
        torch.manual_seed(42)
        q = torch.randn(batch, heads, seq_len, head_dim, dtype=torch.float32)
        k = torch.randn(batch, heads, seq_len, head_dim, dtype=torch.float32)
        v = torch.randn(batch, heads, seq_len, head_dim, dtype=torch.float32)

        # Baseline: PyTorch official SDPA
        baseline_out = F.scaled_dot_product_attention(q, k, v)

        # Chunked SDPA with chunk_size = 256
        chunked_out = doctor.chunked_scaled_dot_product_attention(q, k, v, chunk_size=256)

        # Numerical equality assertion
        assert torch.allclose(chunked_out, baseline_out, atol=1e-5), "Chunked SDPA must match full SDPA output"
        max_diff = (chunked_out - baseline_out).abs().max().item()
        assert max_diff < 1e-5, f"Max difference too high: {max_diff}"

    def test_chunked_sdpa_with_4d_mask(self, doctor: GPUDoctor):
        batch, heads, seq_len, head_dim = 2, 4, 1024, 64
        torch.manual_seed(42)
        q = torch.randn(batch, heads, seq_len, head_dim)
        k = torch.randn(batch, heads, seq_len, head_dim)
        v = torch.randn(batch, heads, seq_len, head_dim)
        mask = torch.zeros(batch, heads, seq_len, seq_len, dtype=torch.bool)

        baseline_out = F.scaled_dot_product_attention(q, k, v, attn_mask=mask)
        chunked_out = doctor.chunked_scaled_dot_product_attention(q, k, v, mask=mask, chunk_size=256)

        assert torch.allclose(chunked_out, baseline_out, atol=1e-5)

    def test_chunked_sdpa_3d_tensor(self, doctor: GPUDoctor):
        batch, seq_len, head_dim = 2, 1024, 128
        torch.manual_seed(42)
        q = torch.randn(batch, seq_len, head_dim)
        k = torch.randn(batch, seq_len, head_dim)
        v = torch.randn(batch, seq_len, head_dim)

        baseline_out = F.scaled_dot_product_attention(q, k, v)
        chunked_out = doctor.chunked_scaled_dot_product_attention(q, k, v, chunk_size=256)

        assert torch.allclose(chunked_out, baseline_out, atol=1e-5)

    def test_chunked_sdpa_with_scale(self, doctor: GPUDoctor):
        q = torch.randn(1, 2, 512, 32)
        k = torch.randn(1, 2, 512, 32)
        v = torch.randn(1, 2, 512, 32)

        baseline_out = F.scaled_dot_product_attention(q, k, v, scale=0.25)
        chunked_out = doctor.chunked_scaled_dot_product_attention(q, k, v, chunk_size=128, scale=0.25)

        assert torch.allclose(chunked_out, baseline_out, atol=1e-5)

    def test_chunked_sdpa_rejects_dropout(self, doctor: GPUDoctor):
        q = torch.randn(1, 2, 64, 32)
        k = torch.randn(1, 2, 64, 32)
        v = torch.randn(1, 2, 64, 32)
        with pytest.raises(ValueError, match="dropout_p"):
            doctor.chunked_scaled_dot_product_attention(q, k, v, dropout_p=0.1)

    def test_chunked_sdpa_rejects_causal(self, doctor: GPUDoctor):
        q = torch.randn(1, 2, 64, 32)
        k = torch.randn(1, 2, 64, 32)
        v = torch.randn(1, 2, 64, 32)
        with pytest.raises(ValueError, match="is_causal"):
            doctor.chunked_scaled_dot_product_attention(q, k, v, is_causal=True)


class TestErrorClassification:
    def test_classifies_cuda_oom(self, doctor: GPUDoctor):
        err = RuntimeError("CUDA out of memory. Tried to allocate 10.06 GiB (GPU 0; 14.75 GiB total capacity)")
        assert doctor.classify_error(err) == "cuda_oom"

    def test_classifies_unsupported_precision(self, doctor: GPUDoctor):
        err = RuntimeError("bfloat16 not supported on sm_75 device")
        assert doctor.classify_error(err) == "unsupported_precision"

    def test_classifies_dtype_mismatch(self, doctor: GPUDoctor):
        err = RuntimeError("expected scalar type Float but found Half")
        assert doctor.classify_error(err) == "dtype_mismatch"

    def test_classifies_device_mismatch(self, doctor: GPUDoctor):
        err = RuntimeError("Expected all tensors to be on the same device, but found cuda:0 and cpu!")
        assert doctor.classify_error(err) == "device_mismatch"

    def test_classifies_attention_backend_failure(self, doctor: GPUDoctor):
        err = RuntimeError("Flash attention only supports Ampere, Ada, or Hopper GPUs.")
        assert doctor.classify_error(err) == "attention_backend_failure"

    def test_classifies_sparse_empty_voxels(self, doctor: GPUDoctor):
        err = RuntimeError("TRELLIS.2 sparse-structure decoding produced no occupied voxels (max_logit=-74.8335)")
        assert doctor.classify_error(err) == "sparse_empty_voxels"

    def test_classifies_unknown(self, doctor: GPUDoctor):
        err = ValueError("Something unexpected happened")
        assert doctor.classify_error(err) == "unknown"


class TestStageTrackingAndRecovery:
    def test_track_stage_success(self, doctor: GPUDoctor):
        with doctor.track_stage("stage_0_occupancy") as stage:
            # Simulate work
            a = torch.randn(100, 100)
            _ = a @ a

        assert stage.success is True
        assert stage.duration_s >= 0.0
        report = doctor.get_report()
        assert "stage_0_occupancy" in report.stage_timings
        assert report.stage_timings["stage_0_occupancy"] >= 0.0
        assert len(report.stages) == 1
        assert report.stages[0].stage_name == "stage_0_occupancy"

    def test_clean_cache_safe_execution(self, doctor: GPUDoctor):
        # clean_cache should execute cleanly on CPU and CUDA without raising
        doctor.clean_cache()

    def test_track_stage_failure(self, doctor: GPUDoctor):
        with pytest.raises(RuntimeError):
            with doctor.track_stage("stage_fail") as stage:
                raise RuntimeError("CUDA out of memory in test")

        report = doctor.get_report()
        assert len(report.events) == 1
        assert report.events[0].stage_name == "stage_fail"
        assert report.events[0].error_type == "cuda_oom"
        assert len(report.stages) == 1
        assert report.stages[0].success is False

    def test_recovery_bounded_retries(self, doctor: GPUDoctor):
        oom_err = RuntimeError("CUDA out of memory. Tried to allocate 2.00 GiB")

        # Retry 0: allowed
        ev0 = doctor.recover("stage_0", oom_err, retry_count=0)
        assert ev0.success is True
        assert ev0.action_taken == "cleared_cuda_cache_and_garbage"

        # Retry 1: allowed (max_retries=2)
        ev1 = doctor.recover("stage_0", oom_err, retry_count=1)
        assert ev1.success is True

        # Retry 2: rejected because retry_count == max_retries
        ev2 = doctor.recover("stage_0", oom_err, retry_count=2)
        assert ev2.success is False
        assert "max_retries_exceeded" in ev2.action_taken

    def test_report_summary_formatting(self, doctor: GPUDoctor):
        with doctor.track_stage("test_stage"):
            pass
        summary = doctor.get_report().format_summary()
        assert "GPU Doctor Diagnostic Report" in summary
        assert "test_stage" in summary


class TestModelPreparation:
    def test_prepare_cpu_model(self, doctor: GPUDoctor):
        model = nn.Sequential(nn.Linear(10, 5), nn.ReLU(), nn.Linear(5, 2))
        profile = ModelProfile(
            model_id="test_model",
            supported_dtypes=[torch.float32],
            supports_bf16=False,
            supports_fp16=True,
            supports_fp32=True,
        )
        plan = doctor.build_memory_plan("test_model", profile)
        prepared = doctor.prepare_model(model, plan)
        assert isinstance(prepared, nn.Module)
        test_input = torch.randn(2, 10)
        output = prepared(test_input)
        assert output.shape == (2, 2)
