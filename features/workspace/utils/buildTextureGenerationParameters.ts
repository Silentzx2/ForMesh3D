import type { TextureSettings } from '../types';

type TextureResolution = TextureSettings['resolution'];

export interface TextureGenerationRequestInput {
  modelId?: string | null;
  resolution?: TextureResolution;
  prompt?: string | null;
  referenceImage?: string | null;
  referenceImageFileId?: string | null;
}

export interface TextureMeshReference {
  mesh_file_id?: string;
  mesh_path?: string;
}

export interface TextureGenerationRequest {
  endpoint: string;
  modelPreference: string;
  body: Record<string, unknown>;
}

const TEXTURE_ENDPOINT = '/api/v1/texture';

function resolutionInPixels(resolution: TextureResolution): number {
  return {
    '1K': 1024,
    '2K': 2048,
    '4K': 4096,
    '8K': 8192,
  }[resolution];
}

function imageBase64WithoutDataUrl(image: string): string {
  const separator = image.indexOf(',');
  return separator >= 0 ? image.slice(separator + 1) : image;
}

/**
 * Serialize the supported image-mesh-painting contract.
 * Model-native inference settings belong to the backend adapter, not this request.
 */
export function buildTextureGenerationParameters(
  settings: TextureGenerationRequestInput,
  meshReference: TextureMeshReference,
  sourceReference?: { url?: string | null; fileId?: string | null },
): TextureGenerationRequest {
  const resolution = settings.resolution || '2K';
  const referenceImage = settings.referenceImage || sourceReference?.url;
  const referenceFileId = settings.referenceImageFileId || sourceReference?.fileId;
  const prompt = settings.prompt?.trim() || '';
  const hasImageReference = Boolean(referenceImage || referenceFileId);
  const modelPreference = settings.modelId || (
    hasImageReference
      ? 'hunyuan3d_paint_v21_image_mesh_painting'
      : 'trellis_text_mesh_painting'
  );

  if (!hasImageReference && !prompt) {
    throw new Error('Provide a texture reference image or a text prompt.');
  }

  const body: Record<string, unknown> = {
    texture_resolution: resolutionInPixels(resolution),
    texture_resolution_preset: resolution,
    output_format: 'glb',
    model_preference: modelPreference,
    enable_postprocess: false,
    postprocess_mode: 'manual_mesh_tool',
    ...meshReference,
  };

  if (referenceFileId) {
    body.image_file_id = referenceFileId;
  } else if (referenceImage?.startsWith('data:')) {
    body.image_base64 = imageBase64WithoutDataUrl(referenceImage);
  } else if (referenceImage) {
    body.image_path = referenceImage;
  }

  if (prompt) {
    body.text_prompt = prompt;
  }

  return { endpoint: TEXTURE_ENDPOINT, modelPreference, body };
}
