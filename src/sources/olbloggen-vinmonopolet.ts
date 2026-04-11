import { load } from "cheerio";
import type { ReleaseItem, ReleaseRecord } from "../types/releases.js";
import type {
  OlbloggenVinmonopoletSourceConfig,
  SourceAdapter,
} from "../types/source.js";
import { fetchText } from "../utils/http.js";

const DEFAULT_TITLE_PREFIX = "Ølnyheter på Vinmonopolet";

const NORWEGIAN_MONTHS: Record<string, number> = {
  januar: 1,
  februar: 2,
  mars: 3,
  april: 4,
  mai: 5,
  juni: 6,
  juli: 7,
  august: 8,
  september: 9,
  oktober: 10,
  november: 11,
  desember: 12,
};

interface ListingEntry {
  title: string;
  url: string;
}

interface ParsedArticle {
  id: string;
  title: string;
  publishedAt: string;
  url: string;
  items: ReleaseItem[];
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function parseNorwegianDate(value: string): string | null {
  const match = normalizeWhitespace(value)
    .toLowerCase()
    .match(/^(\d{1,2})\.\s*([a-zæøå]+)\s*(\d{4})$/i);

  if (!match) {
    return null;
  }

  const day = Number.parseInt(match[1], 10);
  const month = NORWEGIAN_MONTHS[match[2]];
  const year = Number.parseInt(match[3], 10);
  if (!month) {
    return null;
  }

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00Z`;
}

function buildTitlePrefixVariants(titlePrefix: string): string[] {
  const normalized = normalizeWhitespace(titlePrefix);
  const withoutPa = normalizeWhitespace(normalized.replace(/\spå\s/gi, " "));

  return Array.from(new Set([normalized, withoutPa]));
}

function isMatchingReleaseTitle(title: string, titlePrefix: string): boolean {
  const normalizedTitle = normalizeWhitespace(title).toLowerCase();
  return buildTitlePrefixVariants(titlePrefix).some((variant) =>
    normalizedTitle.startsWith(variant.toLowerCase()),
  );
}

function extractReleaseDateFromTitle(title: string, titlePrefix: string): string | null {
  const normalizedTitle = normalizeWhitespace(title);

  for (const variant of buildTitlePrefixVariants(titlePrefix)) {
    if (!normalizedTitle.toLowerCase().startsWith(variant.toLowerCase())) {
      continue;
    }

    const remainder = normalizeWhitespace(normalizedTitle.slice(variant.length));
    const parsed = parseNorwegianDate(remainder);
    if (parsed) {
      return parsed;
    }
  }

  const trailingDate = normalizedTitle.match(/(\d{1,2}\.\s*[a-zæøå]+\s*\d{4})$/i)?.[1];
  return trailingDate ? parseNorwegianDate(trailingDate) : null;
}

function isoDateOnly(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 10);
}

function parseNumber(value: string): number {
  const normalized = normalizeWhitespace(value).replace(",", ".");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildListingPageUrl(listingUrl: string, page: number): string {
  if (page <= 1) {
    return listingUrl;
  }

  const url = new URL(listingUrl);
  const pathname = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
  url.pathname = `${pathname}page/${page}/`;
  return url.toString();
}

function buildReleaseId(articleUrl: string): string {
  const url = new URL(articleUrl);
  const slug = url.pathname.split("/").filter(Boolean).pop();
  if (!slug) {
    throw new Error(`Could not derive release slug from ${articleUrl}`);
  }

  return slug;
}

export function parseListingPage(
  html: string,
  {
    titlePrefix = DEFAULT_TITLE_PREFIX,
    baseUrl,
  }: { titlePrefix?: string; baseUrl: string },
): ListingEntry[] {
  const $ = load(html);
  const entries: ListingEntry[] = [];

  $("article .entry-title a").each((_, element) => {
    const title = normalizeWhitespace($(element).text());
    const href = $(element).attr("href");
    if (!href || !isMatchingReleaseTitle(title, titlePrefix)) {
      return;
    }

    entries.push({
      title,
      url: new URL(href, baseUrl).toString(),
    });
  });

  const seenUrls = new Set<string>();
  return entries.filter((entry) => {
    if (seenUrls.has(entry.url)) {
      return false;
    }

    seenUrls.add(entry.url);
    return true;
  });
}

function parseReleaseItems(html: string, releaseDate: string): ReleaseItem[] {
  const $ = load(html);
  const rows = $(".entry-content table tbody tr, .entry-content table tr");
  const items: ReleaseItem[] = [];

  rows.each((_, row) => {
    const columns = $(row)
      .find("td")
      .toArray()
      .map((cell) => normalizeWhitespace($(cell).text()));

    if (columns.length < 6) {
      return;
    }

    const articleNumber = columns[1] ?? "";
    const producer = columns[2] ?? "";
    const name = columns[3] ?? "";
    if (!/^\d{5,}$/.test(articleNumber) || !producer || !name) {
      return;
    }

    items.push({
      country: columns[0] || null,
      articleNumber,
      producer,
      name,
      style: columns[4] ?? "",
      abv: parseNumber(columns[5] ?? ""),
      releaseDate,
    });
  });

  return items;
}

export function parseArticlePage(
  html: string,
  articleUrl: string,
  titlePrefix = DEFAULT_TITLE_PREFIX,
): ParsedArticle {
  const $ = load(html);
  const title = normalizeWhitespace($("h1.entry-title").first().text());
  if (!title) {
    throw new Error(`Could not find article title for ${articleUrl}`);
  }

  const titleReleaseDate = extractReleaseDateFromTitle(title, titlePrefix);
  const publishedMeta = normalizeWhitespace($(".entry-meta .published").first().text());
  const publishedAt = titleReleaseDate ?? parseNorwegianDate(publishedMeta);
  if (!publishedAt) {
    throw new Error(`Could not parse release date for ${articleUrl}`);
  }

  const items = parseReleaseItems(html, isoDateOnly(publishedAt));
  if (items.length === 0) {
    throw new Error(`Could not find release rows for ${articleUrl}`);
  }

  return {
    id: buildReleaseId(articleUrl),
    title,
    publishedAt,
    url: articleUrl,
    items,
  };
}

export class OlbloggenVinmonopoletSourceAdapter implements SourceAdapter {
  constructor(private readonly config: OlbloggenVinmonopoletSourceConfig) {}

  async collect(): Promise<ReleaseRecord[]> {
    const maxPages = this.config.maxPages ?? 1;
    const maxArticles = this.config.maxArticles ?? 12;
    const titlePrefix = this.config.titlePrefix ?? DEFAULT_TITLE_PREFIX;
    const listingEntries: ListingEntry[] = [];

    for (let page = 1; page <= maxPages; page += 1) {
      const listingUrl = buildListingPageUrl(this.config.listingUrl, page);
      const html = await fetchText(listingUrl);
      listingEntries.push(
        ...parseListingPage(html, {
          titlePrefix,
          baseUrl: this.config.listingUrl,
        }),
      );

      if (listingEntries.length >= maxArticles) {
        break;
      }
    }

    const selectedEntries = listingEntries.slice(0, maxArticles);
    const releases: ReleaseRecord[] = [];

    for (const entry of selectedEntries) {
      const html = await fetchText(entry.url);
      const article = parseArticlePage(html, entry.url, titlePrefix);

      releases.push({
        id: `${this.config.id}:${article.id}`,
        title: article.title,
        source: this.config.id,
        publishedAt: article.publishedAt,
        url: article.url,
        items: article.items,
      });
    }

    return releases.sort((left, right) => right.publishedAt.localeCompare(left.publishedAt));
  }
}
