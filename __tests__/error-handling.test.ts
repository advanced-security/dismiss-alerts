import { describe, test, expect, jest } from "@jest/globals";
import { patch_alert, GitHubClient, PatchPayload } from "../src/main.js";

describe("Error Handling", () => {
  test("patch_alert should handle already dismissed alert error", async () => {
    // Mock the GitHub client
    const mockClient = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      request: jest.fn<any>(),
    };

    // Mock error for already dismissed alert (with status 400)
    const alreadyDismissedError = Object.assign(
      new Error(
        "Alert is already dismissed. - https://docs.github.com/rest/code-scanning/code-scanning#update-a-code-scanning-alert",
      ),
      { status: 400 },
    );

    mockClient.request.mockRejectedValueOnce(alreadyDismissedError);

    const url = "https://api.github.com/repos/test/repo/code-scanning/alerts/1";
    const payload: PatchPayload = {
      state: "dismissed",
      dismissed_reason: "won't fix",
      dismissed_comment: "Suppressed via SARIF",
    };

    // patch_alert should swallow the "already dismissed" error rather than
    // throwing it, so awaiting it should resolve without rejecting.
    await expect(
      patch_alert(mockClient as unknown as GitHubClient, url, payload),
    ).resolves.toBeUndefined();
    expect(mockClient.request).toHaveBeenCalledWith({
      method: "PATCH",
      url: url,
      data: payload,
      headers: {
        "Content-Type": "application/json",
      },
    });
  });

  test("patch_alert should re-throw other errors", async () => {
    // Mock the GitHub client
    const mockClient = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      request: jest.fn<any>(),
    };

    // Mock a different error
    const otherError = new Error("Network error");
    mockClient.request.mockRejectedValueOnce(otherError);

    const url = "https://api.github.com/repos/test/repo/code-scanning/alerts/1";
    const payload: PatchPayload = {
      state: "dismissed",
      dismissed_reason: "won't fix",
      dismissed_comment: "Suppressed via SARIF",
    };

    // Test that other errors are still thrown
    await expect(
      patch_alert(mockClient as unknown as GitHubClient, url, payload),
    ).rejects.toThrow("Network error");
  });
});
