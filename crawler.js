//
// Imports
//
import { createWriteStream } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { styleText } from "node:util";
import createDebug from "debug";
import puppeteer from "puppeteer";
import { gatherResourceTimings } from "./js/resourcetiming-gather.js";
import { trackResourceTimingBuffer } from "./js/resourcetiming-buffer-size.js";

const debug = createDebug("crawler");

//
// Constants
//
// output key -> which responses are in the group
const RESPONSE_GROUPS = {
    all: () => true,
    javascripts: r => r.assetType === "javascript",
    css: r => r.assetType === "css",
    images: r => r.assetType === "image",
    xhrs: r => r.assetType === "xhr",
    fonts: r => r.assetType === "font",
    videos: r => r.assetType === "video",
    pixels: r => r.assetType === "pixel",
    html: r => r.assetType === "html",

    // in an ad IFRAME (according to EasyList)
    adFrames: r => r.adFrame
};

const REDIRECT_STATUSES = new Set([301, 302]);

//
// Functions
//
/**
 * Crawls a list of sites, comparing what the browser downloads vs. what ResourceTiming sees
 */
export default class Crawler {
    /**
     * Creates a new Crawler
     *
     * @param {string[]} sites Sites
     * @param {object} [options] Options
     * @param {boolean} [options.debugMode] Debug mode
     * @param {AdFrameDetector} [options.adFrameDetector] Ad IFRAME detector (ad IFRAMEs aren't tracked if not set)
     * @param {number} [options.timeout] Page load timeout (ms)
     */
    constructor(sites, { debugMode = false, adFrameDetector = null, timeout = 30000 } = {}) {
        this.sites = sites;
        this.debugMode = debugMode;
        this.adFrameDetector = adFrameDetector;
        this.timeout = timeout;

        // totals across all sites
        this.totals = {
            sites: 0,
            entries: 0,
            bytes: 0,
            adFrameEntries: 0,
            adFrameBytes: 0,
            missingEntries: 0,
            missingEntriesAllowingAccessToEasyListFrames: 0
        };
    }

    /**
     * Starts the Crawler run
     */
    async crawl() {
        console.log(styleText("green", "Starting Crawler"));

        // create output streams
        this.outSites = createWriteStream("output-sites.json");
        this.outUrls = createWriteStream("output-urls.json");

        // launch the browser
        const browser = await puppeteer.launch();

        try {
            await this.crawlSites(browser);

            this.logTotals();
        } finally {
            // stop the browser
            await browser.close();

            await Promise.all([
                new Promise(resolve => this.outSites.end(resolve)),
                new Promise(resolve => this.outUrls.end(resolve))
            ]);
        }
    }

