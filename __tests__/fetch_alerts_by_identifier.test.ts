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
    const alerts = await client.paginate("listAlertsForRepo", {
      ...nwo,
      ...(tool_name ? { tool_name } : {}),
      per_page: 100,
    });

    for (const alert of alerts) {
      alerts_by_identifier.set(alert_identifier_from_api_alert(alert), alert);
    }
  }

  return alerts_by_identifier;
}

describe("fetch_alerts_by_identifier", () => {
  const nwo: Nwo = { owner: "o", repo: "r" };

  test("issues one paginated call per distinct tool name and merges results", async () => {
    const paginate = jest
      .fn<
        (
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          route: any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          params: any,
        ) => Promise<ApiAlert[]>
      >()
      .mockResolvedValueOnce([
        {
          url: "url-1",
          rule: { id: "py/rule1" },
          most_recent_instance: {
            location: { path: "a.py", start_line: 1, start_column: 1 },
          },
        },
      ])
      .mockResolvedValueOnce([
        {
          url: "url-2",
          rule: { id: "js/rule2" },
          most_recent_instance: {
            location: { path: "b.js", start_line: 2, start_column: 1 },
          },
        },
      ]);
    const client = { paginate };

    const result = await fetch_alerts_by_identifier(client, nwo, [
      "CodeQL",
      "ESLint",
    ]);

    expect(paginate).toHaveBeenCalledTimes(2);
    expect(paginate.mock.calls[0][1]).toMatchObject({ tool_name: "CodeQL" });
    expect(paginate.mock.calls[1][1]).toMatchObject({ tool_name: "ESLint" });
    expect(result.size).toBe(2);
    expect(result.get("py/rule1;a.py;1;1")?.url).toBe("url-1");
    expect(result.get("js/rule2;b.js;2;1")?.url).toBe("url-2");
  });

  test("falls back to a single unscoped call when no tool names are found in the SARIF", async () => {
    const paginate = jest
      .fn<
        (
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          route: any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          params: any,
        ) => Promise<ApiAlert[]>
      >()
      .mockResolvedValueOnce([]);
    const client = { paginate };

    await fetch_alerts_by_identifier(client, nwo, []);

    expect(paginate).toHaveBeenCalledTimes(1);
    expect(paginate.mock.calls[0][1]).not.toHaveProperty("tool_name");
  });

  test("passes owner/repo and per_page through to every paginated call", async () => {
    const paginate = jest
      .fn<
        (
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          route: any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          params: any,
        ) => Promise<ApiAlert[]>
      >()
      .mockResolvedValueOnce([]);
    const client = { paginate };

    await fetch_alerts_by_identifier(client, nwo, ["CodeQL"]);

    expect(paginate.mock.calls[0][1]).toMatchObject({
      owner: "o",
      repo: "r",
      per_page: 100,
    });
  });

  test("later tool filters overwrite earlier ones on identifier collision", async () => {
    // Extremely unlikely in practice (rule id + exact location match across
    // two different tools), but the map should still behave predictably.
    const paginate = jest
      .fn<
        (
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          route: any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          params: any,
        ) => Promise<ApiAlert[]>
      >()
      .mockResolvedValueOnce([
        {
          url: "url-first",
          rule: { id: "rule1" },
          most_recent_instance: {
            location: { path: "a.py", start_line: 1, start_column: 1 },
          },
        },
      ])
      .mockResolvedValueOnce([
        {
          url: "url-second",
          rule: { id: "rule1" },
          most_recent_instance: {
            location: { path: "a.py", start_line: 1, start_column: 1 },
          },
        },
      ]);
    const client = { paginate };

    const result = await fetch_alerts_by_identifier(client, nwo, [
      "ToolA",
      "ToolB",
    ]);

    expect(result.size).toBe(1);
    expect(result.get("rule1;a.py;1;1")?.url).toBe("url-second");
  });
});
