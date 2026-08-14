import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FakeProviderNotice } from "./fake-provider-notice";

/**
 * The warning that generated content is placeholder text.
 *
 * Both states matter equally: it has to appear on the default configuration, which is
 * the case the owner hits without knowing it, and it has to be absent for a real
 * provider, because a warning that is always on screen stops being read.
 */
describe("FakeProviderNotice", () => {
  it("warns before a batch that the built-in test provider is in use", () => {
    render(<FakeProviderNotice provider="fake" subject="upcoming" />);

    expect(screen.getByText(/using the built-in test provider/i)).toBeVisible();
  });

  it("says how to switch to real generation", () => {
    render(<FakeProviderNotice provider="fake" subject="upcoming" />);

    // The variable and the file, because "configure a provider" is not actionable
    // without both.
    expect(
      screen.getByText("LANGUAGE_MODEL_PROVIDER=bedrock"),
    ).toBeInTheDocument();
    expect(screen.getByText(".env.local")).toBeInTheDocument();
  });

  it("speaks about a finished run in the past tense", () => {
    render(<FakeProviderNotice provider="fake" subject="past" />);

    // A stored run cannot be un-faked by reconfiguring, so it says what this run was
    // rather than what the next one will be.
    expect(
      screen.getByText(/this run used the fake test provider/i),
    ).toBeVisible();
    expect(screen.queryByText(/using the built-in test provider/i)).toBeNull();
  });

  it("is announced as a standing condition rather than an interruption", () => {
    render(<FakeProviderNotice provider="fake" subject="upcoming" />);

    expect(screen.getByRole("status")).toBeVisible();
  });

  it("renders nothing at all for a real provider", () => {
    const { container } = render(
      <FakeProviderNotice provider="bedrock" subject="upcoming" />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a real provider on a past run either", () => {
    const { container } = render(
      <FakeProviderNotice provider="bedrock" subject="past" />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
