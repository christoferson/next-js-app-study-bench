import {
  AccessDeniedException,
  BedrockRuntimeClient,
  ConflictException,
  ConverseCommand,
  InternalServerException,
  ModelErrorException,
  ModelNotReadyException,
  ModelTimeoutException,
  ResourceNotFoundException,
  ServiceQuotaExceededException,
  ServiceUnavailableException,
  ThrottlingException,
  ValidationException,
} from "@aws-sdk/client-bedrock-runtime";
import type {
  ConverseCommandInput,
  ConverseCommandOutput,
  Message,
} from "@aws-sdk/client-bedrock-runtime";
import type {
  GenerationFailureCategory,
  ProviderUsage,
} from "@/modules/ai-generation/domain/generation-run";
import { ProviderFailure } from "@/modules/ai-generation/domain/errors";
import type {
  JsonSchema,
  LanguageModelGateway,
  StructuredGenerationRequest,
  StructuredGenerationResult,
} from "@/modules/ai-generation/ports/language-model-gateway";

/**
 * Amazon Bedrock language-model gateway.
 *
 * The only file in the application that imports the Bedrock SDK
 * (`spec/AI-GUIDELINES.md` section 1.1). Everything above it sees plain data
 * through `LanguageModelGateway`.
 *
 * **Why Converse with a forced tool, and not `InvokeModel`.** Bedrock offers two
 * ways to get structured output, and this adapter uses exactly one: the Converse
 * API with a single tool declared and `toolChoice: { tool: { name } }`, so the model
 * has no option but to answer by filling that tool's input schema. The reasons for
 * choosing it over `InvokeModel` with an Anthropic-native messages body:
 *
 * - Converse is model-agnostic. Changing `BEDROCK_MODEL_ID` to a non-Anthropic
 *   model needs no change here, whereas an `InvokeModel` body is vendor-shaped.
 * - The answer arrives as a parsed object in `toolUse.input`, so there is no
 *   free-text-to-JSON extraction step and no prose-around-the-JSON failure mode.
 * - Token counts come back in a normalised `usage` block, which is what
 *   `SPEC.md` section 10.3 asks to be recorded.
 *
 * The forced-tool form is documented as supported by Anthropic Claude and Amazon
 * Nova models; a model that does not support it fails as
 * `PROVIDER_REJECTED_REQUEST`, which is a configuration answer the owner can act
 * on.
 *
 * **Repair.** One repair attempt, as the port requires: the failed answer is echoed
 * back as the assistant's `toolUse` turn followed by a user `toolResult` naming what
 * was wrong, which is the shape the Converse API defines for correcting a tool call.
 * If the second answer also fails validation, the run fails with
 * `MALFORMED_OUTPUT`. There is no third attempt — an unbounded repair loop is an
 * unbounded bill.
 *
 * **Safety.** Nothing from the provider's own error text is ever kept: every
 * exception is reduced to a `GenerationFailureCategory` before it leaves this file,
 * because a Bedrock error message can carry an account identifier, an ARN, or a
 * request id (`spec/SECURITY.md`). Nothing is logged here at all, so there is no
 * path by which a prompt, a credential, or a model payload reaches a log.
 */

/**
 * The slice of the Bedrock client this adapter uses.
 *
 * Narrowed to `send` so the adapter's request and response mapping is testable
 * against a stub, with no network and no credentials
 * (`spec/TESTING.md` section 5).
 */
export interface BedrockConverseClient {
  send(command: ConverseCommand): Promise<ConverseCommandOutput>;
}

export interface BedrockLanguageModelGatewayOptions {
  readonly modelId: string;
  /** `null` leaves region resolution to the AWS SDK's default chain. */
  readonly region?: string | null;
  /** Injected in tests; production builds one from the region. */
  readonly client?: BedrockConverseClient;
}

/** Recorded as the provider on every run this gateway produces. */
export const BEDROCK_PROVIDER = "bedrock";

/**
 * Deterministic sampling.
 *
 * Study content is either correct or it is not, so there is nothing to gain from
 * sampling variety and something to lose: a temperature above zero makes two
 * identical requests produce different banks, which makes a reported problem harder
 * to reproduce.
 */
const TEMPERATURE = 0;

export class BedrockLanguageModelGateway implements LanguageModelGateway {
  readonly provider = BEDROCK_PROVIDER;

  readonly modelId: string;

  private readonly client: BedrockConverseClient;