    /**
     * Crawls each of the sites in a single browser tab
     *
     * @param {Browser} browser Puppeteer Browser
     */
    async crawlSites(browser) {
        // create a new page
        const page = await browser.newPage();

        // page responses
        let responses = [];

        // current URL we're downloading
        let currentUrl = "";

        // whether or not crawling is active
        let crawlingActive = false;

        // original URLs from redirects
        const redirectOrigUrls = new Map();

        // Listens for Page Responses
        page.on("response", async response => {
            if (!crawlingActive) {
                // don't track new responses if we're beyond monitoring
                return;
            }

            const responseUrl = response.url();
            const isRedirect = REDIRECT_STATUSES.has(response.status());

            // skip the page itself
            if (responseUrl === currentUrl || responseUrl === `${currentUrl}/`) {
                // update to the new location so we skip that too
                if (isRedirect) {
                    currentUrl = new URL(response.headers().location, responseUrl).href;
                    console.log(`  -> redirect to ${currentUrl}`);
                }

                return;
            }

            if (isRedirect) {
                // skip redirects, saving the data so we know where later responses
                // came from
                const redirectedUrl = new URL(response.headers().location, responseUrl).href;

                redirectOrigUrls.set(redirectedUrl, responseUrl);

                return;
            }

            if (!responseUrl.startsWith("http")) {
                // skip data: and other URLs
                return;
            }

            // track from the redirect
            const url = redirectOrigUrls.get(responseUrl) ?? responseUrl;

            // track important headers
            const headers = response.headers();

            //
            // Content-Length
            //
            let contentLength = Number(headers["content-length"]) || 0;

            if (contentLength <= 0) {
                try {
                    contentLength = (await response.content()).byteLength;
                } catch {
                    contentLength = 0;
                }
            }

            // headers size
            const headerSize = Object.entries(headers)
                .map(([name, value]) => `${name}: ${value}\n`)
                .join("")
                .length;

            const contentType = headers["content-type"];

            // the frame that loaded this response, and if it's in an ad IFRAME
            const frame = response.frame();
            const isFrameDocument = response.request().isNavigationRequest() &&
                Boolean(frame?.parentFrame());

            // an IFRAME's own document is loaded before the Frame's URL is updated
            const frameUrl = isFrameDocument ? responseUrl : frame?.url();
            const frameInfo = this.adFrameDetector?.analyze(frame, frameUrl);

            const resp = {
                url,
                contentLength,

                // Access-Control-Allow-Origin
                acao: headers["access-control-allow-origin"],

                // Content-Type and Content-Encoding
                contentType,
                contentEncoding: headers["content-encoding"],

                // header and transfer size
                headerSize,
                transferSize: contentLength + headerSize,

                // find the asset type
                assetType: getAssetTypeFor(url, contentType, contentLength),

                // extract the host
                host: new URL(url).host,

                // frame
                frameUrl
            };

            if (frameInfo) {
                const { adFrame, crossOrigin, accessibleWithAdFrameException } = frameInfo;

                resp.adFrame = Boolean(adFrame);
                resp.adFrameUrl = adFrame?.url;
                resp.adFilter = adFrame?.filter;

                // in a cross-origin IFRAME (so not reachable by the main frame), and if it
                // would be reachable if EasyList IFRAMEs were accessible
                resp.crossOriginFrame = crossOrigin;
                resp.accessibleWithAdFrameException = accessibleWithAdFrameException;
            }

            if (!resp.assetType) {
                debug(`No asset type for ${resp.url}`);
            }

            console.log(
                "  ",
                styleText("underline", truncate(resp.url, 80)),
                resp.contentLength,
                resp.headerSize,
                resp.transferSize,
                resp.assetType,
                resp.adFrame ? styleText("yellow", "[ad frame]") : "");

            responses.push(resp);
        });

        // debug logging messages from the page
        page.on("console", msg => debug(`Frame: ${msg.text()}`));

        // make sure when the new document starts, we set the ResourceTiming buffer size listener
        await page.evaluateOnNewDocument(trackResourceTimingBuffer);

        // run through each page
        for (let url of this.sites) {
            crawlingActive = false;

            if (!url.startsWith("http://") && !url.startsWith("https://")) {
                // start with the HTTP site
                url = `http://${url}/`;
            }

            // reset responses and url
            responses = [];
            currentUrl = url;

            console.log(styleText("underline", url));

            //
            // Goto the specified URL
            //
            try {
                crawlingActive = true;

                await page.goto(url, {
                    waitUntil: ["networkidle2", "load"],
                    timeout: this.timeout
                });
            } catch (e) {
                console.log(e.name === "TimeoutError" ?
                    `Crawl timeout (${this.timeout / 1000}s)` :
                    `Crawl error: ${e.message}`);
                continue;
            }

            //
            // Collect all ResourceTiming data
            //
            console.log("  [done loading, gathering ResourceTiming...]");

            try {
                const pageResourceTimingData = await page.evaluate(gatherResourceTimings);

                // done crawling, don't let other resources sneak in
                crawlingActive = false;

                console.log("  [done gathering, analyzing...]");

                // analyze ResourceTiming data
                this.analyze(url, responses, pageResourceTimingData);
            } catch (e) {
                console.error("  [error in analysis]", e);
            }

            // go to about:blank so unload beacons get sent out for the previous page
            // before the next one
            await page.goto("about:blank", {
                waitUntil: ["networkidle2", "load"],
                timeout: 5000
            });

            await sleep(2000);
        }
    }

