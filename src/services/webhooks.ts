import type { SourceRunResult } from "../types/releases.js";

export interface WebhookConfig {
  url: string | null;
  format: string;
}

function formatSummary(result: SourceRunResult): string {
  if (result.status === "success") {
    return `${result.sourceName}: ${result.releasesCollected} release(s), ${result.newReleaseCount} new.`;
  }

  if (result.status === "skipped") {
    return `${result.sourceName}: skipped. ${result.reason ?? "Not due yet."}`;
  }

  return `${result.sourceName}: error. ${result.reason ?? "Unknown error."}`;
}

function buildPayload(result: SourceRunResult, format: string): { body: string; contentType: string } {
  if (format === "slack") {
    return {
      body: JSON.stringify({ text: formatSummary(result) }),
      contentType: "application/json",
    };
  }

  if (format === "discord") {
    return {
      body: JSON.stringify({ content: formatSummary(result) }),
      contentType: "application/json",
    };
  }

  return {
    body: JSON.stringify({
      event: result.status === "error" ? "collector_error" : "collector_run",
      result,
    }),
    contentType: "application/json",
  };
}

function shouldNotify(result: SourceRunResult): boolean {
  return result.status === "error" || result.newReleaseCount > 0;
}

export async function notifyWebhook(
  config: WebhookConfig,
  results: SourceRunResult[],
): Promise<void> {
  if (!config.url) {
    return;
  }

  for (const result of results) {
    if (!shouldNotify(result)) {
      continue;
    }

    const payload = buildPayload(result, config.format);
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        "Content-Type": payload.contentType,
        Accept: "application/json, text/plain, */*",
        "User-Agent": "polvenn-release-collector/0.1.0",
      },
      body: payload.body,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Webhook error ${response.status}: ${response.statusText}. ${body}`);
    }
  }
}