  constructor(options: BedrockLanguageModelGatewayOptions) {
    this.modelId = options.modelId;
    this.client =
      options.client ??
      new BedrockRuntimeClient(
        options.region === undefined || options.region === null
          ? {}
          : { region: options.region },
      );
  }

  async generateStructured<Value>(
    request: StructuredGenerationRequest<Value>,
  ): Promise<StructuredGenerationResult<Value>> {
    const messages: Message[] = [
      { role: "user", content: [{ text: request.user }] },
    ];
    const first = await this.converse(request, messages);
    const firstValidation = request.validate(first.payload);

    if (firstValidation.ok) {
      return {
        value: firstValidation.value,
        usage: first.usage,
        repairAttempted: false,
      };
    }

    // One repair turn. The model sees its own tool call and a tool result stating
    // the field paths that failed — never the owner's data, because the validator's
    // messages carry paths and expectations only.
    const repairMessages: Message[] = [
      ...messages,
      {
        role: "assistant",
        content: [
          {
            toolUse: {
              toolUseId: first.toolUseId,
              name: request.schemaName,
              input: first.payload as never,
            },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            toolResult: {
              toolUseId: first.toolUseId,
              status: "error",
              content: [{ text: repairInstruction(firstValidation.errors) }],
            },
          },
        ],
      },
    ];

    const second = await this.converse(request, repairMessages);
    const secondValidation = request.validate(second.payload);

    if (!secondValidation.ok) {
      throw new ProviderFailure("MALFORMED_OUTPUT");
    }

    return {
      value: secondValidation.value,
      // Both turns were billed, so both are reported.
      usage: addUsage(first.usage, second.usage),
      repairAttempted: true,
    };
  }

  /** One Converse call, reduced to the payload, the tool id, and the usage. */
  private async converse<Value>(
    request: StructuredGenerationRequest<Value>,
    messages: readonly Message[],
  ): Promise<{
    readonly payload: unknown;
    readonly toolUseId: string;
    readonly usage: ProviderUsage | null;
  }> {
    const input: ConverseCommandInput = {
      modelId: this.modelId,
      system: [{ text: request.system }],
      messages: [...messages],
      inferenceConfig: {
        maxTokens: request.maxOutputTokens,
        temperature: TEMPERATURE,
      },
      toolConfig: {
        tools: [
          {
            toolSpec: {
              name: request.schemaName,
              description: request.schemaDescription,
              inputSchema: { json: toDocument(request.schema) },
            },
          },
        ],
        // Forced: the answer must be the tool call, so there is no prose to parse
        // and no "the model chose to reply in text" failure mode.
        toolChoice: { tool: { name: request.schemaName } },
      },
    };

    const response = await this.send(input);
    const blocks = response.output?.message?.content ?? [];
    const toolUse = blocks.find(
      (block) => block.toolUse?.name === request.schemaName,
    )?.toolUse;

    if (toolUse === undefined || toolUse.input === undefined) {
      // The model answered without calling the tool it was required to call. That
      // is malformed output, not an outage, and it gets the repair attempt.
      throw new ProviderFailure("MALFORMED_OUTPUT");
    }

    return {
      payload: toolUse.input,
      toolUseId: toolUse.toolUseId ?? request.schemaName,
      usage: toUsage(response),
    };
  }

  /**
   * Sends the command, translating every provider error into a category.
   *
   * The caught error is never re-thrown and never inspected for text: only its
   * class decides the category, so no provider message can escape this method.
   */
  private async send(
    input: ConverseCommandInput,
  ): Promise<ConverseCommandOutput> {
    try {
      return await this.client.send(new ConverseCommand(input));
    } catch (error) {
      if (error instanceof ProviderFailure) {
        throw error;
      }

      throw new ProviderFailure(categorize(error));
    }
  }
}

/**
 * Which failure category a provider error is.
 *
 * Exported for the adapter's mapping test, which asserts every class this
 * application can encounter maps to a category the owner is given advice for.
 */
