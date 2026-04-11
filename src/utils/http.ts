export async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "polvenn-release-collector/0.1.0",
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status} for ${url}: ${response.statusText}. ${body}`);
  }

  return response.json() as Promise<T>;
}

export async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "polvenn-release-collector/0.1.0",
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status} for ${url}: ${response.statusText}. ${body}`);
  }

  return response.text();
}
