import { writeFile } from "node:fs/promises";
import { fetchOffers, mapConcurrent, probeOffer } from "./health-checker.js";

const offers = await fetchOffers({ limit: 100 });
const results = await mapConcurrent(offers, 10, (offer) =>
  probeOffer(offer, { timeoutMs: 8000 }),
);

const statusCounts = Object.fromEntries(
  ["alive", "dead", "timeout", "4xx", "5xx"].map((status) => [
    status,
    results.filter((result) => result.status === status).length,
  ]),
);

const feed = {
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  source: "https://payanagent.com/api/v1/offers?sort=top&limit=100",
  method: "OPTIONS probes only; no payment headers or paid calls",
  checked: results.length,
  statusCounts,
  results,
};

await writeFile("feed.json", `${JSON.stringify(feed, null, 2)}\n`, "utf8");
console.log(`Generated feed.json with ${results.length} endpoint checks.`);
