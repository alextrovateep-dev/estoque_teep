import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateProductionEnv } from "./env";

describe("validateProductionEnv", () => {
  it("não valida fora de production", () => {
    assert.deepEqual(
      validateProductionEnv({ NODE_ENV: "development" }),
      []
    );
  });

  it("rejeita JWT de exemplo e CORS localhost", () => {
    const errors = validateProductionEnv({
      NODE_ENV: "production",
      JWT_ACCESS_SECRET: "change-me-access-secret-min-32-chars!!",
      JWT_REFRESH_SECRET: "x".repeat(40),
      DATABASE_URL: "postgresql://u:p@h/db",
      CORS_ORIGIN: "http://localhost:3000",
    });
    assert.ok(errors.some((e) => e.includes("JWT_ACCESS_SECRET")));
    assert.ok(errors.some((e) => e.includes("CORS_ORIGIN")));
  });

  it("aceita secrets fortes e domínio público", () => {
    const errors = validateProductionEnv({
      NODE_ENV: "production",
      JWT_ACCESS_SECRET: "a".repeat(40),
      JWT_REFRESH_SECRET: "b".repeat(40),
      DATABASE_URL: "postgresql://u:p@h/db",
      CORS_ORIGIN: "https://estoque.teep.com.br",
    });
    assert.deepEqual(errors, []);
  });
});