export function categorize(error: unknown): GenerationFailureCategory {
  if (error instanceof AccessDeniedException) {
    return "NOT_AUTHORIZED";
  }

  if (
    error instanceof ResourceNotFoundException ||
    error instanceof ModelNotReadyException
  ) {
    // The model id resolves to nothing this account may use in this region, which
    // in practice means model access was never requested for it.
    return "MODEL_ACCESS_DENIED";
  }

  if (
    error instanceof ThrottlingException ||
    error instanceof ServiceQuotaExceededException
  ) {
    return "PROVIDER_THROTTLED";
  }

  if (
    error instanceof ValidationException ||
    error instanceof ConflictException
  ) {
    return "PROVIDER_REJECTED_REQUEST";
  }

  if (error instanceof ModelTimeoutException) {
    return "TIMED_OUT";
  }

  if (
    error instanceof ServiceUnavailableException ||
    error instanceof InternalServerException ||
    error instanceof ModelErrorException
  ) {
    return "PROVIDER_UNAVAILABLE";
  }

  // A network error, a DNS failure, or an aborted request arrives as a plain
  // `Error`. `PROVIDER_UNAVAILABLE` is the honest reading of "the call did not
  // reach a model", and its owner-facing advice — check the network and retry — is
  // right for all of them.
  if (isNetworkError(error)) {
    return "PROVIDER_UNAVAILABLE";
  }

  return "UNEXPECTED";
}

/**
 * Whether an error is a transport failure rather than a service response.
 *
 * Matched on the Node error `code` rather than on the message, because a message is
 * localised, unstable, and the one part of an error that can contain a host, a URL,
 * or a header.
 */
function isNetworkError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const code = (error as { readonly code?: unknown }).code;
  const name = (error as { readonly name?: unknown }).name;

  return (
    (typeof code === "string" &&
      [
        "ENOTFOUND",
        "ECONNREFUSED",
        "ECONNRESET",
        "EAI_AGAIN",
        "ETIMEDOUT",
        "EPIPE",
      ].includes(code)) ||
    name === "TimeoutError" ||
    name === "AbortError"
  );
}

/** Token counts, when the provider reported all three. */
function toUsage(response: ConverseCommandOutput): ProviderUsage | null {
  const usage = response.usage;

  if (
    usage === undefined ||
    usage.inputTokens === undefined ||
    usage.outputTokens === undefined ||
    usage.totalTokens === undefined
  ) {
    return null;
  }

  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
  };
}

/**
 * The cost of both turns of a repaired request.
 *
 * A repair was billed twice, and reporting only the second turn would understate
 * what the batch cost.
 */
function addUsage(
  first: ProviderUsage | null,
  second: ProviderUsage | null,
): ProviderUsage | null {
  if (first === null) {
    return second;
  }

  if (second === null) {
    return first;
  }

  return {
    inputTokens: first.inputTokens + second.inputTokens,
    outputTokens: first.outputTokens + second.outputTokens,
    totalTokens: first.totalTokens + second.totalTokens,
  };
}

/** The repair message: what failed, and what to do about it. */
function repairInstruction(errors: readonly string[]): string {
  return [
    "The previous answer did not match the required shape and was rejected. Problems:",
    ...errors.map((error) => `- ${error}`),
    "Call the tool again with a corrected answer. Change only what is listed above.",
  ].join("\n");
}

/**
 * The port's `JsonSchema` as an SDK document.
 *
 * A structural copy rather than a cast, so an unknown key cannot leak from the
 * application's schema type into a provider request, and `nullable` is expressed the
 * way JSON Schema states it — a type union — because the Bedrock tool schema is
 * plain JSON Schema rather than the OpenAPI dialect `nullable` comes from.
 *
 * The return type is a JSON value rather than `Record<string, unknown>` because the
 * SDK's document type is recursively JSON: `unknown` would need a cast at the call
 * site, and a cast is what this function exists to avoid.
 */
type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;

interface JsonObject {
  [key: string]: JsonValue;
}

function toDocument(schema: JsonSchema): JsonObject {
  const document: JsonObject = {
    type: schema.nullable === true ? [schema.type, "null"] : schema.type,
  };

  if (schema.description !== undefined) {
    document.description = schema.description;
  }

  if (schema.properties !== undefined) {
    document.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([name, property]) => [
        name,
        toDocument(property),
      ]),
    );
  }

  if (schema.required !== undefined) {
    document.required = [...schema.required];
  }

  if (schema.items !== undefined) {
    document.items = toDocument(schema.items);
  }

  if (schema.enum !== undefined) {
    document.enum = [...schema.enum];
  }

  if (schema.minimum !== undefined) {
    document.minimum = schema.minimum;
  }

  if (schema.maximum !== undefined) {
    document.maximum = schema.maximum;
  }

  if (schema.minItems !== undefined) {
    document.minItems = schema.minItems;
  }

  if (schema.maxItems !== undefined) {
    document.maxItems = schema.maxItems;
  }

  if (schema.additionalProperties !== undefined) {
    document.additionalProperties = schema.additionalProperties;
  }

  return document;
}
