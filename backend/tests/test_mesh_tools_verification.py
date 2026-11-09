"""Verification test suite for mesh tools:
- Services: run_segment, run_auto_retopo, run_auto_uv
- HTTP endpoints: /api/v1/mesh-tools/auto-retopo, /api/v1/mesh-tools/auto-uv, /api/v1/mesh-tools/segment
"""
import base64
import io
import json
import sys
import time
import requests
import trimesh

from postprocess.schemas import AutoRetopoOptions, AutoUvOptions, SegmentOptions
from postprocess.services.auto_retopo import run_auto_retopo
from postprocess.services.auto_uv import run_auto_uv
from postprocess.services.segment import run_segment


def parse_sse_events(response_iter):
    """Parse SSE lines into event objects."""
    events = []
    buffer = ""
    for chunk in response_iter:
        if isinstance(chunk, bytes):
            chunk = chunk.decode("utf-8")
        buffer += chunk
        while "\n\n" in buffer:
            event_raw, buffer = buffer.split("\n\n", 1)
            lines = [line.strip() for line in event_raw.split("\n") if line.strip()]
            for line in lines:
                if line.startswith("data:"):
                    data_str = line[len("data:"):].strip()
                    try:
                        events.append(json.loads(data_str))
                    except json.JSONDecodeError:
                        pass
    return events


def test_service_segment():
    print("\n--- Testing Service: run_segment (num_parts=4) ---")
    mesh = trimesh.creation.icosphere(subdivisions=3, radius=1.0)
    opts = SegmentOptions(num_parts=4, proxy_faces=500, sdf_rays=10)
    
    t0 = time.time()
    result = run_segment(mesh, opts)
    dt = time.time() - t0
    
    assert "mesh_b64" in result, "Missing mesh_b64 in run_segment result"
    assert result["mesh_b64"] is not None, "mesh_b64 is None"
    
    glb_bytes = base64.b64decode(result["mesh_b64"])
    scene = trimesh.load(io.BytesIO(glb_bytes), file_type="glb")
    geom_count = len(scene.geometry)
    print(f"run_segment succeeded in {dt:.2f}s: produced GLB scene with {geom_count} geometries")
    for name, geom in scene.geometry.items():
        print(f"  - {name}: {len(geom.faces)} faces, {len(geom.vertices)} vertices")
        
    assert geom_count == 4, f"Expected 4 geometries in GLB scene, got {geom_count}"
    print("[PASS] test_service_segment")
    return True


def test_service_auto_retopo():
    print("\n--- Testing Service: run_auto_retopo (target_faces=200) ---")
    mesh = trimesh.creation.icosphere(subdivisions=2, radius=1.0)
    opts = AutoRetopoOptions(target_faces=200)
    
    t0 = time.time()
    retopo_mesh, stats, preview = run_auto_retopo(mesh, opts)
    dt = time.time() - t0
    
    assert isinstance(retopo_mesh, trimesh.Trimesh), f"Expected Trimesh, got {type(retopo_mesh)}"
    assert len(retopo_mesh.faces) > 0, "Retopo mesh has 0 faces"
    print(f"run_auto_retopo succeeded in {dt:.2f}s: faces={len(retopo_mesh.faces)}, vertices={len(retopo_mesh.vertices)}")
    print(f"  Fidelity gate: {stats.get('fidelity_gate')}")
    assert stats.get("fidelity_gate", {}).get("passed") is True, "Fidelity gate failed"
    print("[PASS] test_service_auto_retopo")
    return True


def test_service_auto_uv():
    print("\n--- Testing Service: run_auto_uv (resolution=512) ---")
    mesh = trimesh.creation.icosphere(subdivisions=2, radius=1.0)
    opts = AutoUvOptions(resolution=512)
    
    t0 = time.time()
    uv_mesh, stats, preview = run_auto_uv(mesh, opts)
    dt = time.time() - t0
    
    assert isinstance(uv_mesh, trimesh.Trimesh), f"Expected Trimesh, got {type(uv_mesh)}"
    assert hasattr(uv_mesh, "visual") and hasattr(uv_mesh.visual, "uv"), "Mesh missing UV visuals"
    uv_coords = uv_mesh.visual.uv
    assert uv_coords is not None and len(uv_coords) > 0, "UV coordinates empty"
    print(f"run_auto_uv succeeded in {dt:.2f}s: uv_shape={uv_coords.shape}, charts={stats.get('n_charts')}")
    print("[PASS] test_service_auto_uv")
    return True


def test_endpoint_auto_uv(base_url="http://localhost:7842"):
    print("\n--- Testing HTTP Endpoint: /api/v1/mesh-tools/auto-uv ---")
    mesh = trimesh.creation.icosphere(subdivisions=2, radius=1.0)
    glb_bytes = mesh.export(file_type="glb")
    
    files = {"meshFile": ("test_sphere.glb", glb_bytes, "model/gltf-binary")}
    data = {"options": json.dumps({"resolution": 512}), "format": "glb"}
    
    t0 = time.time()
    res = requests.post(f"{base_url}/api/v1/mesh-tools/auto-uv", files=files, data=data, stream=True, timeout=60)
    assert res.status_code == 200, f"HTTP {res.status_code}: {res.text}"
    
    events = parse_sse_events(res.iter_content(chunk_size=1024))
    dt = time.time() - t0
    assert len(events) > 0, "No SSE events received"
    
    done_event = next((e for e in events if e.get("type") == "done"), None)
    err_event = next((e for e in events if e.get("type") == "error"), None)
    
    assert err_event is None, f"SSE error event received: {err_event}"
    assert done_event is not None, f"No terminal done event found in {len(events)} events"
    assert "mesh_b64" in done_event, "No mesh_b64 in done event"
    print(f"Endpoint auto-uv succeeded in {dt:.2f}s: received {len(events)} SSE events, output format={done_event.get('format')}")
    print(f"  Stats: {done_event.get('stats')}")
    print("[PASS] test_endpoint_auto_uv")
    return True