    /**
     * Analyzes the responses vs ResourceTiming
     *
     * @param {string} url URL
     * @param {object[]} responses Responses
     * @param {object} pageResourceTimingData ResourceTimings
     */
    analyze(url, responses, pageResourceTimingData) {
        // index ResourceTimings by URL (keeping the first entry for each, if duplicated)
        const resourceTimingsByUrl = new Map();

        for (const res of pageResourceTimingData.resources) {
            if (!resourceTimingsByUrl.has(res.name)) {
                resourceTimingsByUrl.set(res.name, res);
            }
        }

        const groups = Object.fromEntries(
            Object.entries(RESPONSE_GROUPS)
                .filter(([key]) => key !== "adFrames" || this.adFrameDetector)
                .map(([key, inGroup]) =>
                    [key, this.analyzeGroup(key, responses.filter(inGroup), resourceTimingsByUrl)]));

        const { all, adFrames } = groups;

        this.totals.sites++;
        this.totals.entries += all.totalEntries;
        this.totals.bytes += all.totalBytes;
        this.totals.missingEntries += all.missingEntries;
        this.totals.missingEntriesAllowingAccessToEasyListFrames +=
            all.missingEntriesAllowingAccessToEasyListFrames ?? 0;

        const {
            bufferSize,
            exceededDefaultBuffer,
            mainFrameEntries,
            clearResourceTimingsCalled
        } = pageResourceTimingData;

        // show the output
        console.log(all);

        let adFrameStats;

        if (adFrames) {
            adFrameStats = {
                adFrameCount: new Set(responses.map(r => r.adFrameUrl).filter(Boolean)).size,
                adFrameEntriesPct: percent(adFrames.totalEntries, all.totalEntries),
                adFrameBytesPct: percent(adFrames.totalBytes, all.totalBytes)
            };

            this.totals.adFrameEntries += adFrames.totalEntries;
            this.totals.adFrameBytes += adFrames.totalBytes;

            console.log(styleText("yellow",
                `  Ad IFRAMEs: ${adFrameStats.adFrameCount}, ` +
                `${adFrames.totalEntries} resources (${adFrameStats.adFrameEntriesPct}%), ` +
                `${adFrames.totalBytes} bytes (${adFrameStats.adFrameBytesPct}%)`));
        }

        // write the site JSON
        this.outSites.write(JSON.stringify({
            url,
            ...groups,
            ...adFrameStats,
            bufferSize,
            exceededDefaultBuffer,
            mainFrameEntries,
            clearResourceTimingsCalled
        }) + "\n");

        // write the URLs JSON
        for (const response of responses) {
            // link the site
            response.site = url;

            this.outUrls.write(JSON.stringify(response) + "\n");
        }

        if (this.debugMode) {
            console.log(`Visible (${all.visibleEntries + all.noTaoEntries}):`);

            for (const response of responses.filter(r => !r.missing)) {
                console.log(`\t${response.url}`);
            }

            console.log(`Missing (${all.missingEntries}):`);

            for (const response of responses.filter(r => r.missing).sort((a, b) => a.url.localeCompare(b.url))) {
                console.log(`\t${response.url}`);
            }
        }
    }

    /**
     * Logs the totals across all sites
     */
    logTotals() {
        const {
            sites,
            entries,
            bytes,
            adFrameEntries,
            adFrameBytes,
            missingEntries,
            missingEntriesAllowingAccessToEasyListFrames
        } = this.totals;

        console.log(styleText("green", `Crawled ${sites} sites: ${entries} resources, ${bytes} bytes`));

        if (this.adFrameDetector) {
            console.log(styleText("green",
                `  In ad IFRAMEs: ${adFrameEntries} resources (${percent(adFrameEntries, entries)}%), ` +
                `${adFrameBytes} bytes (${percent(adFrameBytes, bytes)}%)`));

            console.log(styleText("green",
                `  Missing from ResourceTiming: ${missingEntries} resources, ` +
                `${missingEntriesAllowingAccessToEasyListFrames} ` +
                `(${percent(missingEntriesAllowingAccessToEasyListFrames, missingEntries)}%) ` +
                "would be visible if EasyList IFRAMEs were accessible"));
        }
    }

    /**
     * Analyzes a group of responses vs ResourceTiming
     *
     * @param {string} group Group name (for logging)
     * @param {object[]} responses Responses in the group
     * @param {Map<string, object>} resourceTimingsByUrl ResourceTimings, by URL
     *
     * @returns {object} ResourceTiming data
     */
    analyzeGroup(group, responses, resourceTimingsByUrl) {
        const stats = {
            totalEntries: 0,
            totalBytes: 0,
            visibleEntries: 0,
            visibleBytes: 0,
            noTaoEntries: 0,
            noTaoBytes: 0,
            noTaoAcaoWouldHelpEntries: 0,
            noTaoAcaoWouldHelpBytes: 0,
            missingEntries: 0,
            missingBytes: 0
        };

        if (this.adFrameDetector) {
            // missing, but would be visible if EasyList IFRAMEs were accessible to the main frame
            stats.missingEntriesAllowingAccessToEasyListFrames = 0;
            stats.missingBytesAllowingAccessToEasyListFrames = 0;
        }

        for (const response of responses) {
            const { url, transferSize } = response;

            // try to find a matching ResourceTiming
            const rt = resourceTimingsByUrl.get(url);

            stats.totalEntries++;
            stats.totalBytes += transferSize;

            if (!rt) {
                // ResourceTiming Missing
                debug("\t", styleText("underline", url), `[${group}]`, "missing");
                stats.missingEntries++;
                stats.missingBytes += transferSize;
                response.missing = true;

                if (response.accessibleWithAdFrameException) {
                    stats.missingEntriesAllowingAccessToEasyListFrames++;
                    stats.missingBytesAllowingAccessToEasyListFrames += transferSize;
                }
            } else if (rt.noTao) {
                // ResourceTiming Restricted
                stats.noTaoEntries++;
                stats.noTaoBytes += transferSize;

                if (response.acao) {
                    debug("\t", styleText("underline", url), `[${group}]`, "no TAO / has ACAO");
                    stats.noTaoAcaoWouldHelpEntries++;
                    stats.noTaoAcaoWouldHelpBytes += transferSize;
                } else {
                    debug("\t", styleText("underline", url), `[${group}]`, "no TAO");
                }
            } else {
                // ResourceTiming Visible
                stats.visibleEntries++;
                stats.visibleBytes += transferSize;
            }

            // track the frame depth too
            if (rt) {
                response.frameDepth = rt.frameDepth;
            }
        }

        return stats;
    }
}

