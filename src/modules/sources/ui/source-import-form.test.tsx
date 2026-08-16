import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { isDomainError } from "@/shared/domain-error";
import { parseInput } from "@/shared/parse-input";
import type { FormState } from "@/shared/ui/form-state";
import { IDLE_FORM_STATE, toInvalidFormState } from "@/shared/ui/form-state";
import {
  MAX_PASTED_CHARS,
  MAX_SOURCE_FILE_BYTES,
  MAX_SOURCE_TITLE_CHARS,
  importFileSourceSchema,
  importPastedSourceSchema,
  importUrlSourceSchema,
} from "@/modules/sources/application/schemas";
import {
  SourceEmptyError,
  SourceUrlRejectedError,
} from "@/modules/sources/domain/errors";
import { SOURCE_AUTHORITIES } from "@/modules/sources/domain/source";
import type { SourceImportKind } from "./source-import-form";
import { SourceImportForm } from "./source-import-form";
import { describeSourceAuthority } from "./source-badges";

/**
 * The one import form, rendered once per route it offers.
 *
 * Every test drives it through the real schema for its kind, the way
 * `objective-import-form.test.tsx` does: the action here parses exactly the fields the
 * Server Action parses, so "a blank title is refused" is asserted against the rule that
 * actually refuses it rather than against a message copied into the test. The three kinds
 * are one component, so what each block is really checking is that parameterising by kind
 * did not make the shared half — title, authority, the hidden slug — behave differently
 * depending on which route the owner used.
 *
 * The file's bytes are asserted on the input rather than in the submitted `FormData`,
 * because jsdom copies a file entry as an empty blob; the same limitation the objective
 * import documents.
 */

const SUBMIT_LABELS: Readonly<Record<SourceImportKind, string>> = {
  PASTE: "Import pasted text",
  FILE: "Import file",
  URL: "Fetch and import",
};

const KINDS = ["PASTE", "FILE", "URL"] as const;

type ParsedInput = Readonly<Record<string, unknown>>;

/** The fields the matching Server Action reads, for one kind. */
function readFields(kind: SourceImportKind, form: FormData): ParsedInput {
  const text = (field: string): string => String(form.get(field) ?? "");

  if (kind === "PASTE") {
    return parseInput(importPastedSourceSchema, {
      title: text("title"),
      authority: text("authority"),
      text: text("text"),
      isMarkdown: text("isMarkdown"),
    });
  }

  if (kind === "URL") {
    return parseInput(importUrlSourceSchema, {
      title: text("title"),
      authority: text("authority"),
      url: text("url"),
    });
  }

  return parseInput(importFileSourceSchema, {
    title: text("title"),
    authority: text("authority"),
  });
}

function validatingAction(
  kind: SourceImportKind,
  onValid: (input: ParsedInput, form: FormData) => void = () => undefined,
) {
  return async (_state: FormState, form: FormData): Promise<FormState> => {
    try {
      onValid(readFields(kind, form), form);
    } catch (error) {
      if (isDomainError(error)) {
        return toInvalidFormState(error, form);
      }
      throw error;
    }

    return IDLE_FORM_STATE;
  };
}

function renderForm(
  kind: SourceImportKind,
  options: {
    readonly action?: (state: FormState, form: FormData) => Promise<FormState>;
    readonly slug?: string;
  } = {},
): void {
  render(
    <SourceImportForm
      action={options.action ?? validatingAction(kind)}
      kind={kind}
      slug={options.slug ?? "demo-track"}
      maxCharacters={MAX_PASTED_CHARS}
      maxFileBytes={MAX_SOURCE_FILE_BYTES}
    />,
  );
}

function submit(
  user: ReturnType<typeof userEvent.setup>,
  kind: SourceImportKind,
): Promise<void> {
  return user.click(screen.getByRole("button", { name: SUBMIT_LABELS[kind] }));
}

