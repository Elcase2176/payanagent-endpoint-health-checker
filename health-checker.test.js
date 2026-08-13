import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyStatus,
  fetchOffers,
  mapConcurrent,
  markdownSummary,
  probeOffer,
} from "./health-checker.js";

test("fetchOffers follows cursors and respects the requested limit", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(String(url));
    const secondPage = new URL(url).searchParams.has("cursor");
    return new Response(JSON.stringify(secondPage
      ? { offers: [{ _id: "3" }, { _id: "4" }], nextCursor: null }
      : { offers: [{ _id: "1" }, { _id: "2" }], nextCursor: "next" }),
    { status: 200, headers: { "content-type": "application/json" } });
  };
  const offers = await fetchOffers({ baseUrl: "https://example.test", limit: 3, pageSize: 2, fetchImpl });
  assert.deepEqual(offers.map((offer) => offer._id), ["1", "2", "3"]);
  assert.equal(urls.length, 2);
});

test("probeOffer uses OPTIONS and classifies the response", async () => {
  let method;
  const result = await probeOffer(
    { _id: "abc", title: "Example", buyUrl: "/x402/abc" },
    {
      baseUrl: "https://example.test",
      fetchImpl: async (_url, options) => {
        method = options.method;
        return new Response(null, { status: 204 });
      },
    },
  );
  assert.equal(method, "OPTIONS");
  assert.equal(result.status, "alive");
  assert.equal(result.httpCode, 204);
});

test("status classification covers required output buckets", () => {
  assert.equal(classifyStatus(204), "alive");
  assert.equal(classifyStatus(402), "4xx");
  assert.equal(classifyStatus(503), "5xx");
});

test("mapConcurrent preserves input order", async () => {
  const values = await mapConcurrent([3, 1, 2], 2, async (value) => {
    await new Promise((resolve) => setTimeout(resolve, value));
    return value * 2;
  });
  assert.deepEqual(values, [6, 2, 4]);
});

test("markdownSummary lists non-alive endpoints", () => {
  const text = markdownSummary([
    { offerId: "ok", status: "alive", httpCode: 204, latencyMs: 1, endpoint: "https://x/ok" },
    { offerId: "bad", status: "5xx", httpCode: 503, latencyMs: 2, endpoint: "https://x/bad" },
  ]);
  assert.match(text, /Alive: 1/);
  assert.match(text, /bad \| 5xx \| HTTP 503/);
});
