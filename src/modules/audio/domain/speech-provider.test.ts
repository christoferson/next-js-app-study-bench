import { describe, expect, it } from "vitest";
import { FAKE_SPEECH_PROVIDER, isFakeSpeechProvider } from "./speech-provider";

/**
 * The predicate the whole "no silent trap" behaviour hangs off.
 *
 * It decides whether a study screen offers pronunciation at all, so it has to be exact:
 * treating `polly` as the placeholder would hide a working feature, and treating anything
 * unrecognised as real is what put silent clips in front of the owner in the first place.
 */
describe("isFakeSpeechProvider", () => {
  it("recognises the placeholder provider", () => {
    expect(isFakeSpeechProvider(FAKE_SPEECH_PROVIDER)).toBe(true);
    expect(FAKE_SPEECH_PROVIDER).toBe("fake");
  });

  it("does not recognise a real one", () => {
    expect(isFakeSpeechProvider("polly")).toBe(false);
  });

  it.each(["Fake", "FAKE", " fake", "fake-polly", ""])(
    "does not treat %j as the placeholder",
    (provider) => {
      // The value is compared exactly, because it also arrives from a stored asset row.
      // A near-match must not be read as "this is placeholder audio".
      expect(isFakeSpeechProvider(provider)).toBe(false);
    },
  );
});