/**
 * Calculates a percentage, rounded to 2 decimal places
 *
 * @param {number} value Value
 * @param {number} total Total
 *
 * @returns {number} Percentage (0 if total is 0)
 */
function percent(value, total) {
    return total ? Math.round(value / total * 10000) / 100 : 0;
}

/**
 * Truncates or right-pads a string to an exact length
 *
 * @param {string} str String
 * @param {number} length Length
 *
 * @returns {string} String of exactly the specified length
 */
function truncate(str, length) {
    return str.length > length ? str.slice(0, length) : str.padEnd(length, " ");
}

/**
 * Gets the asset type for a URL
 *
 * @param {string} url URL
 * @param {string} contentType Content-Type
 * @param {number} contentLength Content-Length
 *
 * @returns {undefined|string} Asset type, if detected
 */
function getAssetTypeFor(url, contentType, contentLength) {
    if (!contentType && !url) {
        return undefined;
    }

    // if we don't have the Content-Type, try a few URL sniffs
    if (!contentType) {
        // URL sniffing
        if (url.includes(".woff") || url.includes(".ttf")) {
            return "font";
        } else if (url.includes(".html")) {
            return "html";
        }

        if (contentLength === 0) {
            return "pixel";
        }

        return undefined;
    }

    // strip any parameters (e.g. "; charset=utf-8")
    const mimeType = contentType.split(";")[0].trim().toLowerCase();

    // Get Asset Type based on Content-Type
    switch (mimeType) {
        case "application/javascript":
        case "application/x-javascript":
        case "text/javascript":
        case "application/ecmascript":
        case "application/js":
            return "javascript";

        case "text/css":
            return "css";

        case "application/json":
        case "application/ld+json":
        case "application/manifest+json":
        case "application/xml":
        case "text/plain":
        case "text/xml":
        case "text/x-json":
        case "text/json":
        case "application/x-json":
            return "xhr";

        case "application/font-otf":
        case "application/font-sfnt":
        case "application/font-woff":
        case "application/font-woff2":
        case "application/font":
        case "application/otf":
        case "application/vnd.ms-fontobject":
        case "application/x-font-opentype":
        case "application/x-font-otf":
        case "application/x-font-truetype":
        case "application/x-font-ttf":
        case "font/eot":
        case "font/opentype":
        case "font/otf":
        case "font/woff":
        case "font/woff2":
        case "font/ttf":
        case "application/x-font-woff":
        case "font/x-woff":
        case "application/x-woff":
            return "font";

        case "image/bmp":
        case "image/gif":
        case "image/jpeg":
        case "image/jpg":
        case "image/psd":
        case "image/tiff":
        case "image/jp2":
        case "image/ico":
        case "image/icon":
        case "image/pjpeg":
        case "image/png":
        case "image/svg+xml":
        case "image/vnd.microsoft.icon":
        case "image/webp":
        case "image/x-icon":
        case "image/x-png":
        case "image":
            return "image";

        // not used
        case "text/html":
        case "application/html":
        case "application/x-iframe-html":
            return "html";

        case "video/mp4":
        case "video/webm":
        case "text/vtt":
        case "video/x-flv":
        case "video/ogg":
            return "video";

        case "audio/webm":
            return "audio";
    }

    // common 1x1 pixel
    if (contentLength === 42 || contentLength === 43) {
        return "pixel";
    }

    // more sniffing based on URL
    if (url.endsWith(".js")) {
        return "javascript";
    } else if (url.endsWith(".json")) {
        return "xhr";
    } else if (url.endsWith(".css")) {
        return "css";
    } else if (url.endsWith(".gif") ||
               url.endsWith(".png") ||
               url.endsWith(".jpg")) {
        return "image";
    }

    return undefined;
}
