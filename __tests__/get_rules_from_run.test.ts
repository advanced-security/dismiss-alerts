import { describe, expect, test } from "@jest/globals";

// Import the types from main.ts
interface SarifRun {
  tool?: {
    driver?: {
      name?: string;
      rules?: Array<{ id: string }>;
    };
    extensions?: Array<{
      rules?: Array<{ id: string }>;
    }>;
  };
}

// Copy the function to test (we'll need to export it from main.ts later)
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

describe("get_rules_from_run", () => {
  test("should handle SARIF with only driver rules (no extensions)", () => {
    const run: SarifRun = {
      tool: {
        driver: {
          name: "CodeQL",
          rules: [{ id: "rule1" }, { id: "rule2" }, { id: "rule3" }],
        },
      },
    };

    const result = get_rules_from_run(run);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(["rule1", "rule2", "rule3"]);
  });

  test("should handle SARIF with driver and extensions", () => {
    const run: SarifRun = {
      tool: {
        driver: {
          name: "CodeQL",
          rules: [{ id: "driver-rule1" }, { id: "driver-rule2" }],
        },
        extensions: [
          {
            rules: [{ id: "ext1-rule1" }, { id: "ext1-rule2" }],
          },
          {
            rules: [{ id: "ext2-rule1" }],
          },
        ],
      },
    };

    const result = get_rules_from_run(run);

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual(["driver-rule1", "driver-rule2"]);
    expect(result[1]).toEqual(["ext1-rule1", "ext1-rule2"]);
    expect(result[2]).toEqual(["ext2-rule1"]);
  });

  test("should handle SARIF with no driver rules but with extensions", () => {
    const run: SarifRun = {
      tool: {
        driver: {
          name: "CodeQL",
        },
        extensions: [
          {
            rules: [{ id: "ext-rule1" }, { id: "ext-rule2" }],
          },
        ],
      },
    };

    const result = get_rules_from_run(run);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual([]);
    expect(result[1]).toEqual(["ext-rule1", "ext-rule2"]);
  });

  test("should handle SARIF with empty tool", () => {
    const run: SarifRun = {
      tool: {},
    };

    const result = get_rules_from_run(run);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual([]);
  });

  test("should handle SARIF with no tool", () => {
    const run: SarifRun = {};

    const result = get_rules_from_run(run);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual([]);
  });

  test("should handle extensions with empty rules arrays", () => {
    const run: SarifRun = {
      tool: {
        driver: {
          name: "CodeQL",
          rules: [{ id: "driver-rule1" }],
        },
        extensions: [
          {
            rules: [],
          },
          {
            // no rules property
          },
        ],
      },
    };

    const result = get_rules_from_run(run);

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual(["driver-rule1"]);
    expect(result[1]).toEqual([]);
    expect(result[2]).toEqual([]);
  });
});
