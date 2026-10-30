#!/usr/bin/env node
//
// Imports
//
import { createReadStream } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { createGunzip } from "node:zlib";
import Crawler from "./crawler.js";

//
// Constants
//
// CrUX Top Lists, from https://github.com/zakird/crux-top-lists
const SITES_FILE = join(import.meta.dirname, "crux-top-lists.csv.gz");

// supported Top N sizes
const TOP_N_SIZES = {
    "1000": 1000,
    "1k": 1000,
    "10k": 10000,
    "10000": 10000,
    "100k": 100000,
    "100000": 100000,
    "1m": 1000000,
    "1000000": 1000000
};

const USAGE = "Usage: resourcetiming-visibility [url | top N sites (1000, 10K, 100K or 1M)] [--debug]";

//
// Functions
//
/**
 * Loads the origins from the CrUX Top List with a rank of N or better
 *
 * @param {number} topN Top N
 *
 * @returns {Promise<string[]>} Origins
 */
async function loadTopSites(topN) {
    const sites = [];

    const file = createReadStream(SITES_FILE);
    const gunzip = createGunzip();

    // forward file errors (e.g. missing file) so they reject the loop below
    file.on("error", err => gunzip.destroy(err));

    const lines = createInterface({
        input: file.pipe(gunzip),
        crlfDelay: Infinity
    });

    // CSV of: origin,rank (sorted by rank bucket: 1000, 5000, 10000, ...)
    for await (const line of lines) {
        const [origin, rank] = line.trim().split(",");

        if (!origin || origin === "origin") {
            // skip the header and empty lines
            continue;
        }

        if (Number(rank) > topN) {
            break;
        }

        sites.push(origin);
    }

    lines.close();
    file.destroy();

    return sites;
}

//
// Main
//
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
    // if given a Top N size, load those sites from the CrUX Top List
    const topN = TOP_N_SIZES[target.toLowerCase()];

    if (!topN) {
        console.error(`Invalid Top N: ${target}`);
        console.error(USAGE);
        process.exit(1);
    }

    try {
        sites = await loadTopSites(topN);
    } catch (e) {
        console.error(`Unable to load ${SITES_FILE}: ${e.message}`);
        console.error("See the README for how to download it.");
        process.exit(1);
    }

    console.log(`Loaded ${sites.length} sites from the CrUX Top ${target}`);
}

// call Crawler
const crawler = new Crawler(sites, args.values.debug);

await crawler.crawl();
