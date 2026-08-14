import { z } from "zod";
import { enumOf, requiredText } from "@/shared/schema-fields";
import {
  MAX_SPEECH_TEXT_LENGTH,
  SPEECH_LANGUAGES,
  SPEECH_RATES,
} from "@/modules/audio/domain/speech-request";

/**
 * Authoritative input schemas for audio (`spec/CODING-STANDARDS.md` section 2).
 *
 * The interesting field is `text`. It arrives from a form, which makes it external
 * input even though the form was rendered from the owner's own card: a submitted field
 * is whatever was posted, not whatever was displayed. So it is bounded here, before
 * anything is billed for it — without a limit a crafted post could ask Polly to read a
 * megabyte of text, and Polly bills per character.
 *
 * The bound is all this can check, and that is deliberate. Nothing verifies that the
 * text belongs to a card the owner has, because there is nothing to verify against: an
 * asset is keyed by what was spoken rather than by an entity, and this is a
 * single-user application with no other owner's content to reach. The worst a crafted
 * post can do is cache a clip of its own text, which is bounded, listed on the audio
 * page, and deletable.
 */

const ID_LIMIT = 200;

export const speechLanguageSchema = enumOf(
  SPEECH_LANGUAGES,
  "That is not a language StudyBench can speak.",
);

export const speechRateSchema = enumOf(
  SPEECH_RATES,
  "That is not a speaking rate.",
);

/**
 * Text to read aloud.
 *
 * The limit is the domain's, so the schema and the facade agree about what one clip
 * may be; the facade re-checks it because a caller that is not a form still must not
 * be able to send an unbounded request.
 */
export const speechTextSchema = requiredText(
  "Text to read aloud",
  MAX_SPEECH_TEXT_LENGTH,
);

/** Generating audio: what to say, in which language, at what pace. */
export const speechRequestSchema = z.object({
  text: speechTextSchema,
  language: speechLanguageSchema,
  rate: speechRateSchema,
});

export type SpeechRequestFormInput = z.output<typeof speechRequestSchema>;

/** Removing one stored clip. */
export const audioAssetSchema = z.object({
  assetId: requiredText("An audio clip", ID_LIMIT),
});

export type AudioAssetInput = z.output<typeof audioAssetSchema>;
