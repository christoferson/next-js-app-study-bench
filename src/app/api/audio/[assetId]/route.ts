import { getAudioFacade } from "@/modules/audio/composition";

interface AudioRouteContext {
  readonly params: Promise<{ readonly assetId: string }>;
}

/**
 * Serves one cached audio clip.
 *
 * A route handler rather than a file served from `public/`, because the bytes live
 * outside the deployed bundle: they are written at runtime into object storage, and
 * in D13 that storage is S3 rather than a directory the web server can see.
 *
 * **The identifier is a lookup key, never a path.** The request supplies an asset id;
 * the *row* supplies the object key, and the storage adapter refuses any key that is
 * not a plain relative path under its root. So the two things an attacker would need
 * — a path they control and an adapter that would follow it — are both absent, and
 * `local-file-object-storage.test.ts` holds the traversal cases that keep the second
 * true. An unknown id is a 404 with no body, which says nothing about what does
 * exist.
 *
 * **Caching.** `immutable` with a long max-age, and it is honest: an asset's identity
 * is a hash of what was spoken and how, so the bytes at one id can never change. That
 * makes a replayed clip free — the browser never asks again — which matters on a
 * phone reviewing a hundred cards. `private` because this is one owner's study
 * material and no shared cache should hold it.
 *
 * Range requests are deliberately not implemented. These are clips of a word or a
 * sentence, a few kilobytes each, and every browser plays them from a single
 * response; a `Range` header is answered with the whole body, which is a valid
 * response for a server that does not advertise `Accept-Ranges`. Streaming a long
 * recording is what D13's S3 adapter and a redirect would be for.
 */
export async function GET(
  _request: Request,
  context: AudioRouteContext,
): Promise<Response> {
  const { assetId } = await context.params;
  const found = await getAudioFacade().readBytes(assetId);

  if (found === null) {
    return new Response(null, {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

  // A fresh copy of the bytes, so the response body owns a buffer that nothing else
  // holds a view onto. `BodyInit` accepts an `ArrayBuffer`, and slicing is what makes
  // the exact byte range explicit rather than depending on the view's offset.
  const body = found.bytes.slice().buffer as ArrayBuffer;

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": found.asset.contentType,
      "Content-Length": String(found.asset.byteSize),
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
