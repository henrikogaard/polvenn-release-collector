import assert from "node:assert/strict";
import test from "node:test";
import {
  parseArticlePage,
  parseListingPage,
} from "./olbloggen-vinmonopolet.js";

test("parseListingPage extracts release article URLs from the category page", () => {
  const html = `
    <main>
      <article>
        <h2 class="entry-title">
          <a href="/vinmonopolet-nyheter/olnyheter-vinmonopolet-1-april-2026/">
            Ølnyheter Vinmonopolet 1. april 2026
          </a>
        </h2>
      </article>
      <article>
        <h2 class="entry-title">
          <a href="/vinmonopolet-nyheter/olnyheter-pa-vinmonopolet-5-november-2025/">
            Ølnyheter på Vinmonopolet 5. november 2025
          </a>
        </h2>
      </article>
      <article>
        <h2 class="entry-title">
          <a href="/vinmonopolet-nyheter/juleol-2025/">
            Juleøl 2025
          </a>
        </h2>
      </article>
    </main>
  `;

  const entries = parseListingPage(html, {
    baseUrl: "https://www.olbloggen.no/category/vinmonopolet-nyheter/",
  });

  assert.deepEqual(entries, [
    {
      title: "Ølnyheter Vinmonopolet 1. april 2026",
      url: "https://www.olbloggen.no/vinmonopolet-nyheter/olnyheter-vinmonopolet-1-april-2026/",
    },
    {
      title: "Ølnyheter på Vinmonopolet 5. november 2025",
      url: "https://www.olbloggen.no/vinmonopolet-nyheter/olnyheter-pa-vinmonopolet-5-november-2025/",
    },
  ]);
});

test("parseArticlePage converts a release article into normalized items", () => {
  const html = `
    <article>
      <h1 class="entry-title">Ølnyheter på Vinmonopolet 5. november 2025</h1>
      <div class="entry-meta">
        <span class="published">4. november 2025</span>
      </div>
      <div class="entry-content">
        <table>
          <tbody>
            <tr>
              <td>Land</td>
              <td>Artikkel</td>
              <td>Produsent</td>
              <td>Navn</td>
              <td>Stil</td>
              <td>ABV</td>
              <td>Volum</td>
            </tr>
            <tr>
              <td>Norge</td>
              <td>20162402</td>
              <td>Amundsen Bryggeri</td>
              <td>Dessert In A Can</td>
              <td>Imperial stout</td>
              <td>12,5</td>
              <td>0.44</td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
  `;

  const release = parseArticlePage(
    html,
    "https://www.olbloggen.no/vinmonopolet-nyheter/olnyheter-pa-vinmonopolet-5-november-2025/",
  );

  assert.equal(release.id, "olnyheter-pa-vinmonopolet-5-november-2025");
  assert.equal(release.title, "Ølnyheter på Vinmonopolet 5. november 2025");
  assert.equal(release.publishedAt, "2025-11-05T00:00:00Z");
  assert.deepEqual(release.items, [
    {
      country: "Norge",
      articleNumber: "20162402",
      producer: "Amundsen Bryggeri",
      name: "Dessert In A Can",
      style: "Imperial stout",
      abv: 12.5,
      releaseDate: "2025-11-05",
    },
  ]);
});

test("parseArticlePage uses release date from title variants without 'på'", () => {
  const html = `
    <article>
      <h1 class="entry-title">Ølnyheter Vinmonopolet 1. april 2026</h1>
      <div class="entry-meta">
        <span class="published">31. mars 2026</span>
      </div>
      <div class="entry-content">
        <table>
          <tbody>
            <tr>
              <td>Land</td>
              <td>Artikkel</td>
              <td>Produsent</td>
              <td>Navn</td>
              <td>Stil</td>
              <td>ABV</td>
            </tr>
            <tr>
              <td>Norge</td>
              <td>20273702</td>
              <td>Salikatt Bryggeri</td>
              <td>Skyhook</td>
              <td>IPA</td>
              <td>7,5</td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
  `;

  const release = parseArticlePage(
    html,
    "https://www.olbloggen.no/vinmonopolet-nyheter/olnyheter-vinmonopolet-1-april-2026/",
  );

  assert.equal(release.title, "Ølnyheter Vinmonopolet 1. april 2026");
  assert.equal(release.publishedAt, "2026-04-01T00:00:00Z");
  assert.equal(release.items[0]?.releaseDate, "2026-04-01");
});
