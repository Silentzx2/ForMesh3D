import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildTextureGenerationParameters } from './buildTextureGenerationParameters';

describe('buildTextureGenerationParameters', () => {
  it('uses the canonical texture endpoint for image-guided painting', () => {
    const result = buildTextureGenerationParameters(
      { resolution: '4K', prompt: 'weathered copper' },
      { mesh_file_id: 'ast_123456789abc' },
      { fileId: 'img_123456789abc' },
    );

    assert.equal(result.endpoint, '/api/v1/texture');
    assert.equal(result.modelPreference, 'hunyuan3d_paint_v21_image_mesh_painting');
    assert.equal(result.body.image_file_id, 'img_123456789abc');
    assert.equal(result.body.mesh_file_id, 'ast_123456789abc');
    assert.equal(result.body.texture_resolution, 4096);
    assert.equal(result.body.text_prompt, 'weathered copper');
  });

  it('routes prompt-only painting to the registered text-painting model', () => {
    const result = buildTextureGenerationParameters(
      { prompt: 'weathered copper' },
      { mesh_file_id: 'ast_123456789abc' },
    );

    assert.equal(result.endpoint, '/api/v1/texture');
    assert.equal(result.modelPreference, 'trellis_text_mesh_painting');
    assert.equal(result.body.model_preference, 'trellis_text_mesh_painting');
    assert.equal(result.body.text_prompt, 'weathered copper');
    assert.equal('image_file_id' in result.body, false);
  });

  it('rejects requests without either an image reference or a prompt', () => {
    assert.throws(
      () => buildTextureGenerationParameters(
        {},
        { mesh_file_id: 'ast_123456789abc' },
      ),
      /reference image or a text prompt/,
    );
  });
});

  it('routes TripoSR Paint with both existing mesh and reference image', () => {
    const result = buildTextureGenerationParameters(
      { modelId: 'triposr_image_mesh_painting', resolution: '2K' },
      { mesh_file_id: 'ast_mesh_123456789abc' },
      { fileId: 'img_reference_123456789abc' },
    );
    assert.equal(result.endpoint, '/api/v1/texture');
    assert.equal(result.modelPreference, 'triposr_image_mesh_painting');
    assert.equal(result.body.mesh_file_id, 'ast_mesh_123456789abc');
    assert.equal(result.body.image_file_id, 'img_reference_123456789abc');
    assert.equal(result.body.texture_resolution, 2048);
  });
