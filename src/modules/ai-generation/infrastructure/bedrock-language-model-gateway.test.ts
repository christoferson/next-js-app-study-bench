import { describe, expect, it } from "vitest";
import {
  AccessDeniedException,
  InternalServerException,
  ModelNotReadyException,
  ModelTimeoutException,
  ResourceNotFoundException,
  ServiceQuotaExceededException,
  ServiceUnavailableException,
  ThrottlingException,
  ValidationException,
} from "@aws-sdk/client-bedrock-runtime";
import type {
  ConverseCommand,
  ConverseCommandInput,
  ConverseCommandOutput,
} from "@aws-sdk/client-bedrock-runtime";
import { ProviderFailure } from "@/modules/ai-generation/domain/errors";
import type {
  StructuredGenerationRequest,
  StructuredValidation,
} from "@/modules/ai-generation/ports/language-model-gateway";
import {
  BEDROCK_PROVIDER,
  BedrockLanguageModelGateway,
  categorize,
} from "./bedrock-language-model-gateway";
import type { BedrockConverseClient } from "./bedrock-language-model-gateway";

/**
 * Request and response mapping for the Bedrock adapter.
 *
 * Every test here runs against a stub client: no network call is made, no credential
 * is read, and no AWS charge is incurred (`spec/TESTING.md` section 5). What is being
 * asserted is the adapter's own translation — the Converse request it builds, the
 * payload it reads back, the repair turn it constructs, and the reduction of every
 * provider exception to a category that carries no provider text.
 *
 * The live counterpart is `tests/live/bedrock-smoke.live.test.ts`, which is outside
 * `src/` and therefore outside the default suite.
 */

/** Records the commands it was sent and replies with scripted outputs. */
class StubConverseClient implements BedrockConverseClient {
  readonly sent: ConverseCommandInput[] = [];

  private turn = 0;

  constructor(
    private readonly outputs: readonly (ConverseCommandOutput | Error)[],
  ) {}

  async send(command: ConverseCommand): Promise<ConverseCommandOutput> {
    this.sent.push(command.input);

    const output = this.outputs[this.turn];

    this.turn += 1;

    if (output === undefined) {
      throw new Error("The stub client was called more times than scripted.");
    }

    if (output instanceof Error) {
      throw output;
    }

    return output;
  }
}

const SCHEMA_NAME = "practice_questions";

/** A Converse response whose forced tool call carries `input`. */
function toolUseOutput(
  input: unknown,
  options: {
    readonly toolUseId?: string;
    readonly usage?: {
      readonly inputTokens?: number;
      readonly outputTokens?: number;
      readonly totalTokens?: number;
    } | null;
  } = {},
): ConverseCommandOutput {
  return {
    $metadata: {},
    output: {
      message: {
        role: "assistant",
        content: [
          {
            toolUse: {
              toolUseId: options.toolUseId ?? "tool-1",
              name: SCHEMA_NAME,
              input: input as never,
            },
          },
        ],
      },
    },
    stopReason: "tool_use",
    ...(options.usage === null
      ? {}
      : {
          usage: options.usage ?? {
            inputTokens: 300,
            outputTokens: 120,
            totalTokens: 420,
          },
        }),
  } as ConverseCommandOutput;
}

/**
 * A request whose validator accepts payloads carrying `{ ok: true }`.
 *
 * The validator is the application's, per the port, so the adapter is tested on what
 * it does with a verdict rather than on any schema of its own.
 */
function request(
  overrides: Partial<StructuredGenerationRequest<unknown>> = {},
): StructuredGenerationRequest<unknown> {
  return {
    system: "System instructions for the demo persona.",
    user: "Write 2 questions.",
    schemaName: SCHEMA_NAME,
    schemaDescription:
      "Records the practice questions written for this request.",
    schema: {
      type: "object",
      properties: { ok: { type: "boolean" } },
      required: ["ok"],
      additionalProperties: false,
    },
    validate: (value): StructuredValidation<unknown> =>
      typeof value === "object" &&
      value !== null &&
      (value as { readonly ok?: unknown }).ok === true
        ? { ok: true, value }
        : { ok: false, errors: ["questions[0].stem: expected a string"] },
    maxOutputTokens: 4000,
    ...overrides,
  };
}

