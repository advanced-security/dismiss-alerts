import * as core from "@actions/core";
import * as github from "@actions/github";
import { GitHub, getOctokitOptions } from "@actions/github/lib/utils";
import * as retry from "@octokit/plugin-retry";
import consoleLogLevel from "console-log-level";
import * as fs from "fs";
import * as path from "path";

const SUPPRESSED_VIA_SARIF = "Suppressed via SARIF";

type GitHubClient = InstanceType<typeof GitHub>;
interface SarifFile {
  version?: string | null;
  runs: Array<SarifRun>;
}

interface SarifRun {
  tool?: {
    driver?: {
      name?: string;
      rules?: Array<SarifRule>;
    };
    extensions?: Array<{
      rules?: Array<SarifRule>;
    }>;
    automationDetails?: {
      id?: string;
    };
  };
  artifacts?: string[];
  results?: SarifResult[];
}

interface SarifRule {
  id: string;
  index: number;
  toolComponent: { index: number };
}

interface SarifRuleReference {
  id?: string;
  index: number;
  toolComponent: { index: number };
}

interface SarifResult {
  properties?: {
    "github/alertUrl": string;
  };
  locations: Array<{
    physicalLocation: {
      artifactLocation: {
        uri: string;
      };
      region?: {
        startLine?: number;
        startColumn?: number;
      };
    };
  }>;
  partialFingerprints: {
    primaryLocationLineHash?: string;
  };
  rule: SarifRuleReference;
  ruleId?: string;
  suppressions: Array<{ kind: string }>;
}

interface Nwo {
  owner: string;
  repo: string;
}

interface PatchPayload {
  state: "open" | "dismissed";
  dismissed_reason?: string;
  dismissed_comment?: string;
}

type AlertIdentifier = string;
/**
 * Get an environment parameter, but throw an error if it is not set.
 */
function getRequiredEnvParam(paramName: string): string {
  const value = process.env[paramName];
  if (value === undefined || value.length === 0) {
    throw new Error(`${paramName} environment variable must be set`);
  }
  return value;
}

/**
 * Check if a filename is a SARIF file based on extension.
 */
function isSarifFile(filename: string): boolean {
  return filename.endsWith(".sarif") || filename.endsWith(".sarif.json");
}

/**
 * Recursively find all SARIF files in a directory.
 * Does not follow symlinks.
 */
function findSarifFilesInDir(dirPath: string): string[] {
  const sarifFiles: string[] = [];

  const walkDirectory = (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.resolve(dir, entry.name);
      if (entry.isFile() && isSarifFile(entry.name)) {
        sarifFiles.push(fullPath);
      } else if (entry.isDirectory()) {
        walkDirectory(fullPath);
      }
    }
  };

  walkDirectory(dirPath);
  return sarifFiles;
}

/**
 * Get SARIF file paths from a file or directory.
 * Returns an array of file paths.
 */
function getSarifFilePaths(sarifPath: string): string[] {
  if (!fs.existsSync(sarifPath)) {
    throw new Error(`Path does not exist: ${sarifPath}`);
  }

  const stats = fs.lstatSync(sarifPath);
  if (stats.isDirectory()) {
    const sarifFiles = findSarifFilesInDir(sarifPath);
    if (sarifFiles.length === 0) {
      throw new Error(`No SARIF files found in directory: ${sarifPath}`);
    }
    return sarifFiles;
  } else if (stats.isFile()) {
    return [sarifPath];
  } else {
    throw new Error(`Path is neither a file nor a directory: ${sarifPath}`);
  }
}

/**
 * Merge multiple SARIF files into a single SARIF object.
 * Combines all runs from all files.
 */
