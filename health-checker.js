import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const DEFAULT_BASE_URL = "https://payanagent.com";

export async function fetchOffers({
  baseUrl = DEFAULT_BASE_URL,
  limit = 100,
  pageSize = 100,
  fetchImpl = fetch,
} = {}) {
  const offers = [];
  let cursor;

  while (offers.length < limit) {
    const url = new URL("/api/v1/offers", baseUrl);
    url.searchParams.set("sort", "top");
    url.searchParams.set("limit", String(Math.min(pageSize, limit - offers.length)));
    if (cursor) url.searchParams.set("cursor", cursor);

    const response = await fetchImpl(url, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`Catalog request failed with HTTP ${response.status}`);

    const page = await response.json();
    if (!Array.isArray(page.offers)) throw new Error("Catalog response has no offers array");
    offers.push(...page.offers);
    cursor = page.nextCursor;
    if (!cursor || page.offers.length === 0) break;
  }

  return offers.slice(0, limit);
}

export function classifyStatus(httpCode) {
  if (httpCode >= 200 && httpCode < 400) return "alive";
  if (httpCode >= 400 && httpCode < 500) return "4xx";
  if (httpCode >= 500) return "5xx";
  return "dead";
}

export async function probeOffer(offer, {
  baseUrl = DEFAULT_BASE_URL,
  timeoutMs = 8000,
  fetchImpl = fetch,
} = {}) {
  const endpoint = new URL(offer.buyUrl || `/x402/${offer._id}`, baseUrl).href;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();

  try {
    const response = await fetchImpl(endpoint, {
      method: "OPTIONS",
      redirect: "manual",
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    return {
      offerId: offer._id,
      title: offer.title,
      endpoint,
      status: classifyStatus(response.status),
      httpCode: response.status,
      latencyMs: Math.round(performance.now() - started),
    };
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    return {
      offerId: offer._id,
      title: offer.title,
      endpoint,
      status: timedOut ? "timeout" : "dead",
      httpCode: null,
      latencyMs: Math.round(performance.now() - started),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function mapConcurrent(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function run() {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

export function markdownSummary(results) {
  const counts = Object.create(null);
  for (const result of results) counts[result.status] = (counts[result.status] || 0) + 1;
  const failures = results.filter((result) => result.status !== "alive");
  const lines = [
    "# PayanAgent endpoint health summary",
    "",
    `Checked: ${results.length}`,
    `Alive: ${counts.alive || 0}`,
    `4xx: ${counts["4xx"] || 0}`,
    `5xx: ${counts["5xx"] || 0}`,
    `Timeout: ${counts.timeout || 0}`,
    `Dead: ${counts.dead || 0}`,
    "",
    "## Non-alive endpoints",
    "",
  ];

  if (failures.length === 0) lines.push("None.");
  for (const item of failures) {
    lines.push(`- ${item.offerId} | ${item.status} | HTTP ${item.httpCode ?? "n/a"} | ${item.latencyMs} ms | ${item.endpoint}`);
  }
  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  const values = { limit: 100, concurrency: 10, timeoutMs: 8000, output: "report.json", summary: "summary.md" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--limit") values.limit = Number(argv[++index]);
    else if (arg === "--concurrency") values.concurrency = Number(argv[++index]);
    else if (arg === "--timeout") values.timeoutMs = Number(argv[++index]);
    else if (arg === "--output") values.output = argv[++index];
    else if (arg === "--summary") values.summary = argv[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  for (const key of ["limit", "concurrency", "timeoutMs"]) {
    if (!Number.isInteger(values[key]) || values[key] < 1) throw new Error(`${key} must be a positive integer`);
  }
  return values;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const offers = await fetchOffers({ limit: options.limit });
  const results = await mapConcurrent(offers, options.concurrency, (offer) =>
    probeOffer(offer, { timeoutMs: options.timeoutMs }),
  );
  await Promise.all([
    writeFile(options.output, `${JSON.stringify(results, null, 2)}\n`, "utf8"),
    writeFile(options.summary, markdownSummary(results), "utf8"),
  ]);
  console.log(`Checked ${results.length} endpoints. JSON: ${options.output}; summary: ${options.summary}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
