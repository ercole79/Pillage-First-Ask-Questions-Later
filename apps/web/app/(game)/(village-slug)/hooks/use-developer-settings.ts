import { useSuspenseQuery } from '@tanstack/react-query';
import { use } from 'react';
import type { DeveloperSettings } from '@pillage-first/types/models/developer-settings';
import { developerSettingsCacheKey } from 'app/(game)/constants/query-keys';
import { ApiContext } from 'app/(game)/providers/api-context';

/** All toggles off — matches offline seeder defaults and online policy (dev tools offline-only). */
export const disabledDeveloperSettings: DeveloperSettings = {
  isInstantBuildingConstructionEnabled: false,
  isInstantUnitTrainingEnabled: false,
  isInstantUnitImprovementEnabled: false,
  isInstantUnitResearchEnabled: false,
  isInstantUnitTravelEnabled: false,
  isFreeBuildingConstructionEnabled: false,
  isFreeUnitTrainingEnabled: false,
  isFreeUnitImprovementEnabled: false,
  isFreeUnitResearchEnabled: false,
  isFreeHuntingPartiesEnabled: false,
  isInstantHeroReviveEnabled: false,
  isFreeCelebrationsEnabled: false,
  isInstantCelebrationsEnabled: false,
  isFreeHeroReviveEnabled: false,
};

export const useDeveloperSettings = () => {
  const { apiClient, mode } = use(ApiContext);

  const { data: developerSettings } = useSuspenseQuery({
    queryKey: [developerSettingsCacheKey, mode],
    queryFn: async () => {
      // Game-server rejects /developer-settings (offline-only). Village fields
      // call this via useBuildingConstructionStatus on every resources bootstrap.
      if (mode === 'remote') {
        return disabledDeveloperSettings;
      }

      const { data } = await apiClient.get('/developer-settings');

      return data;
    },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });

  return {
    developerSettings,
  };
};
