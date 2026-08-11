import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseUuidList } from "./rmaDefaults";

describe("rmaDefaults parseUuidList", () => {
  it("aceita vírgula, ponto-e-vírgula e espaço", () => {
    const a = "11111111-1111-4111-8111-111111111111";
    const b = "22222222-2222-4222-8222-222222222222";
    assert.deepEqual(parseUuidList(`${a}, ${b}`), [a, b]);
    assert.deepEqual(parseUuidList(`${a};${b}`), [a, b]);
    assert.deepEqual(parseUuidList(`${a} ${b}`), [a, b]);
  });

  it("ignora inválidos e duplicados", () => {
    const a = "11111111-1111-4111-8111-111111111111";
    assert.deepEqual(parseUuidList(`${a},foo,${a}`), [a]);
    assert.deepEqual(parseUuidList(""), []);
    assert.deepEqual(parseUuidList(undefined), []);
  });
});
