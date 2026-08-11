import type { StudyCatalog } from "@/modules/study-catalog/ports/study-catalog";
import { DemoStudyCatalog } from "@/modules/study-catalog/infrastructure/demo-study-catalog";

/**
 * Server-only composition root for the study catalog.
 *
 * Pages and route handlers resolve the catalog here instead of constructing an
 * adapter locally, so that a later milestone can swap the demo implementation
 * for a persistent one in a single place. This is explicit construction, not a
 * dependency-injection framework.
 */
const studyCatalog: StudyCatalog = new DemoStudyCatalog();

export function getStudyCatalog(): StudyCatalog {
  return studyCatalog;
}
