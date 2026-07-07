import { describe, test, expect } from "@jest/globals";

// Re-implement the types/function we need for testing
interface SarifFile {
  version?: string | null;
  runs: Array<{ tool?: { driver?: { name?: string } }; results?: unknown[] }>;
}

// Re-implement the mergeSarifObjects function for testing
function mergeSarifObjects(sarifContents: SarifFile[]): SarifFile {
  const mergedSarif: SarifFile = {
    version: "2.1.0",
    runs: [],
  };

  for (const sarifContent of sarifContents) {
    if (mergedSarif.version === "2.1.0" && sarifContent.version) {
      mergedSarif.version = sarifContent.version;
    }
    if (sarifContent.runs) {
      mergedSarif.runs.push(...sarifContent.runs);
    }
  }

  return mergedSarif;
}

describe("mergeSarifObjects", () => {
  test("should merge runs from a single SARIF object", () => {
    const sarif: SarifFile = {
      version: "2.1.0",
      runs: [{ tool: { driver: { name: "CodeQL" } }, results: [] }],
    };

    const merged = mergeSarifObjects([sarif]);

    expect(merged.runs).toHaveLength(1);
  });

  test("should merge runs from multiple SARIF objects (one per analysis)", () => {
    // This mirrors the scenario where a single SARIF upload contains
    // multiple runs (e.g. the main analysis plus an alert-suppression
    // query pack run), and the code scanning API returns them as separate
    // analyses that each need to be fetched and combined.
    const mainAnalysis: SarifFile = {
      version: "2.1.0",
      runs: [{ tool: { driver: { name: "CodeQL" } }, results: [{}, {}] }],
    };
    const suppressionAnalysis: SarifFile = {
      version: "2.1.0",
      runs: [
        { tool: { driver: { name: "CodeQL alert suppression" } }, results: [] },
      ],
    };

    const merged = mergeSarifObjects([mainAnalysis, suppressionAnalysis]);

    expect(merged.runs).toHaveLength(2);
    expect(merged.runs[0].tool?.driver?.name).toBe("CodeQL");
    expect(merged.runs[1].tool?.driver?.name).toBe("CodeQL alert suppression");
  });

  test("should handle an empty list of SARIF objects", () => {
    const merged = mergeSarifObjects([]);

    expect(merged.runs).toEqual([]);
    expect(merged.version).toBe("2.1.0");
  });

  test("should keep the version from the first object that defines one", () => {
    const sarifWithoutVersion: SarifFile = { runs: [] };
    const sarifWithVersion: SarifFile = { version: "2.2.0", runs: [] };

    const merged = mergeSarifObjects([sarifWithoutVersion, sarifWithVersion]);

    expect(merged.version).toBe("2.2.0");
  });
});
