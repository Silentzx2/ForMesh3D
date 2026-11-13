import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGenerationParameters,
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

  it('passes target_polycount (up to 600K) and topology_mode when enablePostprocess is true', () => {
    const settings: GenerationSettings = {
      ...baseSettings,
      enablePostprocess: true,
      polycount: 600000,
      topologyMode: 'quad',
      quadTopology: true,
    };

    const result = buildGenerationParameters(settings);

    assert.equal(result.body.enable_postprocess, true);
    assert.equal(result.body.target_polycount, 600000);
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

  it('clamps native_target_polycount to 600K maximum', () => {
    const settings: GenerationSettings = {
      ...baseSettings,
      enablePostprocess: false,
      polycount: 2000000,
    };

    const result = buildGenerationParameters(settings);

    assert.equal(result.body.native_target_polycount, 600000);
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
});
