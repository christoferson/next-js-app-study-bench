"use server";

import { revalidatePath } from "next/cache";
import { isDomainError } from "@/shared/domain-error";
import { parseInput } from "@/shared/parse-input";
import type { FormState } from "@/shared/ui/form-state";
import { IDLE_FORM_STATE, toInvalidFormState } from "@/shared/ui/form-state";
import { getAudioFacade } from "@/modules/audio/composition";
import type { SpeechRequestFormInput } from "@/modules/audio/application/schemas";
import {
  audioAssetSchema,
  speechRequestSchema,
} from "@/modules/audio/application/schemas";
import type { AudioClipPlayback } from "@/modules/audio/domain/speech-clip";
import { audioSourcePath } from "@/modules/audio/domain/speech-clip";

/**
 * Server Actions for audio.
 *
 * Each action reads the form, parses it with the authoritative schema, calls the
 * facade, and maps a domain error back to field messages. The cache decision, the key,
 * the voice, the storage layout, and the provider all belong to the facade and the
 * domain; nothing here decides them, and nothing here talks to Polly.
 *
 * Synthesis is an *action* rather than a route handler on purpose:
 * `spec/ARCHITECTURE.md` section 6.2 forbids Polly orchestration in a route handler,
 * and a GET that spends money would be triggerable by a prefetch or a refresh. The
 * playback route stays a route handler because it only reads bytes that already exist.
 *
 * **Why no redirect.** Every other module's create action redirects to what it made.
 * These return a value instead, so the page the owner is on stays where it is: pressing
 * play mid-review must not navigate away from the card being studied.
 *
 * `playAudioClipAction` returns the source to play rather than revalidating the page it
 * was called from, and that is the fix for the two-step control this feature shipped
 * with. A revalidation would re-render the card so a player could appear, which is a
 * round trip and a second gesture before anything is heard — and on mobile the second
 * gesture is the one that no longer counts as user activation. The action answers with a
 * URL, the button plays it, and the page does not move.
 */

function readString(form: FormData, field: string): string {
  const value = form.get(field);

  return typeof value === "string" ? value : "";
}

/**
 * Revalidates the page the control was pressed on.
 *
 * The path is submitted by the form rather than inferred, because the same control is
 * rendered on the card page, the review screen, the session screen, and the question
 * page, and each needs its own server render to pick up the new asset. It is used only
 * as a revalidation target — never as a redirect destination and never rendered — so a
 * tampered value can at most cause a needless cache invalidation of a path in this
 * application.
 */
function revalidateOrigin(form: FormData): void {
  const path = readString(form, "revalidatePath");

  if (path.startsWith("/")) {
    revalidatePath(path);
  }

  // The owner's audio list always changes when a clip is created or removed.
  revalidatePath("/settings/audio");
}

/**
 * The source for one clip, synthesizing it only if it does not exist yet.
 *
 * What the play button calls, and the whole of what a study screen needs: a URL to play
 * or the fact that there is none. It costs at most one Polly call, and only when nothing
 * is cached for exactly this text, language, voice, engine, and rate — pressing play
 * twice bills once, which the facade enforces rather than this action.
 *
 * **Arguments rather than a `FormData`**, because there is no form: the control is a
 * button that calls this and then plays what comes back. The values are still external
 * input and still parsed by the authoritative schema, since a submitted argument is
 * whatever was sent, not whatever was rendered.
 *
 * **A failure is `unavailable` and nothing else.** Every domain error here — an
 * unreachable provider, credentials without `polly:SynthesizeSpeech`, a voice that does
 * not support the engine, text too long — becomes the same one-word answer, so a study
 * screen can say "Audio unavailable" without ever putting a variable name, a provider,
 * or an AWS concept in front of the owner mid-card. `/settings/audio` is where a
 * configuration problem is explained, and the errors themselves already carry no
 * credential or provider text (`spec/SECURITY.md`).
 *
 * Nothing is logged. The audio module logs nothing at all, asserted in
 * `module-boundaries.test.ts`, because a speech request carries the text of a card and
 * the cheapest way to guarantee content never reaches a log is to write none.
 */
export async function playAudioClipAction(
  input: SpeechRequestFormInput,
): Promise<AudioClipPlayback> {
  try {
    const parsed = parseInput(speechRequestSchema, {
      text: input?.text ?? "",
      language: input?.language ?? "",
      rate: input?.rate ?? "",
    });

    const outcome = await getAudioFacade().synthesize(parsed);

    if (!outcome.cached) {
      // A clip that was just paid for belongs in the owner's audio list straight away.
      // The page the button is on needs no revalidation: it renders no player, and the
      // control holds the source it was given.
      revalidatePath("/settings/audio");
    }

    return { status: "ready", src: audioSourcePath(outcome.asset.id) };
  } catch (error) {
    if (isDomainError(error)) {
      return { status: "unavailable" };
    }
    throw error;
  }
}

/**
 * Deletes one stored clip and its file.
 *
 * The counterpart of generation, and the reason it exists: an asset is keyed by what
 * was spoken rather than by the card that said it, so deleting a card cannot delete
 * its audio (`SPEC.md` section 28.3, "audio assets can be deleted"). Regenerating is
 * one call, so nothing is lost that cannot be recreated.
 */
export async function deleteAudioAction(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  try {
    const input = parseInput(audioAssetSchema, {
      assetId: readString(form, "assetId"),
    });

    await getAudioFacade().delete(input.assetId);
  } catch (error) {
    if (isDomainError(error)) {
      return toInvalidFormState(error, form);
    }
    throw error;
  }

  revalidateOrigin(form);

  return IDLE_FORM_STATE;
}
