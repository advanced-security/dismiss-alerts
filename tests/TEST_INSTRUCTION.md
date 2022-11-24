# Test Instructions 

1. Run `dismiss-alerts.yml` workflow to get baseline analysis. This should have 31 open and 2 closed code scanning alerts
2. Add `codeql` comment to the following files:

| File        | Line No.    |
| ----------- | ----------- |
| tests/cpp/main.c |  32    |
| tests/csharp/zipslip.cs | 26 |
| tests/go/main.go | 664 |
| tests/javascript/server.js| 7 |
| tests/python/hash-password.py | 10 |
| tests/ruby/logging.rb | 27 |

3. Run `dismiss-alerts.yml` analysis. Expected Result:

<img width="1858" alt="test_result" src="https://user-images.githubusercontent.com/68650974/203704720-1d8dc7d3-9b9b-4265-808e-6cc5a60be9ee.png">
