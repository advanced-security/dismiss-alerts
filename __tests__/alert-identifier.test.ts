import { describe, test, expect } from "@jest/globals";
import { alert_identifier, SarifResult } from "../src/main.js";

describe("alert_identifier", () => {
  const rules = [
    ["rule1", "rule2"],
    ["rule3", "rule4"],
  ];

  test("should use startColumn value when present", () => {
    const result: SarifResult = {
      ruleId: "CKV2_AWS_57",
      locations: [
        {
          physicalLocation: {
            artifactLocation: {
              uri: "secrets/main.tf",
            },
            region: {
              startLine: 1,
              startColumn: 5,
            },
          },
        },
      ],
      partialFingerprints: {},
      rule: {
        index: 0,
        toolComponent: { index: 0 },
      },
      suppressions: [],
    };

    const identifier = alert_identifier(rules, result);
    expect(identifier).toBe("CKV2_AWS_57;secrets/main.tf;1;5");
  });

  test("should default startColumn to 1 when not present", () => {
    const result: SarifResult = {
      ruleId: "CKV2_AWS_57",
      locations: [
        {
          physicalLocation: {
            artifactLocation: {
              uri: "secrets/main.tf",
            },
            region: {
              startLine: 1,
              // startColumn is intentionally omitted
            },
          },
        },
      ],
      partialFingerprints: {},
      rule: {
        index: 0,
        toolComponent: { index: 0 },
      },
      suppressions: [],
    };

    const identifier = alert_identifier(rules, result);
    expect(identifier).toBe("CKV2_AWS_57;secrets/main.tf;1;1");
  });

  test("should default startColumn to 1 when region is undefined", () => {
    const result: SarifResult = {
      ruleId: "CKV2_AWS_57",
      locations: [
        {
          physicalLocation: {
            artifactLocation: {
              uri: "secrets/main.tf",
            },
            // region is intentionally omitted
          },
        },
      ],
      partialFingerprints: {},
      rule: {
        index: 0,
        toolComponent: { index: 0 },
      },
      suppressions: [],
    };

    const identifier = alert_identifier(rules, result);
    expect(identifier).toBe("CKV2_AWS_57;secrets/main.tf;0;1");
  });

  test("should handle explicit startColumn of 0 (treated as 1 per SARIF spec)", () => {
    const result: SarifResult = {
      ruleId: "CKV2_AWS_57",
      locations: [
        {
          physicalLocation: {
            artifactLocation: {
              uri: "secrets/main.tf",
            },
            region: {
              startLine: 1,
              startColumn: 0,
            },
          },
        },
      ],
      partialFingerprints: {},
      rule: {
        index: 0,
        toolComponent: { index: 0 },
      },
      suppressions: [],
    };

    const identifier = alert_identifier(rules, result);
    // SARIF uses 1-based column indexing, so 0 is treated as 1
    expect(identifier).toBe("CKV2_AWS_57;secrets/main.tf;1;1");
  });

  test("should use ruleId directly when present", () => {
    const result: SarifResult = {
      ruleId: "test-rule-id",
      locations: [
        {
          physicalLocation: {
            artifactLocation: {
              uri: "test.js",
            },
            region: {
              startLine: 10,
            },
          },
        },
      ],
      partialFingerprints: {},
      rule: {
        index: 0,
        toolComponent: { index: 0 },
      },
      suppressions: [],
    };

    const identifier = alert_identifier(rules, result);
    expect(identifier).toBe("test-rule-id;test.js;10;1");
  });

  test("should use rule.id when ruleId is not present", () => {
    const result: SarifResult = {
      locations: [
        {
          physicalLocation: {
            artifactLocation: {
              uri: "test.js",
            },
            region: {
              startLine: 10,
              startColumn: 2,
            },
          },
        },
      ],
      partialFingerprints: {},
      rule: {
        id: "rule-from-rule-object",
        index: 0,
        toolComponent: { index: 0 },
      },
      suppressions: [],
    };

    const identifier = alert_identifier(rules, result);
    expect(identifier).toBe("rule-from-rule-object;test.js;10;2");
  });

  test("should lookup rule from rules array when neither ruleId nor rule.id is present", () => {
    const result: SarifResult = {
      locations: [
        {
          physicalLocation: {
            artifactLocation: {
              uri: "test.js",
            },
            region: {
              startLine: 10,
              startColumn: 2,
            },
          },
        },
      ],
      partialFingerprints: {},
      rule: {
        index: 1,
        toolComponent: { index: 0 },
      },
      suppressions: [],
    };

    const identifier = alert_identifier(rules, result);
    // toolComponent.index is 0, so 0 + 1 = 1, accessing rules[1] which is ["rule3", "rule4"]
    // then index 1 gives us "rule4"
    expect(identifier).toBe("rule4;test.js;10;2");
  });
});
