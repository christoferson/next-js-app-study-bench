import type { ProviderUsage } from "@/modules/ai-generation/domain/generation-run";

/**
 * Application-defined language-model gateway
 * (`spec/AI-GUIDELINES.md` section 1.1).
 *
 * Application and domain code never import the Bedrock SDK. Everything they need
 * from a model is expressed here in plain data: instructions, a request, a
 * description of the answer shape, and a validator the application owns.
 *
 * The gateway owns the *conversation*, including the bounded repair attempt
 * (`SPEC.md` section 11.2). That is deliberate: repairing malformed output means
 * sending the validation failure back as another turn, which is a provider
 * concern, while deciding what "valid" means belongs to the application. Splitting
 * them the other way round would put a retry loop in the facade and a schema in
 * the adapter.
 *
 * `converse` from `spec/AI-GUIDELINES.md` section 1.1 is deliberately not part of
 * this port yet. D6 has no conversational feature, so a method with no caller
 * would be an unused abstraction (`spec/ARCHITECTURE.md` section 3); it belongs to
 * the AI tutor in D7, which is the first thing that needs a multi-turn exchange.
 */

/**
 * A JSON Schema fragment, as plain data.
 *
 * Deliberately structural rather than a full JSON Schema type: it describes the
 * subset the templates use, and it crosses the port as data so no adapter type
 * leaks into the application.
 */
export interface JsonSchema {
  readonly type:
    "object" | "array" | "string" | "integer" | "number" | "boolean";
  readonly description?: string;
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly items?: JsonSchema;
  readonly enum?: readonly string[];
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly nullable?: boolean;
  readonly additionalProperties?: boolean;
}

/** The application's verdict on one candidate payload. */
export type StructuredValidation<Value> =
  | { readonly ok: true; readonly value: Value }
  | {
      readonly ok: false;
      /**
       * Messages describing what was wrong, safe to send back to the model as
       * repair feedback. Field paths and expectations only — never the owner's
       * data and never provider detail.
       */
      readonly errors: readonly string[];
    };

export interface StructuredGenerationRequest<Value> {
  /** System instructions. Never contains owner or source text. */
  readonly system: string;
  /** The single user turn, including any delimited owner text. */
  readonly user: string;
  /** Name of the answer shape, used as the tool name in the provider call. */
  readonly schemaName: string;
  readonly schemaDescription: string;
  readonly schema: JsonSchema;
  /**
   * The application's validator. Called on the parsed payload; a failure drives
   * the one repair attempt and, if that also fails, a `MALFORMED_OUTPUT`
   * provider failure.
   */
  readonly validate: (value: unknown) => StructuredValidation<Value>;
  /** Hard cap on generated tokens, so one request cannot run away. */
  readonly maxOutputTokens: number;
}

export interface StructuredGenerationResult<Value> {
  readonly value: Value;
  /** Token counts when the provider reports them. */
  readonly usage: ProviderUsage | null;
  /** Whether the first response had to be repaired before it validated. */
  readonly repairAttempted: boolean;
}

export interface LanguageModelGateway {
  /** Identifies the provider on the run record, for example `bedrock`. */
  readonly provider: string;
  /** The model this gateway calls, recorded on the run record. */
  readonly modelId: string;

  /**
   * Produces one validated payload, or throws `ProviderFailure`.
   *
   * Implementations must attempt validation, permit exactly one repair attempt on
   * failure, and then fail clearly (`SPEC.md` section 11.2). They must never
   * return a payload the validator rejected.
   */
  generateStructured<Value>(
    request: StructuredGenerationRequest<Value>,
  ): Promise<StructuredGenerationResult<Value>>;
}
