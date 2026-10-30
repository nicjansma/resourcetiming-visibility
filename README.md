# ResourceTiming-Visibility

v0.1.0

Copyright 2018 Nic Jansma

http://nicj.net

Licensed under the MIT license

## Introduction

Crawls the Top N Alexa sites, comparing how many resources are visible from
ResourceTiming vs. what the browser downloads.

Resources that won't be visible to ResourceTiming are items downloaded via
cross-origin IFRAMEs.

## Requirements

Node.js 22.12+.

```
npm install
```

If npm blocks Puppeteer's `postinstall` script (which downloads Chrome), run
`npx puppeteer browsers install chrome`.

## Usage

Crawl one URL:

```
node index.js https://nicj.net/
```

Crawl Top N URLs

```
node index.js [n]
```

Add `--debug` to list visible vs. missing URLs for each site.

## Version History

* v0.1.0 - 2018-03-15
    * Initial version
