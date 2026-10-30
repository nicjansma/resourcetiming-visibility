# ResourceTiming-Visibility

v1.0.0

Copyright 2026 Nic Jansma

https://nicj.net

Licensed under the MIT license

## Introduction

Crawls the Top N sites from the [Chrome UX Report (CrUX)](https://developer.chrome.com/docs/crux),
comparing how many resources are visible from
ResourceTiming vs. what the browser downloads.

Resources that won't be visible to ResourceTiming are items downloaded via
cross-origin IFRAMEs.

## Requirements

Node.js 22.12+.

```sh
npm install
```

If npm blocks Puppeteer's `postinstall` script (which downloads Chrome), run
`npx puppeteer browsers install chrome`.

### Top Sites List

To crawl the Top N sites, download the latest CrUX Top List from
[zakird/crux-top-lists](https://github.com/zakird/crux-top-lists) into this
directory as `crux-top-lists.csv.gz`:

```sh
curl -L -o crux-top-lists.csv.gz \
    https://raw.githubusercontent.com/zakird/crux-top-lists/main/data/global/current.csv.gz
```

The list is updated monthly. It's a gzipped CSV of `origin,rank` rows, where
rank is a bucket (1000, 5000, 10000, ...) rather than an exact position.

### EasyList (optional)

To measure how many resources are loaded in ad IFRAMEs, download
[EasyList](https://easylist.to/) into this directory as `easylist.txt`:

```sh
curl -L -o easylist.txt https://easylist.to/easylist/easylist.txt
```

If it's not there, ad IFRAMEs aren't tracked.

A resource is counted as in an ad IFRAME if the frame that loaded it, or any
frame above it, is an IFRAME whose URL EasyList would block (as a `subdocument`
request from its parent frame). Matching uses
[`@ghostery/adblocker`](https://github.com/ghostery/adblocker).

## Usage

Crawl one URL:

```sh
node index.js https://nicj.net/
```

Crawl the Top N sites, where N is `1K`, `5K`, `10K`, `50K`, `100K`, `500K` or
`1M` (or the full number, e.g. `10000`):

```sh
node index.js 10K
```

The Top N sites are all origins with a CrUX rank of N or better. Order within a
rank bucket is random.

Use `--limit M` to only crawl the first M of those sites. Higher-ranked buckets
come first, so `--limit` takes from the best-ranked bucket before moving on to
the next:

```sh
node index.js 1M --limit 500
```

Use `--timeout S` to change how many seconds to wait for each page to load
(default: 30). Sites that don't finish loading in time are skipped:

```sh
node index.js 10K --timeout 60
```

Add `--debug` to list visible vs. missing URLs for each site.

## Output

* `output-sites.json`: one JSON line per site, with entry/byte counts (total,
  visible, no TAO, missing) for all resources and per asset type. When EasyList
  is loaded, also:
  * `adFrames`: the same counts, for resources in ad IFRAMEs
  * `adFrameCount`: number of distinct ad IFRAMEs
  * `adFrameEntriesPct` / `adFrameBytesPct`: percentage of the site's
      resources / bytes in ad IFRAMEs
* `output-urls.json`: one JSON line per resource, including the `frameUrl` that
  loaded it. When EasyList is loaded, also `adFrame` (true/false), plus the
  `adFrameUrl` and EasyList `adFilter` that matched.

The percentage of resources and bytes in ad IFRAMEs across all sites is logged
at the end of the crawl.

## Version History

* v0.1.0 - 2018-03-15
  * Initial version
* v1.0.0 - 2026-10-30
  * Uses CrUX top sites list instead of Alexa
  * Calculates stats for frames coming from EasyList

## AI Disclosure

Versions before 1.0.0 were hand-written.

Versions 1.0.0+ are being developed with AI assistance for planning, coding and verification.
