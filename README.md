# ResourceTiming-Visibility

v0.1.0

Copyright 2018 Nic Jansma

http://nicj.net

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

## Usage

Crawl one URL:

```sh
node index.js https://nicj.net/
```

Crawl the Top N sites, where N is `1000`, `10K`, `100K` or `1M`:

```sh
node index.js 10K
```

The Top N sites are all origins with a CrUX rank of N or better. Order within a
rank bucket is random.

Add `--debug` to list visible vs. missing URLs for each site.

## Version History

* v0.1.0 - 2018-03-15
    * Initial version
