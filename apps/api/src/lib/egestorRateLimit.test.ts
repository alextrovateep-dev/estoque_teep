import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { esperaRateLimitMs } from "./egestorRateLimit";

describe("esperaRateLimitMs", () => {
  it("usa Retry-After em segundos", () => {
    assert.equal(esperaRateLimitMs("30", "0", 0), 30_000);
  });

  it("sobe o backoff sem header", () => {
    assert.equal(esperaRateLimitMs(null, null, 0), 15_000);
    assert.equal(esperaRateLimitMs(null, null, 1), 30_000);
    assert.equal(esperaRateLimitMs(null, null, 3), 60_000);
  });

  it("espera 20s se remaining=0", () => {
    assert.equal(esperaRateLimitMs(null, "0", 0), 20_000);
  });
});
