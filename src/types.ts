export type Zone = {
  id: string;
  name: string;
  purpose: string;
  status: string;
};

export type Door = {
  id: string;
  name: string;
  status: string;
  locked: boolean;
};

export type Airlock = {
  id: string;
  name: string;
  pressureLevel: string;
  locked: boolean;
  doorNames: string[];
};

export type MapObjectType = "zone" | "door" | "airlock";

export type MapPlacement = {
  objectType: MapObjectType;
  name: string;
  x: number;
  y: number;
};

export type HabitatData = {
  zones: Zone[];
  doors: Door[];
  airlocks: Airlock[];
  mapPlacements: MapPlacement[];
};
