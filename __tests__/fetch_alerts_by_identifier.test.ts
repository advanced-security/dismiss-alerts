import { describe, test, expect, jest } from "@jest/globals";
import {
  fetch_alerts_by_identifier,
  ApiAlert,
  Nwo,
  GitHubClient,
} from "../src/main.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PaginateParams = any;
type PaginateFn = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  route: any,
  params: PaginateParams,
) => Promise<ApiAlert[]>;

// Minimal mock of the octokit client's `paginate` method (and the
// `rest.codeScanning.listAlertsForRepo` route it's called with), cast to
// the real GitHubClient type since fetch_alerts_by_identifier only calls
// client.paginate(client.rest.codeScanning.listAlertsForRepo, params).
function makeClient(paginate: PaginateFn): GitHubClient {
  return {
    paginate,
    rest: { codeScanning: { listAlertsForRepo: {} } },
  } as unknown as GitHubClient;
}

describe("fetch_alerts_by_identifier", () => {
  const nwo: Nwo = { owner: "o", repo: "r" };

  test("issues one paginated call per distinct tool name PER STATE, and merges results", async () => {
    const paginate = jest
      .fn<PaginateFn>()
      .mockImplementation(
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
    const client = makeClient(paginate);

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
    const paginate = jest
      .fn<PaginateFn>()
      .mockImplementation(
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
    const client = makeClient(paginate);

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
    const client = makeClient(paginate);

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
    const client = makeClient(paginate);

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
    const paginate = jest
      .fn<PaginateFn>()
      .mockImplementation(
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
    const client = makeClient(paginate);

    const result = await fetch_alerts_by_identifier(client, nwo, [
      "ToolA",
      "ToolB",
    ]);

    expect(result.size).toBe(1);
    expect(result.get("rule1;a.py;1;1")?.url).toBe("url-second");
  });
});
