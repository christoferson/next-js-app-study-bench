import { isFakeModelProvider } from "@/modules/ai-generation/domain/generation-run";

interface FakeProviderNoticeProps {
  /** The provider name — the composed gateway's, or the one a run recorded. */
  readonly provider: string;
  /**
   * What the notice is about.
   *
   * `"upcoming"` warns before a batch is requested; `"past"` explains output that has
   * already been produced. The distinction matters because the second is a fact about
   * a stored run that no amount of reconfiguring will change.
   */
  readonly subject: "upcoming" | "past";
}

/**
 * Says when generated content is placeholder text rather than a model's work.
 *
 * `fake` is the default provider, so a fresh clone generates deterministic filler —
 * and the whole flow works so convincingly that there is nothing on screen to say the
 * content is invented. The provenance block naming the provider is not enough: it
 * reads as configuration detail, and the owner has no reason to know that `fake` means
 * "not real".
 *
 * Rendered only when the provider is the fake one. There is no reassuring counterpart
 * for Bedrock: a notice on every screen that said "this is real" would be noise, and
 * absence of a warning is the normal state.
 *
 * `role="status"` rather than `role="alert"`: it is a standing condition of the page,
 * not an interruption, and on the generate page it is present before the owner does
 * anything.
 *
 * Only the provider name reaches this component. No credential, profile, account, or
 * region is passed to or rendered by any screen (`spec/SECURITY.md`).
 */
export function FakeProviderNotice({
  provider,
  subject,
}: FakeProviderNoticeProps) {
  if (!isFakeModelProvider(provider)) {
    return null;
  }

  return (
    <p className="empty-state" role="status">
      <span className="badge">Test provider</span>{" "}
      {subject === "upcoming"
        ? "Using the built-in test provider — generated output is deterministic placeholder content."
        : "This run used the fake test provider, so everything it wrote is deterministic placeholder content rather than a model's work."}{" "}
      Set <code>LANGUAGE_MODEL_PROVIDER=bedrock</code> in{" "}
      <code>.env.local</code> for real AI generation.
    </p>
  );
}
