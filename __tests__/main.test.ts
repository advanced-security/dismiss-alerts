import * as process from "process";
import * as cp from "child_process";
import * as path from "path";
import { test } from "@jest/globals";

// shows how the runner will run a javascript action with env / stdout protocol
test.skip("test runs", () => {
  process.env["INPUT_SARIF-ID"] = "1b832e60-32ac-11ed-9c2c-8893be53c1f3";
  process.env["INPUT_SARIF-FILE"] = "test.sarif";
  process.env["GITHUB_API_URL"] = "https://api.github.com";
  process.env["GITHUB_REPOSITORY"] = "aibaars/dismiss-alerts";
  const np = process.execPath;
  const ip = path.join(__dirname, "..", "lib", "main.js");
  const options: cp.ExecFileSyncOptions = {
    env: process.env,
  };
  console.log(cp.execFileSync(np, [ip], options).toString());
});