function gatewayWith(outputs: readonly (ConverseCommandOutput | Error)[]): {
  readonly gateway: BedrockLanguageModelGateway;
  readonly client: StubConverseClient;
} {
  const client = new StubConverseClient(outputs);

  return {
    gateway: new BedrockLanguageModelGateway({
      modelId: "demo.model-id:0",
      client,
    }),
    client,
  };
}

describe("BedrockLanguageModelGateway", () => {
  it("identifies itself by provider and configured model", () => {
    const { gateway } = gatewayWith([]);

    expect(gateway.provider).toBe(BEDROCK_PROVIDER);
    expect(gateway.modelId).toBe("demo.model-id:0");
  });

  describe("the Converse request it builds", () => {
    it("forces the one declared tool so the answer cannot be prose", async () => {
      const { gateway, client } = gatewayWith([toolUseOutput({ ok: true })]);

      await gateway.generateStructured(request());

      const sent = client.sent[0];

      expect(sent?.toolConfig?.tools).toHaveLength(1);
      expect(sent?.toolConfig?.tools?.[0]?.toolSpec?.name).toBe(SCHEMA_NAME);
      expect(sent?.toolConfig?.toolChoice).toEqual({
        tool: { name: SCHEMA_NAME },
      });
    });

    it("sends the system instructions and the user turn separately", async () => {
      const { gateway, client } = gatewayWith([toolUseOutput({ ok: true })]);

      await gateway.generateStructured(request());

      const sent = client.sent[0];

      expect(sent?.system).toEqual([
        { text: "System instructions for the demo persona." },
      ]);
      expect(sent?.messages).toEqual([
        { role: "user", content: [{ text: "Write 2 questions." }] },
      ]);
    });

    it("caps the output and samples deterministically", async () => {
      const { gateway, client } = gatewayWith([toolUseOutput({ ok: true })]);

      await gateway.generateStructured(request());

      expect(client.sent[0]?.inferenceConfig).toEqual({
        maxTokens: 4000,
        temperature: 0,
      });
    });

    it("calls the configured model", async () => {
      const { gateway, client } = gatewayWith([toolUseOutput({ ok: true })]);

      await gateway.generateStructured(request());

      expect(client.sent[0]?.modelId).toBe("demo.model-id:0");
    });

    it("copies the schema structurally rather than passing the port type through", async () => {
      const { gateway, client } = gatewayWith([toolUseOutput({ ok: true })]);

      await gateway.generateStructured(
        request({
          schema: {
            type: "object",
            properties: {
              items: {
                type: "array",
                items: { type: "string", enum: ["A", "B"] },
                maxItems: 3,
              },
              note: { type: "string", nullable: true, description: "A note." },
            },
            required: ["items"],
            additionalProperties: false,
          },
        }),
      );

      expect(
        client.sent[0]?.toolConfig?.tools?.[0]?.toolSpec?.inputSchema,
      ).toEqual({
        json: {
          type: "object",
          properties: {
            items: {
              type: "array",
              items: { type: "string", enum: ["A", "B"] },
              maxItems: 3,
            },
            // `nullable` becomes a JSON Schema type union, which is how plain JSON
            // Schema states it.
            note: { type: ["string", "null"], description: "A note." },
          },
          required: ["items"],
          additionalProperties: false,
        },
      });
    });
  });

  describe("reading the answer", () => {
    it("returns the validated tool input with the reported token counts", async () => {
      const { gateway } = gatewayWith([toolUseOutput({ ok: true })]);
      const result = await gateway.generateStructured(request());

      expect(result.value).toEqual({ ok: true });
      expect(result.repairAttempted).toBe(false);
      expect(result.usage).toEqual({
        inputTokens: 300,
        outputTokens: 120,
        totalTokens: 420,
      });
    });

    it("reports no usage when the provider reported an incomplete count", async () => {
      const { gateway } = gatewayWith([
        toolUseOutput({ ok: true }, { usage: { inputTokens: 10 } }),
      ]);

      expect((await gateway.generateStructured(request())).usage).toBeNull();
    });

    it("reports no usage when the provider reported none at all", async () => {
      const { gateway } = gatewayWith([
        toolUseOutput({ ok: true }, { usage: null }),
      ]);

      expect((await gateway.generateStructured(request())).usage).toBeNull();
    });

    it("treats a text-only answer as malformed output", async () => {
      // The tool was forced, so an answer without it is the model failing to comply.
      const textOnly = {
        $metadata: {},
        output: {
          message: {
            role: "assistant",
            content: [{ text: "Sure! Here goes." }],
          },
        },
      } as ConverseCommandOutput;
      const { gateway } = gatewayWith([textOnly, textOnly]);

      await expect(gateway.generateStructured(request())).rejects.toMatchObject(
        {
          name: "ProviderFailure",
          category: "MALFORMED_OUTPUT",
        },
      );
    });

    it("treats a call to a different tool as malformed output", async () => {
      const wrongTool = {
        $metadata: {},
        output: {
          message: {
            role: "assistant",
            content: [
              {
                toolUse: {
                  toolUseId: "tool-1",
                  name: "some_other_tool",
                  input: { ok: true } as never,
                },
              },
            ],
          },
        },
      } as ConverseCommandOutput;
      const { gateway } = gatewayWith([wrongTool, wrongTool]);

      await expect(
        gateway.generateStructured(request()),
      ).rejects.toBeInstanceOf(ProviderFailure);
    });
  });

  describe("the one repair attempt", () => {
    it("echoes the rejected call back with the validator's field paths", async () => {
      const { gateway, client } = gatewayWith([
        toolUseOutput({ ok: false }, { toolUseId: "tool-42" }),
        toolUseOutput({ ok: true }),
      ]);
      const result = await gateway.generateStructured(request());

      expect(result.repairAttempted).toBe(true);
      expect(result.value).toEqual({ ok: true });

      const repair = client.sent[1];

      expect(repair?.messages).toHaveLength(3);
      expect(repair?.messages?.[1]).toEqual({
        role: "assistant",
        content: [
          {
            toolUse: {
              toolUseId: "tool-42",
              name: SCHEMA_NAME,
              input: { ok: false },
            },
          },
        ],
      });

      const toolResult = repair?.messages?.[2]?.content?.[0]?.toolResult;

      expect(toolResult?.toolUseId).toBe("tool-42");
      expect(toolResult?.status).toBe("error");
      expect(toolResult?.content?.[0]?.text).toContain(
        "questions[0].stem: expected a string",
      );
    });

    it("bills the owner for both turns of a repaired request", async () => {
      const { gateway } = gatewayWith([
        toolUseOutput({ ok: false }),
        toolUseOutput({ ok: true }),
      ]);

      expect((await gateway.generateStructured(request())).usage).toEqual({
        inputTokens: 600,
        outputTokens: 240,
        totalTokens: 840,
      });
    });

    it("stops after one repair rather than looping", async () => {
      const { gateway, client } = gatewayWith([
        toolUseOutput({ ok: false }),
        toolUseOutput({ ok: false }),
      ]);

      await expect(gateway.generateStructured(request())).rejects.toMatchObject(
        {
          category: "MALFORMED_OUTPUT",
        },
      );
      // An unbounded repair loop is an unbounded bill.
      expect(client.sent).toHaveLength(2);
    });

    it("never sends the owner's data back as repair feedback", async () => {
      // The validator's messages carry paths and expectations only, and the adapter
      // adds nothing of its own, so the repair turn cannot contain content.
      const { gateway, client } = gatewayWith([
        toolUseOutput({ ok: false }),
        toolUseOutput({ ok: true }),
      ]);

      // The validator refuses both turns, so the request fails; what matters here is
      // the text the second turn carried.
      await gateway
        .generateStructured(
          request({
            validate: () => ({
              ok: false,
              errors: ["questions: expected 2 items"],
            }),
          }),
        )
        .catch(() => undefined);

      const text =
        client.sent[1]?.messages?.[2]?.content?.[0]?.toolResult?.content?.[0]
          ?.text ?? "";

      expect(text).toContain("questions: expected 2 items");
      expect(text).not.toMatch(/secret|arn:|aws_/i);
    });
  });

  describe("provider failures", () => {
    it("reduces a provider error to a category with no provider text", async () => {
      const { gateway } = gatewayWith([
        new ThrottlingException({
          message:
            "Too many requests for arn:aws:bedrock:us-east-1:123456789012",
          $metadata: { requestId: "req-1" },
        }),
      ]);

      const failure = await gateway
        .generateStructured(request())
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(ProviderFailure);

      if (!(failure instanceof ProviderFailure)) {
        return;
      }

      expect(failure.category).toBe("PROVIDER_THROTTLED");
      // The provider's own message never travels with the failure.
      expect(failure.message).not.toContain("arn:");
      expect(failure.message).not.toContain("req-1");
      expect(failure.message).not.toContain("Too many requests");
    });

    it("does not retry a provider failure", async () => {
      const { gateway, client } = gatewayWith([
        new ServiceUnavailableException({ message: "down", $metadata: {} }),
      ]);

      await expect(
        gateway.generateStructured(request()),
      ).rejects.toBeInstanceOf(ProviderFailure);
      expect(client.sent).toHaveLength(1);
    });
  });

  describe("categorize", () => {
    it("maps each provider exception to the category its advice fits", () => {
      const metadata = { $metadata: {} };

      expect(
        categorize(new AccessDeniedException({ message: "no", ...metadata })),
      ).toBe("NOT_AUTHORIZED");
      expect(
        categorize(
          new ResourceNotFoundException({ message: "no", ...metadata }),
        ),
      ).toBe("MODEL_ACCESS_DENIED");
      expect(
        categorize(new ModelNotReadyException({ message: "no", ...metadata })),
      ).toBe("MODEL_ACCESS_DENIED");
      expect(
        categorize(new ThrottlingException({ message: "no", ...metadata })),
      ).toBe("PROVIDER_THROTTLED");
      expect(
        categorize(
          new ServiceQuotaExceededException({ message: "no", ...metadata }),
        ),
      ).toBe("PROVIDER_THROTTLED");
      expect(
        categorize(new ValidationException({ message: "no", ...metadata })),
      ).toBe("PROVIDER_REJECTED_REQUEST");
      expect(
        categorize(new ModelTimeoutException({ message: "no", ...metadata })),
      ).toBe("TIMED_OUT");
      expect(
        categorize(new InternalServerException({ message: "no", ...metadata })),
      ).toBe("PROVIDER_UNAVAILABLE");
    });

    it("reads a transport failure from its code, not its message", () => {
      // A message can carry a host or a URL; a code cannot.
      for (const code of ["ENOTFOUND", "ECONNREFUSED", "ETIMEDOUT"]) {
        expect(categorize(Object.assign(new Error("network"), { code }))).toBe(
          "PROVIDER_UNAVAILABLE",
        );
      }

      expect(
        categorize(Object.assign(new Error("aborted"), { name: "AbortError" })),
      ).toBe("PROVIDER_UNAVAILABLE");
    });

    it("falls back to an unexpected category for anything else", () => {
      expect(categorize(new Error("something else"))).toBe("UNEXPECTED");
      expect(categorize(null)).toBe("UNEXPECTED");
      expect(categorize("a string")).toBe("UNEXPECTED");
    });
  });
});
