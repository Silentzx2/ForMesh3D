import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGenerationParameters,
  getNativeTargetCapability,
} from './buildGenerationParameters';
import type { GenerationSettings } from '../types';

describe('buildGenerationParameters', () => {
  const baseSettings: GenerationSettings = {
    mode: 'image-to-3d',
    image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    imageName: 'test_character.png',
    aiModel: 'hunyuan3d_dit_v2_mini_turbo_image_to_raw_mesh',
    textureQuality: 'high',
    quadTopology: false,
    topologyMode: 'triangle',
    seed: 42,
    removeBackground: true,
    autoOptimizeSettings: { targetPolycount: 100000 },
    polycount: 600000,
    enablePostprocess: true,
    generateTexture: true,
    highResolutionNormalBaking: true,
  };

  it('preserves texture options when enablePostprocess is false', () => {
    const settings: GenerationSettings = {
      ...baseSettings,
      enablePostprocess: false,
      generateTexture: true,
      textureQuality: 'high', // maps to 4K / 4096
      highResolutionNormalBaking: true,
    };

    const result = buildGenerationParameters(settings);

    // Texture options must NOT be forced to false
    assert.equal(result.body.texture_enabled, true);
    assert.equal(result.body.generate_texture, true);
    assert.equal(result.body.texture_resolution, 4096);
    assert.equal(result.body.bake_normal_maps, true);

    // Postprocess decimation/LODs must be disabled
    assert.equal(result.body.enable_postprocess, false);
    assert.equal(result.body.target_polycount, 0);
    assert.equal(result.body.topology_mode, 'triangle');
    assert.equal(result.body.quad_topology, false);
    assert.equal(result.body.generate_lod, false);
  });

  it('passes target_polycount (up to 1M) and topology_mode when enablePostprocess is true', () => {
    const settings: GenerationSettings = {
      ...baseSettings,
      enablePostprocess: true,
      polycount: 1000000,
      topologyMode: 'quad',
      quadTopology: true,
    };

    const result = buildGenerationParameters(settings);

    assert.equal(result.body.enable_postprocess, true);
    assert.equal(result.body.target_polycount, 1000000);
    assert.equal(result.body.topology_mode, 'quad');
    assert.equal(result.body.quad_topology, true);
  });

  it('passes native_target_polycount when enablePostprocess is false (native extraction path)', () => {
    const settings: GenerationSettings = {
      ...baseSettings,
      enablePostprocess: false,
      polycount: 50000,
    };

    const result = buildGenerationParameters(settings);

    assert.equal(result.body.enable_postprocess, false);
    assert.equal(result.body.target_polycount, 0);
    assert.equal(result.body.native_target_polycount, 50000);
  });

  it('clamps native_target_polycount to 1M maximum', () => {
    const settings: GenerationSettings = {
      ...baseSettings,
      enablePostprocess: false,
      polycount: 2000000,
    };

    const result = buildGenerationParameters(settings);

    assert.equal(result.body.native_target_polycount, 1000000);
  });

  it('sets native_target_polycount to 0 when no polycount is requested', () => {
    const settings: GenerationSettings = {
      ...baseSettings,
      enablePostprocess: false,
      polycount: 0,
    };

    const result = buildGenerationParameters(settings);

    assert.equal(result.body.enable_postprocess, false);
    assert.equal(result.body.target_polycount, 0);
    assert.equal(result.body.native_target_polycount, 0);
  });

  it('matches model_preference with user selected AI model', () => {
    const models = [
      'hunyuan3d_dit_v2_mini_turbo_image_to_raw_mesh',
      'taoflowforge_image_to_raw_mesh',
      'pixal3d_image_to_raw_mesh',
    ];

    for (const modelId of models) {
      const settings: GenerationSettings = {
        ...baseSettings,
        aiModel: modelId,
      };
      const result = buildGenerationParameters(settings);
      assert.equal(result.body.model_preference, modelId);
    }
  });

  it('uses imageName for asset_name and cleanStem', () => {
    const settings: GenerationSettings = {
      ...baseSettings,
      imageName: 'my_awesome_robot.png',
    };

    const result = buildGenerationParameters(settings);
    assert.equal(result.body.asset_name, 'my_awesome_robot');
    assert.equal(result.body.image_name, 'my_awesome_robot');
  });

  it('honors texture disable when user explicitly turns texture off', () => {
    const settings: GenerationSettings = {
      ...baseSettings,
      enablePostprocess: true,
      generateTexture: false,
      texture_enabled: false,
    };
    const result = buildGenerationParameters(settings);
    assert.equal(result.body.texture_enabled, false);
    assert.equal(result.body.generate_texture, false);
  });

  it('routes TripoSR generation to raw geometry when texture is disabled', () => {
    const result = buildGenerationParameters({
      ...baseSettings, aiModel: 'triposr_image_to_raw_mesh',
      generateTexture: false, texture_enabled: false,
    }, { raw_mesh: true, supports_texture: true });
    assert.equal(result.endpoint, '/api/v1/generate');
    assert.equal(result.body.model_preference, 'triposr_image_to_raw_mesh');
    assert.equal(result.body.texture_enabled, false);
    assert.equal(result.body.texture_resolution, undefined);
  });

  it('routes TripoSR generation to the optional bake path when texture is enabled', () => {
    const result = buildGenerationParameters({
      ...baseSettings, aiModel: 'triposr_image_to_raw_mesh',
      generateTexture: true, texture_enabled: true, textureResolution: '2K',
    }, { raw_mesh: true, supports_texture: true });
    assert.equal(result.endpoint, '/api/v1/generate');
    assert.equal(result.body.model_preference, 'triposr_image_to_raw_mesh');
    assert.equal(result.body.texture_enabled, true);
    assert.equal(result.body.texture_resolution, 2048);
  });

  it('uses the canonical generation endpoint for textured-only models (SF3D)', () => {
    const settings: GenerationSettings = {
      ...baseSettings,
      aiModel: 'stable_fast_3d_image_to_textured_mesh',
      enablePostprocess: false,
      generateTexture: true,
    };
    const result = buildGenerationParameters(settings, { supports_texture: true });
    assert.equal(result.endpoint, '/api/v1/generate');
    assert.equal(result.body.texture_enabled, true);
    assert.equal(result.body.model_preference, 'stable_fast_3d_image_to_textured_mesh');
  });

  it('uses the canonical generation endpoint for SF3D even when texture is disabled', () => {
    const settings: GenerationSettings = {
      ...baseSettings,
      aiModel: 'stable_fast_3d_image_to_textured_mesh',
      enablePostprocess: false,
      generateTexture: false,
      texture_enabled: false,
    };
    const result = buildGenerationParameters(settings, { supports_texture: true });
    assert.equal(result.endpoint, '/api/v1/generate');
    assert.equal(result.body.texture_enabled, false);
  });

  it('keeps raw model selection on the canonical generation endpoint when texture is enabled', () => {
    const settings: GenerationSettings = {
      ...baseSettings,
      aiModel: 'hunyuan3d_shape_v21_image_to_raw_mesh',
      enablePostprocess: false,
      generateTexture: true,
    };
    const result = buildGenerationParameters(settings, { raw_mesh: true });
    assert.equal(result.endpoint, '/api/v1/generate');
    assert.equal(result.body.texture_enabled, true);
  });

  describe('getNativeTargetCapability', () => {
    it('classifies SF3D as NATIVE_INDIRECT_CONTROL with vertex_count', () => {
      const cap = getNativeTargetCapability('stable_fast_3d_image_to_textured_mesh');
      assert.equal(cap.capability, 'NATIVE_INDIRECT_CONTROL');
      assert.equal(cap.parameterName, 'vertex_count');
      assert.equal(cap.reachesUpstream, true);
      assert.ok(cap.evidence.length > 0);
    });

    it('classifies TripoSG as NATIVE_MAX_LIMIT with faces (post-process only)', () => {
      const cap = getNativeTargetCapability('triposg_image_to_raw_mesh');
      assert.equal(cap.capability, 'NATIVE_MAX_LIMIT');
      assert.equal(cap.parameterName, 'faces');
      assert.equal(cap.reachesUpstream, false);
    });

    it('classifies Hunyuan3D v2.1 as NATIVE_INDIRECT_CONTROL with octree_resolution', () => {
      const cap = getNativeTargetCapability('hunyuan3d_shape_v21_image_to_raw_mesh');
      assert.equal(cap.capability, 'NATIVE_INDIRECT_CONTROL');
      assert.equal(cap.parameterName, 'octree_resolution');
      assert.equal(cap.reachesUpstream, true);
    });

    it('classifies Hunyuan3D Mini Turbo as NATIVE_INDIRECT_CONTROL with octree_resolution', () => {
      const cap = getNativeTargetCapability('hunyuan3d_dit_v2_mini_turbo_image_to_raw_mesh');
      assert.equal(cap.capability, 'NATIVE_INDIRECT_CONTROL');
      assert.equal(cap.parameterName, 'octree_resolution');
      assert.equal(cap.reachesUpstream, true);
    });

    it('classifies TRELLIS as UNSUPPORTED (no native face count)', () => {
      const cap = getNativeTargetCapability('trellis_image_to_raw_mesh');
      assert.equal(cap.capability, 'UNSUPPORTED');
      assert.equal(cap.reachesUpstream, false);
    });

    it('classifies TRELLIS.2 as UNSUPPORTED', () => {
      const cap = getNativeTargetCapability('trellis2_image_to_raw_mesh');
      assert.equal(cap.capability, 'UNSUPPORTED');
      assert.equal(cap.reachesUpstream, false);
    });

    it('classifies Pixal3D as NATIVE_INDIRECT_CONTROL', () => {
      const cap = getNativeTargetCapability('pixal3d_image_to_raw_mesh');
      assert.equal(cap.capability, 'NATIVE_INDIRECT_CONTROL');
      assert.equal(cap.reachesUpstream, true);
    });

    it('classifies TaoFlowForge as UNVERIFIED (target_num_vertices unwired)', () => {
      const cap = getNativeTargetCapability('taoflowforge_image_to_raw_mesh');
      assert.equal(cap.capability, 'UNVERIFIED');
      assert.equal(cap.reachesUpstream, false);
    });

    it('classifies unknown model as UNVERIFIED', () => {
      const cap = getNativeTargetCapability('nonexistent_model');
      assert.equal(cap.capability, 'UNVERIFIED');
      assert.equal(cap.reachesUpstream, false);
    });

    it('passes native parameter into model_parameters via buildGenerationParameters', () => {
      const settings: GenerationSettings = {
        ...baseSettings,
        aiModel: 'stable_fast_3d_image_to_textured_mesh',
        polycount: 100000,
        enablePostprocess: false,
        generateTexture: false,
      };
      const result = buildGenerationParameters(settings, { supports_texture: true });
      assert.equal(result.nativeTargetMapping.capability, 'NATIVE_INDIRECT_CONTROL');
      assert.equal(result.modelParameters.vertex_count, 50000); // 100000 / 2
    });

    it('passes TripoSG faces parameter into model_parameters', () => {
      const settings: GenerationSettings = {
        ...baseSettings,
        aiModel: 'triposg_image_to_raw_mesh',
        polycount: 200000,
        enablePostprocess: false,
      };
      const result = buildGenerationParameters(settings);
      assert.equal(result.nativeTargetMapping.capability, 'NATIVE_MAX_LIMIT');
      assert.equal(result.modelParameters.faces, 200000);
    });

    it('passes Pixal3D pipeline_type string into model_parameters', () => {
      const settings: GenerationSettings = {
        ...baseSettings,
        aiModel: 'pixal3d_image_to_raw_mesh',
        polycount: 150000,
        enablePostprocess: false,
      };
      const result = buildGenerationParameters(settings);
      assert.equal(result.nativeTargetMapping.capability, 'NATIVE_INDIRECT_CONTROL');
      assert.equal(result.modelParameters.pipeline_type, '1536_cascade');
    });
  });
});
