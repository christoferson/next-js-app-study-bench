import { getPersonaFacade } from "@/modules/ai-generation/composition";
import {
  personaExportFilename,
  toPersonaEnvelope,
} from "@/modules/ai-generation/domain/persona-export";

interface PersonaExportRouteContext {
  readonly params: Promise<{ readonly personaId: string }>;
}

/**
 * Downloads one persona as a JSON file.
 *
 * A route handler rather than a Server Action, because the response *is* a file: an
 * action returns state to a form, and what is wanted here is a `Content-Disposition`
 * attachment the browser saves. Colocated with the edit page it is linked from rather
 * than under `/api`, because it is a page-level document download rather than a
 * machine endpoint the way `/api/audio/[assetId]` is.
 *
 * **The identifier is a lookup key, never a path**, the same as the audio route: an
 * unknown id is a 404 with an empty body, and the filename comes from the *row* — from
 * `personaKey`, filtered again in `personaExportFilename` — so nothing from the request
 * reaches the header.
 *
 * **No secrets are involved and nothing is cached.** A persona is prose the owner wrote;
 * it holds no credential, no model identifier, and no account detail. `no-store` because
 * an export must reflect the current version — a cached download after an edit would hand
 * the owner a stale file that looks authoritative.
 */
export async function GET(
  _request: Request,
  context: PersonaExportRouteContext,
): Promise<Response> {
  const { personaId } = await context.params;
  const persona = await getPersonaFacade().findPersona(personaId);

  if (persona === null) {
    return new Response(null, {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

  // Indented, because this file is meant to be read and edited by hand as well as
  // re-imported: it doubles as a shareable persona template.
  const body = `${JSON.stringify(toPersonaEnvelope(persona), null, 2)}\n`;

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${personaExportFilename(persona.personaKey)}"`,
      "Cache-Control": "no-store",
    },
  });
}
