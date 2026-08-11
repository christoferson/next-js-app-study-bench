import { describe, expect, it } from "vitest";
import { GET } from "@/app/health/route";

describe("GET /health", () => {
  it("returns the expected safe payload", async () => {
    const response = GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      application: "study-bench",
    });
  });

  it("exposes no keys beyond status and application", async () => {
    const body: unknown = await GET().json();

    expect(typeof body).toBe("object");
    expect(Object.keys(body as Record<string, unknown>).sort()).toEqual([
      "application",
      "status",
    ]);
  });

  it("does not leak environment, version, or host details", async () => {
    const serialized = JSON.stringify(await GET().json());

    for (const forbidden of [
      "version",
      "env",
      "node",
      "host",
      "path",
      "secret",
      "region",
      "uptime",
    ]) {
      expect(serialized.toLowerCase()).not.toContain(forbidden);
    }
  });
});
