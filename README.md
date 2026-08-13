# PayanAgent endpoint health checker

Dependency-free Node.js script that fetches the top PayanAgent offers, follows the catalog cursor, and probes each public `buyUrl` with `OPTIONS`. It never sends a payment header and therefore makes no paid calls.

## Run

```bash
npm test
npm run check
```

Optional arguments:

```bash
node health-checker.js --limit 100 --concurrency 10 --timeout 8000 --output report.json --summary summary.md
```

The JSON output is an array of:

```json
{
  "offerId": "offer id",
  "title": "offer title",
  "endpoint": "absolute public buy URL",
  "status": "alive | dead | timeout | 4xx | 5xx",
  "httpCode": 204,
  "latencyMs": 123
}
```

`summary.md` contains totals and a concise list of every non-alive endpoint.

## Live feed

`feed.json` is a machine-readable snapshot with generation time, aggregate status counts, and all checked endpoints. A GitHub Actions workflow validates the code and refreshes this feed every six hours.
