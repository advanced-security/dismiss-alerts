import * as core from "@actions/core";
import * as github from "@actions/github";
import { GitHub, getOctokitOptions } from "@actions/github/lib/utils";
import * as retry from "@octokit/plugin-retry";
import consoleLogLevel from "console-log-level";
import * as fs from "fs";

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
  rule: SarifRule;
  ruleId: string;
  suppressions: Array<{ kind: string }>;
}

interface Nwo {
  owner: string;
  repo: string;
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

async function dismiss_alert(client: GitHubClient, url: string) {
  const payload = {
    state: "dismissed",
    dismissed_reason: "won't fix",
  };
  await client.request({
    method: "PATCH",
    url: url,
    data: payload,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function get_rules_from_run(run: SarifRun) {
  const extensions = [];
  for (const ext of run.tool?.extensions || []) {
    let ext_rules = [];
    for (const rule of run.tool?.driver?.rules || []) {
      ext_rules.push(rule.id);
    }
    extensions.push(ext_rules);

    ext_rules = [];
    for (const rule of ext.rules || []) {
      ext_rules.push(rule.id);
    }
    extensions.push(ext_rules);
  }
  return extensions;
}

function find_alerts_to_dismiss(
  should_be_dismissed: Set<AlertIdentifier>,
  already_dismissed: Set<string>,
  sarif: SarifFile
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
          if (!already_dismissed.has(alertUrl)) {
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
  result: SarifResult
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
  const startColumn = physicalLocation.region?.startColumn || 0;
  return [ruleId, filePath, startLine, startColumn].join(";");
}

function find_suppressed_alerts(sarif: SarifFile) {
  const alerts = new Set<AlertIdentifier>();

  for (const run of sarif.runs) {
    const rules = get_rules_from_run(run);

    for (const result of run.results || []) {
      if (result.suppressions != null && result.suppressions.length > 0) {
        alerts.add(alert_identifier(rules, result));
      }
    }
  }
  return alerts;
}

async function wait_for_upload(
  client: GitHubClient,
  nwo: Nwo,
  sarif_id: string
) {
  for (let i = 0; i < 10; i++) {
    const response = await client.rest.codeScanning.getSarif({
      ...nwo,
      sarif_id,
    });
    const upload_status = response.data;
    if (upload_status.processing_status == "complete") {
      if (upload_status.analyses_url != null) {
        return upload_status.analyses_url;
      }
      throw Error((upload_status.errors || []).join("\n"));
    }
    await new Promise((r) => setTimeout(r, 5000 * i));
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

async function run(): Promise<void> {
  const sarif_id = core.getInput("sarif-id", { required: true });
  const sarif = core.getInput("sarif-file", { required: true });
  const api_token =
    core.getInput("token") || getRequiredEnvParam("GITHUB_TOKEN");

  const apiURL = getRequiredEnvParam("GITHUB_API_URL");

  const retryingOctokit = GitHub.plugin(retry.retry);
  const client = new retryingOctokit(
    getOctokitOptions(api_token, {
      baseUrl: apiURL,
      userAgent: "dismiss-alerts",
      log: consoleLogLevel({ level: "debug" }),
    })
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

  const sarif1 = JSON.parse(fs.readFileSync(sarif, "utf8"));

  const suppressed = find_suppressed_alerts(sarif1);

  const response3 = await client.rest.codeScanning.listAlertsForRepo({
    ...nwo,
    state: "dismissed",
  });
  const dismissed_alerts = new Set(response3.data.map((x) => x.url));

  const to_dismiss = find_alerts_to_dismiss(
    suppressed,
    dismissed_alerts,
    sarif2
  );

  for (const alert of to_dismiss) {
    console.debug(`Dismissing alert: ${alert}`);
    await dismiss_alert(client, alert);
  }
}

void run();
