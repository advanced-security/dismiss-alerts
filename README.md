# Dismiss Alerts Action 

The `dismiss alerts` action [dismisses](https://docs.github.com/en/code-security/code-scanning/automatically-scanning-your-code-for-vulnerabilities-and-errors/managing-code-scanning-alerts-for-your-repository) code scanning alerts based on the `suppression` [property](https://docs.oasis-open.org/sarif/sarif/v2.0/csprd02/sarif-v2.0-csprd02.html#_Toc10127852) in the SARIF file. 

There are two required input fields for this action: 
- `sarif-upload-id` - the SARIF identifier
- `sarif-file` - the location of the SARIF file

## High Level Architecture 

The `suppressions[]` object in the sarif is used to create a list of suppressed alerts. The API's are used to retrieve a list of already dismissed alerts. These two lists are mapped using the alert identifier (rule and location).  A comparison is done between these lists and any alert that has not already been dismissed is updated with a PATCH request using the `github/alertUrl` property. The alert `state` is updated to `dismissed` with the `dismissed reason` being `won't fix`.

## Getting Started 

CodeQL populates the `suppression` property in its SARIF output based on the results of `alert-suppression` queries. A user can provide their own custom alert-suppression query, or use the ones that we provide (//lgtm or //codeql style comments).

### Example - CodeQL 

```yaml
name: "CodeQL"

on:
 push:
   branches: [ main ]
 pull_request:
    branches: [ main ]

jobs:
  analyze:
    name: Analyze
    runs-on: ubuntu-latest
    permissions:
      actions: read
      contents: read
      security-events: write

    strategy:
      fail-fast: false
      matrix:
        language: [ "java" ]

    steps:
    - name: Checkout repository
      uses: actions/checkout@v3

    - name: Initialize CodeQL
      uses: github/codeql-action/init@v2
      with:
        languages: ${{ matrix.language }}
        packs: "codeql/${{ matrix.language }}-queries:AlertSuppression.ql"

    - name: Autobuild
      uses: github/codeql-action/autobuild@v2

    - name: Perform CodeQL Analysis
      id: analyze
      uses: github/codeql-action/analyze@v2
      with:
        category: "/language:${{matrix.language}}"
        output: sarif-results

    - name: Dismiss alerts
      if: github.ref == 'main'
      uses: advanced-security/dismiss-alerts
      with:
        sarif-id: ${{ steps.analyze.outputs.sarif-id }}
        sarif-file: sarif-results/${{ matrix.language }}.sarif
      env:
        GITHUB_TOKEN: ${{ github.token }}
```

### Third party produced SARIF file 

The `dismiss-alerts` action can be used with SARIF files from third party providers.

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
      if: github.ref == 'main'    
      uses: advanced-security/dismiss-alerts
      with:
        sarif-id: ${{ steps.upload.outputs.sarif-id }}
        sarif-file: scan-results.sarif
      env:
        GITHUB_TOKEN: ${{ github.token }}        
```

## Features and Limitations 

- This action should run only on the default branch as the dismissal status of an alert is a global property. If this action is run on a push event to a feature branch or pull request then the suppressed alerts will also be dismissed on the default branch. 
- When a suppression comment is added on the line that contains an alert then this alert will be closed and a duplicate alert will be marked as fixed. This is because code scanning uses the hash of the alert's line contents as the unique identifier. The inserted suppression comment changes the contents of the line, and therefore also the hash of the alert. Since the alert hash no longer matches the original alert is considered `fixed` and a new alert is created in its place. The new alert is immediately marked as `dismissed` as a result of the suppression comment. To avoid this problem it is recommended to use a suppression style that allows placing suppression markers on the line before an alert.
