# Dismiss Alerts Action 

The `dismiss alerts` action closes code scanning alerts based on the `suppression` [property](https://docs.oasis-open.org/sarif/sarif/v2.0/csprd02/sarif-v2.0-csprd02.html#_Toc10127852) in the SARIF file. 

There are two required input fields for this action: 
- `sarif-upload-id` - the SARIF identifier
- `sarif-file` - the location of the SARIF file

## Getting Started 

CodeQL populates the `suppression` property in its SARIF output based on the results of `alert-suppression` queries. A user can provide their own custom alert-suppression query, or use the ones that we provide (//lgtm or //codeql style comments).

### Example - CodeQL 

```yaml
name: "Action Test"
on:
 push:
   branches: [main]
 pull_request:
    # The branches below must be a subset of the branches above
   branches: [main]
 workflow_dispatch:

jobs:
  analyze:
    name: Analyze
    runs-on: ubuntu-latest

    strategy:
      fail-fast: false
      matrix:
        language: ["java"]

    steps:
      - name: Checkout repository
        uses: actions/checkout@v2

      - name: Initialize CodeQL
        uses: github/codeql-action/init@v2
        with:
          languages: ${{ matrix.language }}
          packs: advanced-security-demo/java-alert-suppression

      - run: |
          javatest/build

      - name: Perform CodeQL Analysis
        id: analyze
        uses: github/codeql-action/analyze@v2
        with:
          output: sarif-results

      - name: dismiss-alerts
        uses: ./
        with:
          sarif-id: ${{ steps.analyze.outputs.sarif-id }}
          sarif-file: sarif-results/java.sarif
        env:
          GITHUB_TOKEN: ${{ github.token }}
```

### Third party produced SARIF file 

The `dismiss alerts` solution can be used with SARIF files from third party providers.

``` yaml
on:
  push:

jobs:
  check-codeql-versions:
    runs-on: ubuntu-latest

    permissions:
      security-events: write

    steps:
    - name: Checkout code
      uses: actions/checkout@v3
    
    - name: Run SAST scan
      run: sast-scan.sh --output=scan-results.sarif
      
    - name: Upload scan results
      id: upload
      uses: github/codeql-action/upload-sarif
      with:
        sarif_file: scan-results.sarif
        wait-for-processing: true

    - name: Dismiss alerts
        uses: advanced-security/dismiss-alerts
        with:
          sarif-id: ${{ steps.upload.outputs.sarif-id }}
          sarif-file: scan-results.sarif
        env:
          GITHUB_TOKEN: ${{ github.token }}        
```
## High Level Architecture 

The `suppressions[]` object in the sarif is used to create a list of suppressed alerts. The API's are used to retrieve a list of already dismissed alerts. These two lists are mapped using the alert identifier (rule and location).  A comparison is done between these lists and any alert that has not already been dismissed is updated with a PATCH request using the `github/alertUrl` property. The alert `state` is updated to `dismissed` with the `dismissed reason` being `won't fix`.

## Features and Limitations 

- This action should run only on the default branch as the dismissal status of an alert is a global property. If this action is run on a push event to a feature branch or pull request then the suppressed alerts will also be dismissed on the default branch. 
- When an alert is dismissed, a duplicate alert will be marked as fixed. This is because code scanning uses the hash of the alert's line contents as the unique identifier. The suppression comment appears on the same line and therefore a new hash is created, so uniqueness no longer holds and a duplicate is created. Since the original hash no longer exists it is marked autmatically as `fixed`.
