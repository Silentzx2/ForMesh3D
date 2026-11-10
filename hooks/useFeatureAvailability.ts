import { useState, useEffect, useCallback } from 'react';
import { getApiClient } from '@/services/apiClient';
import { FeatureInfo, AvailableModels, ModelRuntimeDetails } from '@/types/api';

export interface FeatureAvailability {
  [featureName: string]: {
    available: boolean;
    models: string[];
    error?: string;
  };
}

export interface UseFeatureAvailabilityReturn {
  features: FeatureAvailability;
  modelDetails: Record<string, ModelRuntimeDetails>;
  weightsStatus: Record<string, boolean>;
  loading: boolean;
  error: string | null;
  checkFeature: (featureName: string) => boolean;
  getModelsForFeature: (featureName: string) => string[];
  refetch: () => Promise<void>;
}

const FEATURE_NAME_MAPPING: Record<string, string> = {
  'image-to-mesh': 'image_to_mesh', 
  'image-to-raw-mesh': 'image_to_raw_mesh',
  'image-to-textured-mesh': 'image_to_textured_mesh',
  'mesh-painting': 'mesh_painting',
  'text-mesh-painting': 'text_mesh_painting',
  'image-mesh-painting': 'image_mesh_painting',
  'mesh-segmentation': 'mesh_segmentation',
  'auto-rigging': 'auto_rig',
  'auto_rig': 'auto_rig',
  'auto_rigging': 'auto_rig',
  'motion-generation': 'motion_generation',
  'motion_generation': 'motion_generation',
  'animation': 'motion_generation',
  'part-completion': 'part_completion', 
  'text-mesh-editing': 'text_mesh_editing', 
  'image-mesh-editing': 'image_mesh_editing'
};

export const useFeatureAvailability = (): UseFeatureAvailabilityReturn => {
  const [features, setFeatures] = useState<FeatureAvailability>({});
  const [modelDetails, setModelDetails] = useState<Record<string, ModelRuntimeDetails>>({});
  const [weightsStatus, setWeightsStatus] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchFeatureAvailability = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const apiClient = getApiClient();
      
      // Get available features and models in parallel
      const [featuresResponse, modelsResponse] = await Promise.all([
        apiClient.getAvailableFeatures(),
        apiClient.getAvailableModels()
      ]);

      // Build feature availability map
      const featureAvailability: FeatureAvailability = {};

      // Initialize all known features as unavailable
      Object.keys(FEATURE_NAME_MAPPING).forEach(key => {
        featureAvailability[key] = {
          available: false,
          models: [],
          error: 'Feature not available'
        };
      });

      // Update with actual available features
      if (featuresResponse.features) {
        featuresResponse.features.forEach((feature: FeatureInfo) => {
          // Find the UI feature name that maps to this API feature
          const uiFeatureNames = Object.keys(FEATURE_NAME_MAPPING).filter(
            key => FEATURE_NAME_MAPPING[key] === feature.name
          );

          uiFeatureNames.forEach(uiFeatureName => {
            featureAvailability[uiFeatureName] = {
              available: feature.model_count > 0,
              models: feature.models || [],
              error: feature.model_count === 0 ? 'No models available for this feature' : undefined
            };
          });
        });
      }

      // Also check models response for additional feature info
      if (modelsResponse.available_models) {
        Object.entries(modelsResponse.available_models).forEach(([apiFeatureName, models]) => {
          const uiFeatureNames = Object.keys(FEATURE_NAME_MAPPING).filter(
            key => FEATURE_NAME_MAPPING[key] === apiFeatureName
          );

          // Populate under both raw API name (image_to_raw_mesh) and UI hyphenated names (image-to-raw-mesh)
          const allFeatureKeys = Array.from(new Set([apiFeatureName, ...uiFeatureNames]));
          if (Array.isArray(models)) {
            allFeatureKeys.forEach(key => {
              const existing = featureAvailability[key] || { available: false, models: [] };
              const mergedModels = Array.from(new Set([...existing.models, ...models]));
              featureAvailability[key] = {
                available: mergedModels.length > 0,
                models: mergedModels,
                error: mergedModels.length === 0 ? 'No models available for this feature' : undefined
              };
            });
          }
        });
      }

      setFeatures(featureAvailability);
      setModelDetails(modelsResponse.model_details || {});
      setWeightsStatus(modelsResponse.weights_status || {});
      console.log('[FeatureAvailability] Loaded features:', featureAvailability);

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to check feature availability';
      setError(errorMessage);
      console.error('[FeatureAvailability] Error:', err);
      
      // Set all features as unavailable with error
      const errorFeatures: FeatureAvailability = {};
      Object.keys(FEATURE_NAME_MAPPING).forEach(key => {
        errorFeatures[key] = {
          available: false,
          models: [],
          error: errorMessage
        };
      });
      setFeatures(errorFeatures);
    } finally {
      setLoading(false);
    }
  }, []);

  const checkFeature = useCallback((featureName: string): boolean => {
    return features[featureName]?.available ||
      features[featureName.replace(/-/g, '_')]?.available ||
      features[featureName.replace(/_/g, '-')]?.available ||
      false;
  }, [features]);

  const getModelsForFeature = useCallback((featureName: string): string[] => {
    return features[featureName]?.models ||
      features[featureName.replace(/-/g, '_')]?.models ||
      features[featureName.replace(/_/g, '-')]?.models ||
      [];
  }, [features]);

  const refetch = useCallback(async () => {
    await fetchFeatureAvailability();
  }, [fetchFeatureAvailability]);

  useEffect(() => {
    fetchFeatureAvailability();
  }, [fetchFeatureAvailability]);

  return {
    features,
    modelDetails,
    weightsStatus,
    loading,
    error,
    checkFeature,
    getModelsForFeature,
    refetch
  };
}; 