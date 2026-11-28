import sys
from pathlib import Path
from types import SimpleNamespace

import yaml

backend_root = Path(__file__).resolve().parents[1]
repo_root = backend_root.parent
if str(backend_root) not in sys.path:
    sys.path.insert(0, str(backend_root))
if str(repo_root) not in sys.path:
    sys.path.insert(0, str(repo_root))

from backend.adapters.ardy_adapter import ArdyMotionGenerationAdapter
from patcher.ardy import apply_nf4_patch


class FakeBitsAndBytesConfig:
    def __init__(self, **kwargs):
        self.kwargs = kwargs


class FakeLLM2Vec:
    @classmethod
    def from_pretrained(cls, *args, **kwargs):
        return {"args": args, "kwargs": kwargs}

    def __init__(self):
        self.model = SimpleNamespace(is_loaded_in_4bit=True)
        self.to_calls = 0

    def to(self, *args, **kwargs):
        self.to_calls += 1
        return self


def test_ardy_llm2vec_uses_nf4_and_assigned_gpu_without_moving_quantized_weights():
    apply_nf4_patch(FakeLLM2Vec, FakeBitsAndBytesConfig, SimpleNamespace(float16="fp16"), 2)

    loaded = FakeLLM2Vec.from_pretrained("local-llama")
    config = loaded["kwargs"]["quantization_config"]
    assert config.kwargs["load_in_4bit"] is True
    assert config.kwargs["bnb_4bit_quant_type"] == "nf4"
    assert config.kwargs["bnb_4bit_use_double_quant"] is True
    assert loaded["kwargs"]["device_map"] == {"": 2}

    encoder = FakeLLM2Vec()
    assert encoder.to("cuda:2") is encoder
    assert encoder.to_calls == 0


def test_ardy_llm2vec_keeps_normal_to_behavior_for_non_quantized_models():
    apply_nf4_patch(FakeLLM2Vec, FakeBitsAndBytesConfig, SimpleNamespace(float16="fp16"), 0)

    encoder = FakeLLM2Vec()
    encoder.model = SimpleNamespace()
    encoder.to("cpu")
    assert encoder.to_calls == 1


def test_ardy_refuses_unconditional_generation_when_prompt_encoder_is_missing():
    adapter = ArdyMotionGenerationAdapter(vram_requirement=6144)
    adapter._model = SimpleNamespace(text_encoder=None)
    adapter._loaded_checkpoint = "ARDY-Core-RP-20FPS-Horizon40"
    adapter._resolve_checkpoint_name = lambda _checkpoint=None, **_kwargs: adapter._loaded_checkpoint

    result = adapter._process_request({"prompt": "walk forward", "seed": 7})

    assert result["success"] is False
    assert "refusing unconditional motion generation" in result["error"]


def test_ardy_manifest_reserves_gpu_for_nf4_encoder():
    model_path = repo_root / "backend" / "config" / "models.yaml"
    models = yaml.safe_load(model_path.read_text(encoding="utf-8"))
    ardy = models["motion_generation"]["ardy_motion_generation"]

    assert ardy["vram_requirement"] == 6144
    assert ardy["capabilities"]["motion_model_cpu"] is True
    assert ardy["capabilities"]["text_encoder_gpu"] is True
    assert ardy["capabilities"]["text_encoder_quantization"] == "nf4"
    assert ardy["capabilities"].get("cpu_only") is not True
