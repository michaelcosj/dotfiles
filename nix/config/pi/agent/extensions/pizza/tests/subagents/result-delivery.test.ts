import assert from "node:assert/strict";
import { test } from "bun:test";
import { createDeferredResultDelivery } from "../../src/shared/deferred-result-delivery.ts";

test("a result consumed by a later wait is not delivered", () => {
  const delivery = createDeferredResultDelivery<{
    id: string;
    output: string;
  }>();

  delivery.defer({ id: "sa-1", output: "done" });
  delivery.consume(["sa-1"]);

  assert.deepEqual(delivery.drain(), []);
});

test("unconsumed results are delivered once in settlement order", () => {
  const delivery = createDeferredResultDelivery<{ id: string }>();
  const first = { id: "sa-1" };
  const second = { id: "sa-2" };

  delivery.defer(first);
  delivery.defer(second);

  assert.deepEqual(delivery.drain(), [first, second]);
  assert.deepEqual(delivery.drain(), []);
});

test("take claims one result and takeAll claims the remaining batch", () => {
  const delivery = createDeferredResultDelivery<{ id: string }>();
  const first = { id: "sa-1" };
  const second = { id: "sa-2" };
  delivery.defer(first);
  delivery.defer(second);

  const claim = delivery.take(first.id);
  assert.equal(claim?.result, first);
  assert.equal(delivery.take(first.id), undefined);
  assert.deepEqual(
    delivery.takeAll().map((item) => item.result),
    [second],
  );
  assert.deepEqual(delivery.takeAll(), []);
});

test("a current claimed result can be restored when no result replaced it", () => {
  const delivery = createDeferredResultDelivery<{ id: string }>();
  const result = { id: "sa-1" };
  delivery.defer(result);
  const claim = delivery.take(result.id)!;

  assert.equal(delivery.restoreIfAbsent(claim), true);
  assert.equal(delivery.restoreIfAbsent(claim), false);
  assert.equal(delivery.take(result.id)?.result, result);
});

test("stale restore is rejected after a newer result was deferred and taken", () => {
  const delivery = createDeferredResultDelivery<{ id: string; value: string }>();
  delivery.defer({ id: "sa-1", value: "old" });
  const old = delivery.take("sa-1")!;
  delivery.defer({ id: "sa-1", value: "new" });
  assert.equal(delivery.take("sa-1")?.result.value, "new");

  assert.equal(delivery.restoreIfAbsent(old), false);
  assert.equal(delivery.take("sa-1"), undefined);
});

test("consumeIf removes only a matching pending result", () => {
  const delivery = createDeferredResultDelivery<{ id: string; value: string }>();
  delivery.defer({ id: "sa-1", value: "new" });

  assert.equal(delivery.consumeIf("sa-1", (result) => result.value === "old"), false);
  assert.equal(delivery.consumeIf("sa-1", (result) => result.value === "new"), true);
  assert.equal(delivery.take("sa-1"), undefined);
});

test("clear removes pending results and generation tombstones", () => {
  const delivery = createDeferredResultDelivery<{ id: string; value: string }>();
  delivery.defer({ id: "sa-1", value: "old" });
  const old = delivery.take("sa-1")!;
  delivery.defer({ id: "sa-1", value: "new" });
  delivery.clear();

  assert.deepEqual(delivery.takeAll(), []);
  assert.equal(delivery.restoreIfAbsent(old), false);
});
