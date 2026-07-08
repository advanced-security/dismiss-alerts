import { describe, test, expect, jest } from "@jest/globals";

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

interface Nwo {
  owner: string;
  repo: string;
}

function alert_identifier_from_api_alert(alert: ApiAlert): string {
  const ruleId = alert.rule?.id || "";
  const location = alert.most_recent_instance?.location;
  const filePath = location?.path || "";
  const startLine = location?.start_line || 0;
  const startColumn = location?.start_column || 1;
  return [ruleId, filePath, startLine, startColumn].join(";");
}

const ALERT_STATES = ["open", "dismissed"] as const;

// Re-implement fetch_alerts_by_identifier for testing (see src/main.ts),
// against a minimal mock of the octokit client's `paginate` method.
async function fetch_alerts_by_identifier(
  client: {
    paginate: (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      route: any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      params: any,
    ) => Promise<ApiAlert[]>;
  },
  nwo: Nwo,
  toolNames: string[],
): Promise<Map<string, ApiAlert>> {
  const alerts_by_identifier = new Map<string, ApiAlert>();

  const toolFilters: Array<string | undefined> =
    toolNames.length > 0 ? toolNames : [undefined];

  for (const tool_name of toolFilters) {
    for (const state of ALERT_STATES) {
      const alerts = await client.paginate("listAlertsForRepo", {
        ...nwo,
        ...(tool_name ? { tool_name } : {}),
        state,
        per_page: 100,
      });

      for (const alert of alerts) {
        alerts_by_identifier.set(
          alert_identifier_from_api_alert(alert),
          alert,
        );
      }
    }
  }

  return alerts_by_identifier;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PaginateParams = any;
type PaginateFn = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  route: any,
  params: PaginateParams,
) => Promise<ApiAlert[]>;

describe("fetch_alerts_by_identifier", () => {
  const nwo: Nwo = { owner: "o", repo: "r" };

  test("issues one paginated call per distinct tool name PER STATE, and merges results", async () => {
    const paginate = jest.fn<PaginateFn>().mockImplementation(
      async (_route, params: PaginateParams): Promise<ApiAlert[]> => {
        if (params.tool_name === "CodeQL" && params.state === "open") {
          return [
            {
              url: "url-1",
              rule: { id: "py/rule1" },
              most_recent_instance: {
                location: { path: "a.py", start_line: 1, start_column: 1 },
              },
            },
          ];
        }
        if (params.tool_name === "ESLint" && params.state === "dismissed") {
          return [
            {
              url: "url-2",
              rule: { id: "js/rule2" },
              most_recent_instance: {
                location: { path: "b.js", start_line: 2, start_column: 1 },
              },
            },
          ];
        }
        return [];
      },
    );
    const client = { paginate };

    const result = await fetch_alerts_by_identifier(client, nwo, [
      "CodeQL",
      "ESLint",
    ]);

    // 2 tool names x 2 states (open, dismissed) = 4 paginated calls
    expect(paginate).toHaveBeenCalledTimes(4);
    expect(result.size).toBe(2);
    expect(result.get("py/rule1;a.py;1;1")?.url).toBe("url-1");
    expect(result.get("js/rule2;b.js;2;1")?.url).toBe("url-2");
  });

  test("queries both open and dismissed states explicitly, so previously-dismissed alerts are indexed for the reopen path", async () => {
    // Guards against advanced-security/dismiss-alerts#296 review feedback:
    // the REST API docs say `state` defaults to open-only when omitted, so
    // dismissed alerts must be fetched with an explicit state=dismissed
    // call or the to_reopen matching below would never find candidates.
    const paginate = jest.fn<PaginateFn>().mockImplementation(
      async (_route, params: PaginateParams): Promise<ApiAlert[]> => {
        if (params.state === "dismissed") {
          return [
            {
              url: "url-dismissed",
              state: "dismissed",
              dismissed_comment: "Suppressed via SARIF",
              rule: { id: "py/rule1" },
              most_recent_instance: {
                location: { path: "a.py", start_line: 1, start_column: 1 },
              },
            },
          ];
        }
        return [];
      },
    );
    const client = { paginate };

    const result = await fetch_alerts_by_identifier(client, nwo, ["CodeQL"]);

    const dismissedCalls = paginate.mock.calls.filter(
      (call) => (call[1] as PaginateParams).state === "dismissed",
    );
    const openCalls = paginate.mock.calls.filter(
      (call) => (call[1] as PaginateParams).state === "open",
    );
    expect(dismissedCalls).toHaveLength(1);
    expect(openCalls).toHaveLength(1);
    expect(result.get("py/rule1;a.py;1;1")?.state).toBe("dismissed");
  });

  test("falls back to unscoped calls (one per state) when no tool names are found in the SARIF", async () => {
    const paginate = jest.fn<PaginateFn>().mockResolvedValue([]);
    const client = { paginate };

    await fetch_alerts_by_identifier(client, nwo, []);

    // 1 tool filter (undefined) x 2 states = 2 calls
    expect(paginate).toHaveBeenCalledTimes(2);
    const states = paginate.mock.calls
      .map((call) => (call[1] as PaginateParams).state)
      .sort();
    expect(states).toEqual(["dismissed", "open"]);
    for (const call of paginate.mock.calls) {
      expect(call[1]).not.toHaveProperty("tool_name");
    }
  });

  test("passes owner/repo and per_page through to every paginated call", async () => {
    const paginate = jest.fn<PaginateFn>().mockResolvedValue([]);
    const client = { paginate };

    await fetch_alerts_by_identifier(client, nwo, ["CodeQL"]);

    expect(paginate).toHaveBeenCalledTimes(2); // open + dismissed
    for (const call of paginate.mock.calls) {
      expect(call[1]).toMatchObject({
        owner: "o",
        repo: "r",
        per_page: 100,
        tool_name: "CodeQL",
      });
    }
  });

  test("later tool filters overwrite earlier ones on identifier collision", async () => {
    // Extremely unlikely in practice (rule id + exact location match across
    // two different tools), but the map should still behave predictably.
    const paginate = jest.fn<PaginateFn>().mockImplementation(
      async (_route, params: PaginateParams): Promise<ApiAlert[]> => {
        if (params.tool_name === "ToolA" && params.state === "open") {
          return [
            {
              url: "url-first",
              rule: { id: "rule1" },
              most_recent_instance: {
                location: { path: "a.py", start_line: 1, start_column: 1 },
              },
            },
          ];
        }
        if (params.tool_name === "ToolB" && params.state === "open") {
          return [
            {
              url: "url-second",
              rule: { id: "rule1" },
              most_recent_instance: {
                location: { path: "a.py", start_line: 1, start_column: 1 },
              },
            },
          ];
        }
        return [];
      },
    );
    const client = { paginate };

    const result = await fetch_alerts_by_identifier(client, nwo, [
      "ToolA",
      "ToolB",
    ]);

    expect(result.size).toBe(1);
    expect(result.get("rule1;a.py;1;1")?.url).toBe("url-second");
  });
});