describe("SourceImportForm", () => {
  describe("what every kind shares", () => {
    it.each(KINDS)("carries the track it is importing into (%s)", (kind) => {
      // A hidden field rather than a closure over the slug, because the action is a
      // Server Action: it receives a `FormData` and nothing else.
      renderForm(kind, { slug: "aws-saa" });

      const slug = document.querySelector('input[name="slug"]');

      expect(slug).toHaveAttribute("type", "hidden");
      expect(slug).toHaveValue("aws-saa");
    });

    it.each(KINDS)("offers every authority, in words (%s)", (kind) => {
      // Owner-chosen and never inferred, so all five have to be reachable — including
      // "Unknown authority", which is the honest answer often enough to matter.
      renderForm(kind);

      const select = screen.getByLabelText("Authority");
      const options = [...select.querySelectorAll("option")];

      expect(options.map((option) => option.value)).toEqual([
        ...SOURCE_AUTHORITIES,
      ]);
      expect(options.map((option) => option.textContent)).toEqual(
        SOURCE_AUTHORITIES.map((authority) =>
          describeSourceAuthority(authority),
        ),
      );
      expect(select).toHaveValue("OFFICIAL");
    });

    it.each(KINDS)("names its button after what it will do (%s)", (kind) => {
      // "Fetch and import" tells the owner a request is about to leave the machine;
      // "Import file" tells them nothing will. Same component, different promise.
      renderForm(kind);

      expect(
        screen.getByRole("button", { name: SUBMIT_LABELS[kind] }),
      ).toBeEnabled();
    });

    it.each(KINDS)("asks for a title and an authority (%s)", (kind) => {
      renderForm(kind);

      expect(screen.getByLabelText(/^Title/)).toBeInTheDocument();
      expect(screen.getByLabelText("Authority")).toBeInTheDocument();
    });

    it.each(KINDS)(
      "reports a rejected title on the title field (%s)",
      async (kind) => {
        renderForm(kind);

        const user = userEvent.setup();

        await user.click(screen.getByLabelText(/^Title/));
        await user.paste("x".repeat(MAX_SOURCE_TITLE_CHARS + 1));
        await submit(user, kind);

        await waitFor(() => {
          expect(
            screen.getByText(
              `Use ${MAX_SOURCE_TITLE_CHARS} characters or fewer.`,
            ),
          ).toBeVisible();
        });

        expect(screen.getByLabelText(/^Title/)).toHaveAttribute(
          "aria-invalid",
          "true",
        );
      },
    );
  });

  describe("pasting text", () => {
    it("offers a text box and says how much it will take", () => {
      renderForm("PASTE");

      expect(screen.getByLabelText("The text")).toHaveAttribute("name", "text");
      expect(screen.getByLabelText("The text").tagName).toBe("TEXTAREA");
      expect(screen.getByText(/Up to 1,000,000 characters/)).toBeVisible();
    });

    it("lets the owner say the text is markdown", () => {
      renderForm("PASTE");

      const checkbox = screen.getByRole("checkbox", {
        name: "This text is markdown",
      });

      expect(checkbox).toHaveAttribute("name", "isMarkdown");
      expect(checkbox).not.toBeChecked();
    });

    it("requires the title here, where nothing else can supply one", async () => {
      // The asymmetry the component's own comment describes: a file has a filename and a
      // URL has an address, and a paste has nothing to name it by. The rule lives in
      // `importPastedSourceSchema`, and this asserts the refusal reaches the right field.
      // The schema is the authority; the `required` attribute asserted below is the
      // browser saying the same thing earlier, and this test drives past it deliberately
      // so the server-side refusal is the thing under test.
      const onValid = vi.fn();

      renderForm("PASTE", { action: validatingAction("PASTE", onValid) });

      const user = userEvent.setup();

      await user.click(screen.getByLabelText("The text"));
      await user.paste("The exam guide, section 1.");
      await submit(user, "PASTE");

      await waitFor(() => {
        expect(screen.getByText("A title is required.")).toBeVisible();
      });

      expect(onValid).not.toHaveBeenCalled();
      expect(screen.getByLabelText(/^Title/)).toHaveAttribute(
        "aria-invalid",
        "true",
      );
    });

    it("marks the title required for a paste and not for the other kinds", () => {
      // The requirement has to be visible before submission, not only after it, and it
      // has to be visible *only* here — marking an optional field required would be a
      // worse lie than leaving a required one unmarked.
      renderForm("PASTE");

      expect(screen.getByLabelText(/^Title/)).toBeRequired();
      expect(screen.getByText("(required)")).toBeVisible();

      cleanup();
      renderForm("FILE");

      expect(screen.getByLabelText(/^Title/)).not.toBeRequired();
      expect(screen.queryByText("(required)")).toBeNull();

      cleanup();
      renderForm("URL");

      expect(screen.getByLabelText(/^Title/)).not.toBeRequired();
      expect(screen.queryByText("(required)")).toBeNull();
    });

    it("says the title is what the owner will recognise it by", () => {
      renderForm("PASTE");

      expect(
        screen.getByText(/in the words you will recognise it by/i),
      ).toBeVisible();
      expect(screen.queryByText(/^Optional\./)).toBeNull();
    });

    it("submits the paste as the facade will receive it", async () => {
      const onValid = vi.fn();

      renderForm("PASTE", { action: validatingAction("PASTE", onValid) });

      const user = userEvent.setup();

      await user.type(screen.getByLabelText(/^Title/), "Exam guide");
      await user.click(screen.getByLabelText("The text"));
      await user.paste("  A paragraph of the guide.  ");
      await user.click(
        screen.getByRole("checkbox", { name: "This text is markdown" }),
      );
      await user.selectOptions(
        screen.getByLabelText("Authority"),
        "TRUSTED_THIRD_PARTY",
      );
      await submit(user, "PASTE");

      await waitFor(() => {
        expect(onValid).toHaveBeenCalledTimes(1);
      });

      expect(onValid.mock.calls[0]?.[0]).toEqual({
        title: "Exam guide",
        authority: "TRUSTED_THIRD_PARTY",
        text: "A paragraph of the guide.",
        isMarkdown: true,
      });
    });

    it("refuses an empty paste on the text field", async () => {
      renderForm("PASTE");

      const user = userEvent.setup();

      await user.type(screen.getByLabelText(/^Title/), "Exam guide");
      await submit(user, "PASTE");

      await waitFor(() => {
        expect(
          screen.getByText("Paste the text you want to import."),
        ).toBeVisible();
      });

      expect(screen.getByLabelText("The text")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
    });

    it("keeps a rejected paste, and the markdown answer with it", async () => {
      // Re-pasting a document because the title was blank is not something to ask of
      // anybody, and silently unticking "markdown" would change what gets stored.
      renderForm("PASTE");

      const user = userEvent.setup();

      await user.click(screen.getByLabelText("The text"));
      await user.paste("A paragraph of the guide.");
      await user.click(
        screen.getByRole("checkbox", { name: "This text is markdown" }),
      );
      await submit(user, "PASTE");

      await waitFor(() => {
        expect(screen.getByText("A title is required.")).toBeVisible();
      });

      expect(screen.getByLabelText("The text")).toHaveValue(
        "A paragraph of the guide.",
      );
      expect(
        screen.getByRole("checkbox", { name: "This text is markdown" }),
      ).toBeChecked();
    });

    it("offers no file and no address here", () => {
      renderForm("PASTE");

      expect(screen.queryByLabelText("The file")).toBeNull();
      expect(screen.queryByLabelText("The address")).toBeNull();
    });
  });

  describe("uploading a file", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("offers a file input and states the size cap", () => {
      renderForm("FILE");

      const input = screen.getByLabelText("The file");

      expect(input).toHaveAttribute("type", "file");
      expect(input).toHaveAttribute("name", "document");
      expect(screen.getByText(/up to 12 MB/)).toBeVisible();
    });

    it("accepts only what the extractor can read", () => {
      // A .docx or an image would fail after the upload; naming the three readable kinds
      // in `accept` puts the refusal in the file picker instead.
      renderForm("FILE");

      const accept = screen.getByLabelText("The file").getAttribute("accept");

      expect(accept).toContain(".pdf");
      expect(accept).toContain(".txt");
      expect(accept).toContain(".md");
      expect(accept).not.toContain(".docx");
    });

    it("warns that a scanned PDF has nothing to read", () => {
      renderForm("FILE");

      expect(screen.getByText(/a scan has no text layer/i)).toBeVisible();
    });

    it("says the file itself is not kept", () => {
      // The owner is uploading somebody else's exam guide. That only the text survives is
      // the thing worth stating on the screen that asks for it.
      renderForm("FILE");

      expect(screen.getByText(/read once and discarded/i)).toBeVisible();
    });

    it("keeps the real input inside the drop zone", () => {
      // The zone is a larger target for one input, not a second upload path, so ordinary
      // submission carries the file with no extra wiring.
      renderForm("FILE");

      const zone = document.querySelector(".file-drop-zone");

      expect(zone).not.toBeNull();
      expect(
        zone?.querySelector('input[type="file"][name="document"]'),
      ).not.toBeNull();
      expect(
        screen.getByText("…or drag a file anywhere in this box."),
      ).toBeVisible();
    });

    it("takes the chosen file and names it back", async () => {
      renderForm("FILE");

      const user = userEvent.setup();
      const input = screen.getByLabelText("The file") as HTMLInputElement;
      const file = new File(["The exam guide."], "guide.txt", {
        type: "text/plain",
      });

      await user.upload(input, file);

      expect(input.files?.item(0)?.name).toBe("guide.txt");
      await expect(input.files?.item(0)?.text()).resolves.toBe(
        "The exam guide.",
      );
      expect(screen.getByText("Ready: guide.txt")).toBeVisible();
    });

    it("assigns a dropped file to that same input", () => {
      // Two jsdom gaps have to be papered over to test the drop at all: there is no
      // `DataTransfer` constructor for the handler to build, and `input.files` refuses any
      // assignment that is not a native `FileList`. Both are stubbed rather than worked
      // around, because what is being tested is the one thing that matters about the drop
      // zone — that a dropped file ends up on the input the action reads, instead of in a
      // piece of component state that submission would ignore.
      class FakeDataTransfer {
        private readonly stored: File[] = [];

        readonly items = {
          add: (file: File) => {
            this.stored.push(file);
          },
        };

        get files() {
          return fileListOf(this.stored);
        }
      }

      vi.stubGlobal("DataTransfer", FakeDataTransfer);
      renderForm("FILE");

      const input = screen.getByLabelText("The file") as HTMLInputElement;

      Object.defineProperty(input, "files", {
        value: null,
        writable: true,
        configurable: true,
      });

      const file = new File(["The exam guide."], "dropped.md", {
        type: "text/markdown",
      });

      fireEvent.drop(document.querySelector(".file-drop-zone") as Element, {
        dataTransfer: { files: fileListOf([file]) },
      });

      expect(input.files?.item(0)?.name).toBe("dropped.md");
      expect(screen.getByText("Ready: dropped.md")).toBeVisible();
    });

    it("ignores a drop that carries no file", () => {
      vi.stubGlobal(
        "DataTransfer",
        class {
          readonly items = { add: () => undefined };
          readonly files = fileListOf([]);
        },
      );
      renderForm("FILE");

      fireEvent.drop(document.querySelector(".file-drop-zone") as Element, {
        dataTransfer: { files: fileListOf([]) },
      });

      expect(
        screen.getByText("…or drag a file anywhere in this box."),
      ).toBeVisible();
    });

    it("treats the title as optional, and says the filename will do", () => {
      renderForm("FILE");

      expect(
        screen.getByText(
          "Optional. Left blank, the filename becomes the title.",
        ),
      ).toBeVisible();
    });

    it("submits a blank title as the empty string the action will replace", async () => {
      const onValid = vi.fn();

      renderForm("FILE", { action: validatingAction("FILE", onValid) });

      await submit(userEvent.setup(), "FILE");

      await waitFor(() => {
        expect(onValid).toHaveBeenCalledTimes(1);
      });

      expect(onValid.mock.calls[0]?.[0]).toEqual({
        title: "",
        authority: "OFFICIAL",
      });
    });

    it("reports a missing or unreadable file on the file field", async () => {
      // `SourceEmptyError` is keyed to `document`, so "choose a file" appears beside the
      // input rather than as an anonymous banner above the form.
      renderForm("FILE", {
        action: validatingAction("FILE", () => {
          throw new SourceEmptyError(
            "document",
            "Choose a file to import, or paste the text instead.",
          );
        }),
      });

      await submit(userEvent.setup(), "FILE");

      await waitFor(() => {
        expect(
          screen.getByText(
            "Choose a file to import, or paste the text instead.",
          ),
        ).toBeVisible();
      });

      expect(screen.getByLabelText("The file")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
    });

    it("leaves the encoding to React rather than setting it twice", () => {
      // A form carrying a file needs `multipart/form-data` or the server receives a
      // filename and no content. React sets it itself for a function action, and setting
      // it here as well is overridden *and* warned about at runtime — so the correct thing
      // for this component to do is nothing, which is what the objective import also does.
      //
      // Which is why this asserts the absence. The attribute only appears in
      // server-rendered markup, so a client render cannot observe it either way.
      renderForm("FILE");

      expect(
        screen
          .getByRole("button", { name: SUBMIT_LABELS.FILE })
          .closest("form"),
      ).not.toHaveAttribute("enctype");
    });

    it("offers no paste box and no markdown tick here", () => {
      renderForm("FILE");

      expect(screen.queryByLabelText("The text")).toBeNull();
      expect(screen.queryByRole("checkbox")).toBeNull();
    });
  });

  describe("fetching an address", () => {
    it("offers a URL input", () => {
      renderForm("URL");

      const input = screen.getByLabelText("The address");

      expect(input).toHaveAttribute("name", "url");
      expect(input).toHaveAttribute("type", "url");
      expect(input).toHaveAttribute("inputmode", "url");
    });

    it("says up front what this route can and cannot do", () => {
      // Refreshability is the one difference that decides which route to pick when two
      // would both work, and a private address or a JavaScript-only page will be refused
      // — better said before the fetch than after it.
      renderForm("URL");

      expect(screen.getByText(/read again later/i)).toBeVisible();
      expect(
        screen.getByText(/inside a private network are refused/i),
      ).toBeVisible();
      expect(screen.getByText(/built\s+entirely by JavaScript/i)).toBeVisible();
    });

    it("treats the title as optional, and says the address will do", () => {
      renderForm("URL");

      expect(
        screen.getByText(
          "Optional. Left blank, the address becomes the title.",
        ),
      ).toBeVisible();
    });

    it("submits the address as the facade will receive it", async () => {
      const onValid = vi.fn();

      renderForm("URL", { action: validatingAction("URL", onValid) });

      const user = userEvent.setup();

      await user.type(
        screen.getByLabelText("The address"),
        "  https://example.test/guide  ",
      );
      await user.selectOptions(
        screen.getByLabelText("Authority"),
        "GENERAL_WEB",
      );
      await submit(user, "URL");

      await waitFor(() => {
        expect(onValid).toHaveBeenCalledTimes(1);
      });

      expect(onValid.mock.calls[0]?.[0]).toEqual({
        title: "",
        authority: "GENERAL_WEB",
        url: "https://example.test/guide",
      });
    });

    it("refuses a blank address on the address field", async () => {
      renderForm("URL");

      await submit(userEvent.setup(), "URL");

      await waitFor(() => {
        expect(
          screen.getByText("Enter the address of the page to import."),
        ).toBeVisible();
      });

      expect(screen.getByLabelText("The address")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
    });

    it("reports a refused address on the address field, and keeps it", async () => {
      // The safety guard's own sentence is the one the owner needs, and it belongs under
      // the input that caused it — not as a banner that could be about anything.
      renderForm("URL", {
        action: validatingAction("URL", () => {
          throw new SourceUrlRejectedError(
            "That address resolves inside a private network.",
          );
        }),
      });

      const user = userEvent.setup();

      await user.type(screen.getByLabelText("The address"), "http://10.0.0.5/");
      await submit(user, "URL");

      await waitFor(() => {
        expect(
          screen.getByText("That address resolves inside a private network."),
        ).toBeVisible();
      });

      expect(screen.getByLabelText("The address")).toHaveValue(
        "http://10.0.0.5/",
      );
    });

    it("offers no file and no paste box here", () => {
      renderForm("URL");

      expect(screen.queryByLabelText("The file")).toBeNull();
      expect(screen.queryByLabelText("The text")).toBeNull();
    });
  });
});

/**
 * A stand-in for `FileList`, which cannot be constructed.
 *
 * The same shape `@testing-library/user-event` builds for its own uploads: indexed
 * properties, a length, and `item`, which is what the component's drop handler reads.
 */
function fileListOf(files: readonly File[]): FileList {
  const list = {
    ...files,
    length: files.length,
    item: (index: number) => files[index] ?? null,
  };

  return list as unknown as FileList;
}
