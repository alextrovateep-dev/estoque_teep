import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALERTA_EMAIL_TYPES,
  CONTA_EMAIL_TYPES,
  EMAIL_TYPES,
} from "./email/emailTypes";
import {
  NOTIFICATION_EMAIL_ENABLED,
  isEmailEnabledForType,
} from "./notificationEmailEnabledTypes";
import { getEmailSample } from "./email/emailTemplateCatalog";
import { resolveTransactionalIdentity } from "../lib/mailIdentity";

describe("F9.1 allowlist ↔ builders", () => {
  it("alertas de estoque estão na allowlist de e-mail", () => {
    for (const t of ALERTA_EMAIL_TYPES) {
      assert.equal(isEmailEnabledForType(t), true, t);
      assert.ok(NOTIFICATION_EMAIL_ENABLED.has(t));
    }
  });

  it("e-mails de conta não entram na allowlist de alerta", () => {
    for (const t of CONTA_EMAIL_TYPES) {
      assert.ok(EMAIL_TYPES.includes(t));
      assert.equal(
        NOTIFICATION_EMAIL_ENABLED.has(t as never),
        false,
        t
      );
    }
  });

  it("cada tipo tem sample com subject/html/text", async () => {
    for (const t of EMAIL_TYPES) {
      const s = await getEmailSample(t);
      assert.equal(s.type, t);
      assert.ok(s.subject.length > 0);
      assert.ok(s.html.includes("TEEP"));
      assert.ok(s.text.length > 0);
    }
  });

  it("mailIdentity resolve from/replyTo/envelope", () => {
    const id = resolveTransactionalIdentity();
    assert.ok(id.from);
    assert.ok(id.replyTo);
    assert.ok(id.envelopeFrom);
  });
});
