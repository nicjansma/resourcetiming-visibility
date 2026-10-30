#!/usr/bin/env node
//
// Imports
//
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import Crawler from "./crawler.js";

const SITES_FILE = join(import.meta.dirname, "sites-1000.csv");
const USAGE = "Usage: resourcetiming-visibility [url | number of Alexa Top N sites] [--debug]";

// command-line arguments
let args;

try {
    args = parseArgs({
        allowPositionals: true,
        options: {
            debug: { type: "boolean", default: false }
        }
    });
} catch (e) {
    console.error(e.message);
    console.error(USAGE);
    process.exit(1);
}

const [target] = args.positionals;

if (!target) {
    console.error(USAGE);
    process.exit(1);
}

let sites;

if (target.startsWith("http")) {
    sites = [target];
} else {
    // if given a number, load that many sites from the CSV
    const numberOfSites = Number.parseInt(target, 10);

    if (!Number.isInteger(numberOfSites) || numberOfSites <= 0) {
        console.error(`Invalid number of sites: ${target}`);
        console.error(USAGE);
        process.exit(1);
    }

    // load the sites
    sites = (await readFile(SITES_FILE, "utf-8"))
        .split("\n")
        .map(line => line.trim())
        .filter(Boolean)
        .slice(0, numberOfSites);
}

// call Crawler
const crawler = new Crawler(sites, args.values.debug);

await crawler.crawl();
