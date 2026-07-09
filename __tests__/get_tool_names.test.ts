import { describe, test, expect } from "@jest/globals";
import { get_tool_names, SarifFile } from "../src/main.js";

describe("get_tool_names", () => {
  test("returns the tool name from a single run", () => {
    const sarif: SarifFile = {
      runs: [{ tool: { driver: { name: "CodeQL" } } }],
    };
    expect(get_tool_names(sarif)).toEqual(["CodeQL"]);
  });

  test("dedupes the same tool name repeated across multiple runs", () => {
    const sarif: SarifFile = {
      runs: [
        { tool: { driver: { name: "CodeQL" } } },
        { tool: { driver: { name: "CodeQL" } } },
      ],
    };
    expect(get_tool_names(sarif)).toEqual(["CodeQL"]);
  });

  test("returns each distinct tool name for a multi-tool merged SARIF", () => {
    const sarif: SarifFile = {
      runs: [
        { tool: { driver: { name: "CodeQL" } } },
        { tool: { driver: { name: "Checkov" } } },
      ],
    };
    expect(get_tool_names(sarif)).toEqual(["CodeQL", "Checkov"]);
  });

  test("does not hardcode or assume CodeQL for non-CodeQL tools", () => {
    const sarif: SarifFile = {
      runs: [{ tool: { driver: { name: "SomeThirdPartyScanner" } } }],
    };
    expect(get_tool_names(sarif)).toEqual(["SomeThirdPartyScanner"]);
  });

  test("skips runs with a missing tool, driver, or name", () => {
    const sarif: SarifFile = {
      runs: [
        { tool: { driver: { name: "CodeQL" } } },
        {},
        { tool: {} },
        { tool: { driver: {} } },
      ],
    };
    expect(get_tool_names(sarif)).toEqual(["CodeQL"]);
  });

  test("returns an empty array when no runs have a tool name", () => {
    const sarif: SarifFile = { runs: [{}, { tool: {} }] };
    expect(get_tool_names(sarif)).toEqual([]);
  });

  test("returns an empty array for a SARIF file with no runs", () => {
    expect(get_tool_names({ runs: [] })).toEqual([]);
  });
});
