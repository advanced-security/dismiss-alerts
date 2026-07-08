import { describe, test, expect } from "@jest/globals";

interface ApiAlert {
  url: string;
  state?: "open" | "dismissed" | "fixed" | null;
  dismissed_comment?: string | null;
}

const SUPPRESSED_VIA_SARIF = "Suppressed via SARIF";

// Re-implement match_alerts for testing (see src/main.ts)
function match_alerts(
  should_be_dismissed: Set<string>,
  predicate: (alert: ApiAlert) => boolean,
  alerts_by_identifier: Map<string, ApiAlert>,
): string[] {
  const alerts: string[] = [];
  for (const identifier of should_be_dismissed) {
    const alert = alerts_by_identifier.get(identifier);
    if (alert != null && predicate(alert)) {
      alerts.push(alert.url);
    }
  }
  return alerts;
}

describe("match_alerts", () => {
  test("returns the alert url when the identifier matches and the predicate passes", () => {
    const alerts = new Map<string, ApiAlert>([
      ["rule1;a.py;1;1", { url: "url-1", state: "open" }],
    ]);
    const result = match_alerts(
      new Set(["rule1;a.py;1;1"]),
      (alert) => alert.state !== "dismissed",
      alerts,
    );
    expect(result).toEqual(["url-1"]);
  });

  test("skips identifiers with no matching live alert (e.g. alert was deleted/not yet indexed)", () => {
    const alerts = new Map<string, ApiAlert>();
    const result = match_alerts(new Set(["rule1;a.py;1;1"]), () => true, alerts);
    expect(result).toEqual([]);
  });

  test("skips matches that fail the predicate", () => {
    const alerts = new Map<string, ApiAlert>([
      ["rule1;a.py;1;1", { url: "url-1", state: "dismissed" }],
    ]);
    const result = match_alerts(
      new Set(["rule1;a.py;1;1"]),
      (alert) => alert.state !== "dismissed",
      alerts,
    );
    expect(result).toEqual([]);
  });

  test("returns multiple matching alert urls", () => {
    const alerts = new Map<string, ApiAlert>([
      ["rule1;a.py;1;1", { url: "url-1", state: "open" }],
      ["rule2;b.py;2;1", { url: "url-2", state: "open" }],
    ]);
    const result = match_alerts(
      new Set(["rule1;a.py;1;1", "rule2;b.py;2;1"]),
      (alert) => alert.state !== "dismissed",
      alerts,
    );
    expect(result.sort()).toEqual(["url-1", "url-2"]);
  });

  test("returns an empty array when should_be_dismissed is empty", () => {
    const alerts = new Map<string, ApiAlert>([
      ["rule1;a.py;1;1", { url: "url-1", state: "open" }],
    ]);
    expect(match_alerts(new Set(), () => true, alerts)).toEqual([]);
  });

  test("to_dismiss predicate: matches suppressed results that are still open", () => {
    const alerts = new Map<string, ApiAlert>([
      ["rule1;a.py;1;1", { url: "url-1", state: "open" }],
      ["rule2;b.py;2;1", { url: "url-2", state: "dismissed" }],
    ]);
    const result = match_alerts(
      new Set(["rule1;a.py;1;1", "rule2;b.py;2;1"]),
      (alert) => alert.state !== "dismissed",
      alerts,
    );
    expect(result).toEqual(["url-1"]);
  });

  test("to_reopen predicate: only matches alerts previously dismissed by this action", () => {
    const alerts = new Map<string, ApiAlert>([
      [
        "rule1;a.py;1;1",
        {
          url: "url-1",
          state: "dismissed",
          dismissed_comment: SUPPRESSED_VIA_SARIF,
        },
      ],
      [
        "rule2;b.py;2;1",
        { url: "url-2", state: "dismissed", dismissed_comment: "false positive" },
      ],
    ]);
    const result = match_alerts(
      new Set(["rule1;a.py;1;1", "rule2;b.py;2;1"]),
      (alert) =>
        alert.state === "dismissed" &&
        alert.dismissed_comment === SUPPRESSED_VIA_SARIF,
      alerts,
    );
    expect(result).toEqual(["url-1"]);
  });
});
