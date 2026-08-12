import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  REFRESH_COOKIE_NAME,
  refreshCookieOptions,
  refreshExpiresAt,
} from "./refreshCookie";

describe("refreshCookie", () => {
  it("expira em ~7 dias", () => {
    const from = new Date("2026-01-01T12:00:00.000Z");
    const exp = refreshExpiresAt(from);
    assert.equal(exp.toISOString(), "2026-01-08T12:00:00.000Z");
  });

  it("em produção usa SameSite=none e Secure", () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    delete process.env.REFRESH_COOKIE_SAMESITE;
    delete process.env.REFRESH_COOKIE_SECURE;
    try {
      const opts = refreshCookieOptions(new Date());
      assert.equal(opts.httpOnly, true);
      assert.equal(opts.sameSite, "none");
      assert.equal(opts.secure, true);
      assert.equal(opts.path, "/auth");
      assert.equal(REFRESH_COOKIE_NAME, "teep_refresh");
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it("em dev usa SameSite=lax", () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    delete process.env.REFRESH_COOKIE_SAMESITE;
    delete process.env.REFRESH_COOKIE_SECURE;
    try {
      const opts = refreshCookieOptions(new Date());
      assert.equal(opts.sameSite, "lax");
      assert.equal(opts.httpOnly, true);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});
