interface FieldErrorsProps {
  readonly id: string;
  readonly messages: readonly string[] | undefined;
}

/**
 * Validation messages for one field.
 *
 * The element keeps its `id` stable so an input can reference it through
 * `aria-describedby` whether or not it currently has an error. `role="alert"`
 * announces a message that appears after submission.
 */
export function FieldErrors({ id, messages }: FieldErrorsProps) {
  if (messages === undefined) {
    return null;
  }

  return (
    <ul className="field-errors" id={id} role="alert">
      {messages.map((message) => (
        <li key={message}>{message}</li>
      ))}
    </ul>
  );
}