function mergeSarifFiles(sarifFiles: string[]): SarifFile {
  const mergedSarif: SarifFile = {
    version: "2.1.0",
    runs: [],
  };

  for (const filePath of sarifFiles) {
    let sarifContent;
    try {
      sarifContent = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
      throw new Error(
        `Failed to parse SARIF file '${filePath}': ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (mergedSarif.version === "2.1.0" && sarifContent.version) {
      mergedSarif.version = sarifContent.version;
    }
    if (sarifContent.runs) {
      mergedSarif.runs.push(...sarifContent.runs);
    }
  }

  return mergedSarif;
}

async function patch_alert(
  client: GitHubClient,
  url: string,
  payload: PatchPayload,
) {
  try {
    await client.request({
      method: "PATCH",
      url: url,
      data: payload,
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (error: unknown) {
    // If the alert is already dismissed, we can safely ignore the error
    // GitHub API returns status 400 with "Alert is already dismissed" message
    if (
      error &&
      typeof error === "object" &&
      "message" in error &&
      typeof error.message === "string" &&
      "status" in error &&
      error.status === 400 &&
      error.message.includes("Alert is already dismissed")
    ) {
      console.debug(`Alert already dismissed: ${url}`);
      return;
    }
    // Re-throw any other errors
    throw error;
  }
}

/**
 * Get the distinct set of tool names (e.g. "CodeQL", or any other SARIF
 * producer) that appear in a SARIF file's runs. dismiss-alerts is not
 * CodeQL-specific, so this must be read from the SARIF itself rather than
 * assumed - it's used to scope the code scanning alerts API lookup below.
 */
function get_tool_names(sarif: SarifFile): string[] {
  const names = new Set<string>();
  for (const run of sarif.runs) {
    const name = run.tool?.driver?.name;
    if (name) {
      names.add(name);
    }
  }
  return [...names];
}

function get_rules_from_run(run: SarifRun) {
  const rules = [];

  // Index 0: driver rules
  const driver_rules = [];
  for (const rule of run.tool?.driver?.rules || []) {
    driver_rules.push(rule.id);
  }
  rules.push(driver_rules);

  // Index 1+: extension rules
  for (const ext of run.tool?.extensions || []) {
    const ext_rules = [];
    for (const rule of ext.rules || []) {
      ext_rules.push(rule.id);
    }
    rules.push(ext_rules);
  }

  return rules;
}

/**
 * Shape of an alert as returned by the code scanning alerts list API
 * (GET /repos/{owner}/{repo}/code-scanning/alerts). Only the fields we
 * actually use are declared here.
 */
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

/**
 * Build the same `ruleId;filePath;startLine;startColumn` identifier used for
 * local SARIF results (see alert_identifier), but from an alerts-list API
 * alert instead. This lets us match alerts without re-fetching the analysis
 * as a SARIF export, which is the racy call this whole approach avoids.
 */
function alert_identifier_from_api_alert(alert: ApiAlert): AlertIdentifier {
  const ruleId = alert.rule?.id || "";
  const location = alert.most_recent_instance?.location;
  const filePath = location?.path || "";
  const startLine = location?.start_line || 0;
  const startColumn = location?.start_column || 1;
  return [ruleId, filePath, startLine, startColumn].join(";");
}

// We need both open alerts (to dismiss) and dismissed alerts (to detect
// re-opens). The `state` query param only accepts a single value, and its
// default is not reliably "all states" across API versions - the REST API
// reference documents it as defaulting to open alerts only - so each state
// we care about is requested explicitly rather than depending on whatever
// the default happens to do.
const ALERT_STATES = ["open", "dismissed"] as const;

/**
 * Fetch all code scanning alerts for the repository, optionally scoped to
 * one or more tool names (extracted from the local SARIF - never
 * hardcoded, since dismiss-alerts supports any SARIF-producing tool), and
 * index them by the same identifier scheme used for local SARIF results.
 *
 * Queries both "open" and "dismissed" states explicitly (see ALERT_STATES)
 * so that both the to-dismiss and to-reopen matching below have the alert
 * data they need, regardless of the API's default `state` filtering.
 */
async function fetch_alerts_by_identifier(
  client: GitHubClient,
  nwo: Nwo,
  toolNames: string[],
): Promise<Map<AlertIdentifier, ApiAlert>> {
  const alerts_by_identifier = new Map<AlertIdentifier, ApiAlert>();

  // If we couldn't determine a tool name from the SARIF (unexpected, but
  // defensive), fall back to an unscoped fetch of all alerts.
  const toolFilters: Array<string | undefined> =
    toolNames.length > 0 ? toolNames : [undefined];

  for (const tool_name of toolFilters) {
    for (const state of ALERT_STATES) {
      core.info(
        tool_name
          ? `Fetching ${state} code scanning alerts for tool: ${tool_name}`
          : `Fetching ${state} code scanning alerts (no tool name found in SARIF; unscoped)`,
      );
      const alerts = (await client.paginate(
        client.rest.codeScanning.listAlertsForRepo,
        {
          ...nwo,
          ...(tool_name ? { tool_name } : {}),
          state,
          per_page: 100,
        },
      )) as unknown as ApiAlert[];

      for (const alert of alerts) {
        alerts_by_identifier.set(
          alert_identifier_from_api_alert(alert),
          alert,
        );
      }
    }
  }

  core.info(
    `Indexed ${alerts_by_identifier.size} code scanning alert(s) across ${toolFilters.length} tool filter(s) and ${ALERT_STATES.length} state filter(s)`,
  );
  return alerts_by_identifier;
}

function match_alerts(
  should_be_dismissed: Set<AlertIdentifier>,
  predicate: (alert: ApiAlert) => boolean,
  alerts_by_identifier: Map<AlertIdentifier, ApiAlert>,
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

function alert_identifier(
  rules: Array<Array<string>>,
  result: SarifResult,
): AlertIdentifier {
  let ruleId;
  if ("ruleId" in result) {
    ruleId = result.ruleId;
  } else if ("id" in result.rule) {
    ruleId = result.rule.id;
  } else {
    const toolComponentIndex =
      "toolComponent" in result.rule ? result.rule.toolComponent.index + 1 : 0;
    const ruleIndex = result.rule.index;
    ruleId = rules[toolComponentIndex][ruleIndex];
  }
  const physicalLocation = result.locations[0].physicalLocation;
  const filePath = physicalLocation.artifactLocation.uri;
  const startLine = physicalLocation.region?.startLine || 0;
  const startColumn = physicalLocation.region?.startColumn || 1;
  return [ruleId, filePath, startLine, startColumn].join(";");
}

function split_alerts(sarif: SarifFile) {
  const normal = new Set<AlertIdentifier>();
  const suppressed = new Set<AlertIdentifier>();

  for (const run of sarif.runs) {
    const rules = get_rules_from_run(run);

    for (const result of run.results || []) {
      if (result.suppressions != null && result.suppressions.length > 0) {
        suppressed.add(alert_identifier(rules, result));
      } else {
        normal.add(alert_identifier(rules, result));
      }
    }
  }
  return [normal, suppressed];
}

async function wait_for_upload(
  client: GitHubClient,
  nwo: Nwo,
  sarif_id: string,
) {
  for (let i = 0; i < 10; i++) {
    if (i > 0) {
      await new Promise((r) => setTimeout(r, 5000 * i));
    }
    let response;
    try {
      response = await client.rest.codeScanning.getSarif({
        ...nwo,
        sarif_id,
      });
    } catch (error) {
      console.warn(error);
      continue;
    }
    const upload_status = response.data;
    if (upload_status.processing_status == "complete") {
      if (upload_status.analyses_url != null) {
        return upload_status.analyses_url;
      }
      throw Error((upload_status.errors || []).join("\n"));
    }
  }
  throw Error(`Processing of upload is taking too long: ${sarif_id}`);
}

/* Run codeql analyze (or any other SARIF-producing tool) with suppression
 * queries in addition to normal ones.
 * Upload the SARIF file and get the sarif-upload-id.
 * Use sarif-upload-id to check and wait until upload is processed.
 * Parse the *local* SARIF file (the one we just uploaded) to find:
 *   - alerts with non-empty `suppressions[]` (candidates to dismiss)
 *   - alerts with no suppressions (candidates to re-open)
 * Fetch the current code scanning alerts via the REST API (scoped to the
 * tool name(s) found in the local SARIF - never hardcoded, since
 * dismiss-alerts is not CodeQL-specific), and match them to the local SARIF
 * results by rule + location. This intentionally avoids re-fetching the
 * analysis as a SARIF export (a separate, asynchronously-computed artifact
 * that can lag arbitrarily far behind upload completion - see
 * advanced-security/dismiss-alerts#295).
 * For each matched alert, make a PATCH request to set the dismissal state
 * and reason.
 */

export async function run(): Promise<void> {
  const sarif_id = core.getInput("sarif-id", { required: true });
  const sarifPath = core.getInput("sarif-file", { required: true });
  const api_token =
    core.getInput("token") || getRequiredEnvParam("GITHUB_TOKEN");

  const apiURL = getRequiredEnvParam("GITHUB_API_URL");

  const retryingOctokit = GitHub.plugin(retry.retry);
  const client = new retryingOctokit(
    getOctokitOptions(api_token, {
      baseUrl: apiURL,
      userAgent: "dismiss-alerts",
      log: consoleLogLevel({ level: "debug" }),
    }),
  );
  const nwo = github.context.repo;

  // Confirms the upload finished processing without errors. We deliberately
  // do NOT use this to re-fetch the analysis as a SARIF export - that export
  // is racy (see advanced-security/dismiss-alerts#295) - we match against
  // the alerts API instead, below.
  await wait_for_upload(client, nwo, sarif_id);

  // Get SARIF file paths (supports both file and directory)
  const sarifFiles = getSarifFilePaths(sarifPath);
  core.debug(`Found ${sarifFiles.length} SARIF file(s) to process`);

  // Merge all SARIF files into a single object
  const sarif1 = mergeSarifFiles(sarifFiles);

  const [normal, suppressed] = split_alerts(sarif1);

  // Scope the alerts lookup to whichever tool(s) produced this SARIF -
  // read from the SARIF itself, since dismiss-alerts supports any
  // SARIF-producing tool, not just CodeQL.
  const toolNames = get_tool_names(sarif1);
  const alerts_by_identifier = await fetch_alerts_by_identifier(
    client,
    nwo,
    toolNames,
  );

  const to_dismiss = match_alerts(
    suppressed,
    (alert) => alert.state !== "dismissed",
    alerts_by_identifier,
  );

  for (const alert of to_dismiss) {
    console.debug(`Dismissing alert: ${alert}`);
    const payload: PatchPayload = {
      state: "dismissed",
      dismissed_reason: "won't fix",
      dismissed_comment: SUPPRESSED_VIA_SARIF,
    };
    await patch_alert(client, alert, payload);
  }

  const to_reopen = match_alerts(
    normal,
    (alert) =>
      alert.state === "dismissed" &&
      alert.dismissed_comment === SUPPRESSED_VIA_SARIF,
    alerts_by_identifier,
  );

  for (const alert of to_reopen) {
    console.debug(`Re-opening alert: ${alert}`);
    const payload: PatchPayload = {
      state: "open",
    };
    await patch_alert(client, alert, payload);
  }
}

void run();
