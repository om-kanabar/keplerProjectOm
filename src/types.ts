export type RuntimeAttributes = Record<string, unknown>;

export type BlueprintReference = Record<string, unknown>;

export type StarterModulePayload = {
  id: string;
  blueprintId: string;
  displayName: string;
  connectedTo: string[];
  runtimeAttributes: RuntimeAttributes;
  capabilities: string[];
};

export type HabitatModule = StarterModulePayload & {
  source: "starter" | "local";
};

export type KeplerRegistration = {
  habitatUuid: string;
  habitatId: string;
  displayName: string;
  habitatSlug?: string;
  catalogVersion?: string;
  status?: string;
  lastSeenAt?: string | null;
  blueprints?: BlueprintReference[];
};

export type HabitatData = Record<string, unknown> & {
  keplerRegistration?: KeplerRegistration;
  modules?: HabitatModule[];
};