def test_endpoint_segment(base_url="http://localhost:7842"):
    print("\n--- Testing HTTP Endpoint: /api/v1/mesh-tools/segment (num_parts=4) ---")
    mesh = trimesh.creation.icosphere(subdivisions=3, radius=1.0)
    glb_bytes = mesh.export(file_type="glb")
    
    files = {"meshFile": ("test_sphere.glb", glb_bytes, "model/gltf-binary")}
    data = {"options": json.dumps({"num_parts": 4, "proxy_faces": 500, "sdf_rays": 10})}
    
    t0 = time.time()
    res = requests.post(f"{base_url}/api/v1/mesh-tools/segment", files=files, data=data, stream=True, timeout=60)
    assert res.status_code == 200, f"HTTP {res.status_code}: {res.text}"
    
    events = parse_sse_events(res.iter_content(chunk_size=1024))
    dt = time.time() - t0
    assert len(events) > 0, "No SSE events received"
    
    done_event = next((e for e in events if e.get("type") == "done"), None)
    err_event = next((e for e in events if e.get("type") == "error"), None)
    
    assert err_event is None, f"SSE error event received: {err_event}"
    assert done_event is not None, f"No terminal done event found in {len(events)} events"
    assert "mesh_b64" in done_event, "No mesh_b64 in done event"
    assert done_event["mesh_b64"] is not None, "mesh_b64 is None in done event"
    
    out_glb = base64.b64decode(done_event["mesh_b64"])
    scene = trimesh.load(io.BytesIO(out_glb), file_type="glb")
    geom_count = len(scene.geometry)
    print(f"Endpoint segment succeeded in {dt:.2f}s: received {len(events)} SSE events, GLB scene has {geom_count} geometries")
    assert geom_count == 4, f"Expected 4 geometries, got {geom_count}"
    print("[PASS] test_endpoint_segment")
    return True


def test_endpoint_auto_retopo(base_url="http://localhost:7842"):
    print("\n--- Testing HTTP Endpoint: /api/v1/mesh-tools/auto-retopo (target_faces=200) ---")
    mesh = trimesh.creation.icosphere(subdivisions=2, radius=1.0)
    glb_bytes = mesh.export(file_type="glb")
    
    files = {"meshFile": ("test_sphere.glb", glb_bytes, "model/gltf-binary")}
    data = {"options": json.dumps({"target_faces": 200}), "format": "glb"}
    
    t0 = time.time()
    res = requests.post(f"{base_url}/api/v1/mesh-tools/auto-retopo", files=files, data=data, stream=True, timeout=120)
    assert res.status_code == 200, f"HTTP {res.status_code}: {res.text}"
    
    events = parse_sse_events(res.iter_content(chunk_size=1024))
    dt = time.time() - t0
    assert len(events) > 0, "No SSE events received"
    
    done_event = next((e for e in events if e.get("type") == "done"), None)
    err_event = next((e for e in events if e.get("type") == "error"), None)
    
    assert err_event is None, f"SSE error event received: {err_event}"
    assert done_event is not None, f"No terminal done event found in {len(events)} events"
    assert "mesh_b64" in done_event, "No mesh_b64 in done event"
    print(f"Endpoint auto-retopo succeeded in {dt:.2f}s: received {len(events)} SSE events, stats={done_event.get('stats')}")
    print("[PASS] test_endpoint_auto_retopo")
    return True


def main():
    results = {}
    
    print("==================================================")
    print("STARTING POSTPROCESS SERVICES & ENDPOINTS VERIFICATION")
    print("==================================================")
    
    # 1. Services direct tests
    try:
        results["service_segment_4parts"] = test_service_segment()
    except Exception as exc:
        print(f"[FAIL] test_service_segment: {exc}")
        results["service_segment_4parts"] = False
        
    try:
        results["service_auto_uv"] = test_service_auto_uv()
    except Exception as exc:
        print(f"[FAIL] test_service_auto_uv: {exc}")
        results["service_auto_uv"] = False

    try:
        results["service_auto_retopo"] = test_service_auto_retopo()
    except Exception as exc:
        print(f"[FAIL] test_service_auto_retopo: {exc}")
        results["service_auto_retopo"] = False

    # 2. HTTP endpoints tests
    try:
        results["endpoint_segment_4parts"] = test_endpoint_segment()
    except Exception as exc:
        print(f"[FAIL] test_endpoint_segment: {exc}")
        results["endpoint_segment_4parts"] = False

    try:
        results["endpoint_auto_uv"] = test_endpoint_auto_uv()
    except Exception as exc:
        print(f"[FAIL] test_endpoint_auto_uv: {exc}")
        results["endpoint_auto_uv"] = False

    try:
        results["endpoint_auto_retopo"] = test_endpoint_auto_retopo()
    except Exception as exc:
        print(f"[FAIL] test_endpoint_auto_retopo: {exc}")
        results["endpoint_auto_retopo"] = False

    print("\n==================================================")
    print("VERIFICATION SUMMARY")
    print("==================================================")
    all_passed = True
    for test_name, passed in results.items():
        status = "PASS" if passed else "FAIL"
        print(f"  {test_name:<30}: {status}")
        if not passed:
            all_passed = False

    sys.exit(0 if all_passed else 1)


if __name__ == "__main__":
    main()
