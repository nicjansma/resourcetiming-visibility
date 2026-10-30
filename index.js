#!/usr/bin/env node
//
// Imports
//
import { createReadStream, existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { createGunzip } from "node:zlib";
import AdFrameDetector from "./ad-frames.js";
import Crawler from "./crawler.js";

//
// Constants
//
// CrUX Top Lists, from https://github.com/zakird/crux-top-lists
const SITES_FILE = join(import.meta.dirname, "crux-top-lists.csv.gz");

// EasyList, from https://easylist.to/
const EASYLIST_FILE = join(import.meta.dirname, "easylist.txt");

// supported Top N sizes (the CrUX rank buckets)
const TOP_N_SIZES = [1000, 5000, 10000, 50000, 100000, 500000, 1000000];

// default page load timeout (seconds)
const DEFAULT_TIMEOUT = 30;

const USAGE = "Usage: resourcetiming-visibility [url | top N sites] [--limit M] [--timeout S] [--debug]\n" +
    "  N: 1K, 5K, 10K, 50K, 100K, 500K or 1M (or the full number, e.g. 10000)\n" +
    "  --limit M: only crawl the first M of the Top N sites\n" +
    `  --timeout S: page load timeout, in seconds (default: ${DEFAULT_TIMEOUT})`;

//
// Functions
//
/**
 * Parses a Top N size, e.g. "10K", "1m" or "50000"
 *
 * @param {string} str Top N size
 *
 * @returns {number|undefined} Top N, if a supported size
 */
function parseTopN(str) {
    const match = /^(\d+)([km]?)$/i.exec(str);

    if (!match) {
        return undefined;
    }

    const multiplier = { "": 1, "k": 1000, "m": 1000000 }[match[2].toLowerCase()];
    const topN = Number(match[1]) * multiplier;

    return TOP_N_SIZES.includes(topN) ? topN : undefined;
}

/**
 * Loads the origins from the CrUX Top List with a rank of N or better
 *
 * @param {number} topN Top N
 * @param {number} [limit] Maximum number of origins to load
 *
 * @returns {Promise<string[]>} Origins
 */
async function loadTopSites(topN, limit = Infinity) {
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

        if (Number(rank) > topN || sites.length >= limit) {
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
            debug: { type: "boolean", default: false },
            limit: { type: "string" },
            timeout: { type: "string", default: String(DEFAULT_TIMEOUT) }
        }
    });
} catch (e) {
    console.error(e.message);
    console.error(USAGE);
    process.exit(1);
}

let limit = Infinity;

if (args.values.limit !== undefined) {
    limit = Number(args.values.limit);

    if (!Number.isInteger(limit) || limit <= 0) {
        console.error(`Invalid --limit: ${args.values.limit}`);
        console.error(USAGE);
        process.exit(1);
    }
}

const timeout = Number(args.values.timeout);

if (!Number.isFinite(timeout) || timeout <= 0) {
    console.error(`Invalid --timeout: ${args.values.timeout}`);
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
    const topN = parseTopN(target);

    if (!topN) {
        console.error(`Invalid Top N: ${target}`);
        console.error(USAGE);
        process.exit(1);
    }

    try {
        sites = await loadTopSites(topN, limit);
    } catch (e) {
        console.error(`Unable to load ${SITES_FILE}: ${e.message}`);
        console.error("See the README for how to download it.");
        process.exit(1);
    }

    console.log(`Loaded ${sites.length} sites from the CrUX Top ${topN}`);
}

// load EasyList, to track resources in ad IFRAMEs
let adFrameDetector = null;

if (existsSync(EASYLIST_FILE)) {
    adFrameDetector = await AdFrameDetector.load(EASYLIST_FILE);
} else {
    console.warn(`${EASYLIST_FILE} not found, ad IFRAMEs won't be tracked. See the README for how to download it.`);
}

// call Crawler
const crawler = new Crawler(sites, {
    debugMode: args.values.debug,
    adFrameDetector,
    timeout: timeout * 1000
});

await crawler.crawl();
