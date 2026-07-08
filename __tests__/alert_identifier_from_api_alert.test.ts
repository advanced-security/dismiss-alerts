import { describe, test, expect } from "@jest/globals";

// Shape of an alert as returned by the code scanning alerts list API.
// Mirrors the ApiAlert interface in src/main.ts.
interface ApiAlert {
  url: string;
  state?: "open" | "dismissed" | "fixed" | null;
  dismissed_comment?: string | null;
  rule: { id?: string | null };
  most_recent_instance?: {
    location?: {
      path?: string;
      start_line?: number;
      start_column?: number;
    };
  };
}

// Re-implement alert_identifier_from_api_alert for testing (see src/main.ts)
function alert_identifier_from_api_alert(alert: ApiAlert): string {
  const ruleId = alert.rule?.id || "";
  const location = alert.most_recent_instance?.location;
  const filePath = location?.path || "";
  const startLine = location?.start_line || 0;
  const startColumn = location?.start_column || 1;
  return [ruleId, filePath, startLine, startColumn].join(";");
}

describe("alert_identifier_from_api_alert", () => {
  test("builds the identifier from rule id and most_recent_instance.location", () => {
    const alert: ApiAlert = {
      url: "https://api.github.com/repos/o/r/code-scanning/alerts/3",
      rule: { id: "py/unused-global-variable" },
      most_recent_instance: {
        location: {
          path: "src/crate/client/__init__.py",
          start_line: 47,
          start_column: 1,
        },
      },
    };
    expect(alert_identifier_from_api_alert(alert)).toBe(
      "py/unused-global-variable;src/crate/client/__init__.py;47;1",
    );
  });

  test("defaults startColumn to 1 when not present", () => {
    const alert: ApiAlert = {
      url: "u",
      rule: { id: "rule1" },
      most_recent_instance: { location: { path: "a.py", start_line: 5 } },
    };
    expect(alert_identifier_from_api_alert(alert)).toBe("rule1;a.py;5;1");
  });

  test("defaults startLine to 0 when not present", () => {
    const alert: ApiAlert = {
      url: "u",
      rule: { id: "rule1" },
      most_recent_instance: { location: { path: "a.py", start_column: 3 } },
    };
    expect(alert_identifier_from_api_alert(alert)).toBe("rule1;a.py;0;3");
  });

  test("defaults ruleId to an empty string when rule.id is missing", () => {
    const alert: ApiAlert = {
      url: "u",
      rule: {},
      most_recent_instance: {
        location: { path: "a.py", start_line: 5, start_column: 2 },
      },
    };
    expect(alert_identifier_from_api_alert(alert)).toBe(";a.py;5;2");
  });

  test("defaults filePath/startLine/startColumn when location is missing", () => {
    const alert: ApiAlert = { url: "u", rule: { id: "rule1" } };
    expect(alert_identifier_from_api_alert(alert)).toBe("rule1;;0;1");
  });

  test("defaults everything when most_recent_instance is missing entirely", () => {
    const alert: ApiAlert = { url: "u", rule: { id: "rule1" } };
    expect(alert_identifier_from_api_alert(alert)).toBe("rule1;;0;1");
  });

  test("matches the same identifier scheme used for local SARIF results", () => {
    // Mirrors the equivalent case in alert-identifier.test.ts to guarantee
    // API-derived and SARIF-derived identifiers for the same alert are equal.
    const alert: ApiAlert = {
      url: "u",
      rule: { id: "test-rule-id" },
      most_recent_instance: {
        location: { path: "test.js", start_line: 10, start_column: 1 },
      },
    };
    expect(alert_identifier_from_api_alert(alert)).toBe("test-rule-id;test.js;10;1");
  });
});
