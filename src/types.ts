export type KeplerRegistration = {
  habitatUuid: string;
  habitatId: string;
  displayName: string;
  habitatSlug?: string;
  catalogVersion?: string;
  status?: string;
  lastSeenAt?: string | null;
  starterModules?: unknown[];
  blueprints?: unknown[];
};

export type HabitatData = {
  keplerRegistration?: KeplerRegistration;
};
