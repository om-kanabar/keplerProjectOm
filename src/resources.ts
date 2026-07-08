import { fetchKeplerResourceCatalog } from "./kepler";
import { ResourceReference } from "./types";

export async function listResources(): Promise<ResourceReference[]> {
  return fetchKeplerResourceCatalog();
}
