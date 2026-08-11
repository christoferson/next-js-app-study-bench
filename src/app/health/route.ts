import { NextResponse } from "next/server";

/**
 * Liveness endpoint.
 *
 * The payload is a fixed literal: no environment values, dependency versions,
 * host details, or secrets are exposed.
 */
export function GET(): NextResponse {
  return NextResponse.json(
    { status: "ok", application: "study-bench" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
