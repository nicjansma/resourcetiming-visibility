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

## Usage

Crawl one URL:

```
node index.js https://nicj.net/
```

Crawl Top N URLs

```
node index.js [n]
```

## Version History

* v0.1.0 - 2018-03-15
    * Initial version
