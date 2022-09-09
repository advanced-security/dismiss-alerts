from time import sleep
import requests
import base64
import gzip
import io
import json
import os
import re
import sys
try:
    from urllib.parse import urlparse
except ImportError:
    from urlparse import urlparse

def http_request(url, token, method='get', extra_headers={}, data=None):
    headers = extra_headers.copy()
    if token is not None:
        headers["Authorization"] = "Bearer " + token
    resp = requests.request(method, url, headers=headers, data=data)
    resp.raise_for_status()
    return resp.json()

def dismiss_alert(url, token):
    payload = '{{"state":"{}", "dismissed_reason":"{}"}}'.format(
        "dismissed", "won't fix")
    result = http_request(url, token, "patch", extra_headers={
        "Content-Type": "application/json"}, data=payload.encode("utf-8"))
    return result

# * Run codeql analyze with suppression queries in addition to normal ones
# * Upload the SARIF file and get the sarif-upload-id
# * Use sarif-upload-id to check and wait until upload is processed
# * Fetch analysis corresponding to sarif-upload-id
# * Fetch analysis in SARIF form
# * Use API to fetch list of already dismissed alerts
# * Now:
#   * find alerts in the original SARIF file that have non-empty `suppressions[]`
#   * match those alerts to the SARIF file fetch through the API (by rule and location) and extract the `github/alertUrl` property
#   * remove `github/alertUrl` that are in the list of already dismissed alerts
#   * for each remaining `github/alertUrl` make a PATCH request to set the dismissal state and reason

def main():
    script = os.path.basename(__file__)
    if len(sys.argv) != 5:
        print("Usage: {} API_URL REPO SARIF_ID SARIF_FILE".format(script))
        exit(1)

    api_url = sys.argv[1]
    repo = sys.argv[2]
    sarif_id = sys.argv[3]
    sarif = sys.argv[4]

    api_token = os.environ.get("GITHUB_TOKEN", None)

    upload_result_url = f'{api_url}/repos/{repo}/code-scanning/sarifs/{sarif_id}'

    analyses_url = wait_for_upload(upload_result_url, api_token)
    analyses = http_request(analyses_url, api_token)
    analysis_url = analyses[0]["url"]
    sarif2 = http_request(analysis_url, api_token, extra_headers={
        "Accept": "application/sarif+json"})

    with open(sarif, "rb") as inp:
        sarif1 = json.load(inp)
    suppressed = find_suppressed_alerts(sarif1)

    dismissed_alerts = http_request(
      f'{api_url}/repos/{repo}/code-scanning/alerts?state=dismissed',
      api_token)
    dismissed_alerts = set([a['url'] for a in dismissed_alerts])

    to_dismiss = find_alerts_to_dismiss(suppressed, dismissed_alerts, sarif2)
    for alert in to_dismiss:
        print("Dismissing alert: " + alert)
        dismiss_alert(alert, api_token)

def get_rules_from_run(run):
  extensions = []
  for ext in run['tool'].get('extensions', []):
    ext_rules = []
    for rule in ext.get('rules', []):
        ext_rules.append(rule['id'])
    extensions.append(ext_rules)
    
  ext_rules = []
  for rule in run['tool']['driver'].get('rules', []):
      ext_rules.append(rule['id'])
  extensions.append(ext_rules)
    
  return extensions

def find_alerts_to_dismiss(should_be_dismissed, already_dismissed, sarif):
    alerts = []
    for run in sarif['runs']:
        rules = get_rules_from_run(run)
        for result in run.get('results', []):
            if alert_identifier(rules, result) in should_be_dismissed:
                alertUrl = result["properties"]["github/alertUrl"]
                if not alertUrl in already_dismissed:
                    alerts.append(alertUrl)
    return alerts

def alert_identifier(rules, result):
    print(rules)
    if 'ruleId' in result:
      ruleId = result['ruleId']
    elif 'id' in result['rule']:
      ruleId = result['rule']['id']
    else:
      toolComponentIndex = result['rule']['toolComponent']['index'] if 'toolComponent' in result['rule'] else -1
      ruleIndex = result['rule']['index']
      ruleId = rules[toolComponentIndex][ruleIndex]
    physicalLocation = result['locations'][0]['physicalLocation']
    filePath = physicalLocation['artifactLocation']['uri']
    startLine = physicalLocation['region']['startLine']
    startColumn = physicalLocation['region'].get('startColumn', 0)
    endLine = physicalLocation['region'].get('endLine', startLine)
    endColumn = physicalLocation['region'].get('endColumn', 0)
    return (ruleId, filePath, startLine, startColumn)

def find_suppressed_alerts(sarif):
    alerts = []
    for run in sarif['runs']:
        rules = get_rules_from_run(run)
        for result in run.get('results', []):
            if 'suppressions' in result and len(result['suppressions']) > 0:
                alerts.append(alert_identifier(rules, result))
    return set(alerts)

def wait_for_upload(upload_url, api_token):
    for i in range(10):
        upload_status = http_request(upload_url, api_token)
        if upload_status["processing_status"] == "complete":
            if "analyses_url" in upload_status:
                return upload_status["analyses_url"]
            raise Exception(upload_status["errors"])
        sleep(i*5)
    raise Exception("Processing of upload is taking too long: " + upload_url)

main()
