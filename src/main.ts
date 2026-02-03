import * as retry from "@octokit/plugin-retry";
import consoleLogLevel from "console-log-level";
import * as fs from "fs";
import * as path from "path";

const SUPPRESSED_VIA_SARIF = "Suppressed via SARIF";

// Dynamic imports for ESM-only @actions packages
let core: typeof import("@actions/core");
let github: typeof import("@actions/github");
let GitHub: typeof import("@actions/github/lib/utils").GitHub;
let getOctokitOptions: typeof import("@actions/github/lib/utils").getOctokitOptions;
let modulesLoaded = false;

async function loadActionModules() {
  if (modulesLoaded) {
    return;
  }
  const coreModule = await import("@actions/core");
  const githubModule = await import("@actions/github");
  const utilsModule = await import("@actions/github/lib/utils");
  core = coreModule;
  github = githubModule;
  GitHub = utilsModule.GitHub;
  getOctokitOptions = utilsModule.getOctokitOptions;
  modulesLoaded = true;
}

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

function filter_alerts(
  should_be_dismissed: Set<AlertIdentifier>,
  predicate: (alertUrl: AlertIdentifier) => boolean,
  sarif: SarifFile,
) {
  const alerts = [];
  let rules;
  for (const run of sarif.runs) {
    rules = get_rules_from_run(run);

    for (const result of run.results || []) {
      const properties = result.properties;
      if (should_be_dismissed.has(alert_identifier(rules, result))) {
        if (properties != null) {
          const alertUrl = properties["github/alertUrl"];
          if (predicate(alertUrl)) {
            alerts.push(alertUrl);
          }
        }
      }
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

/* Run codeql analyze with suppression queries in addition to normal ones
 * Upload the SARIF file and get the sarif - upload - id
 * Use sarif - upload - id to check and wait until upload is processed
 * Fetch analysis corresponding to sarif - upload - id
 * Fetch analysis in SARIF form
 * Use API to fetch list of already dismissed alerts
 * Now:
 * find alerts in the original SARIF file that have non - empty`suppressions[]`
 * match those alerts to the SARIF file fetch through the API(by rule and location) and extract the `github/alertUrl` property
 * remove`github/alertUrl` that are in the list of already dismissed alerts
 * for each remaining`github/alertUrl` make a PATCH request to set the dismissal state and reason
 */

export async function run(): Promise<void> {
  // Load ESM-only @actions packages
  await loadActionModules();

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
  const analyses_url = await wait_for_upload(client, nwo, sarif_id);
  const response1 = await client.request({ url: analyses_url });
  const analyses = response1.data;
  const analysis_url = analyses[0]["url"];
  const response2 = await client.request({
    url: analysis_url,
    headers: { Accept: "application/sarif+json" },
  });
  const sarif2 = response2.data;

  // Get SARIF file paths (supports both file and directory)
  const sarifFiles = getSarifFilePaths(sarifPath);
  core.debug(`Found ${sarifFiles.length} SARIF file(s) to process`);

  // Merge all SARIF files into a single object
  const sarif1 = mergeSarifFiles(sarifFiles);

  const [normal, suppressed] = split_alerts(sarif1);

  const all_dismissed_alerts = await client.paginate(
    client.rest.codeScanning.listAlertsForRepo,
    {
      ...nwo,
      state: "dismissed",
      per_page: 100,
    },
  );
  const dismissed_alerts = new Map(
    all_dismissed_alerts.map((x) => [x.url, x.dismissed_comment || undefined]),
  );

  const to_dismiss = filter_alerts(
    suppressed,
    (alertUrl) => !dismissed_alerts.has(alertUrl),
    sarif2,
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

  const to_reopen = filter_alerts(
    normal,
    (alertUrl) => dismissed_alerts.get(alertUrl) === SUPPRESSED_VIA_SARIF,
    sarif2,
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
