"use strict";

//
// Imports
//
const debug = require("debug")("crawler");
const puppeteer = require("puppeteer");
const chalk = require("chalk");
const sleep = require("await-sleep");
const resourceTimingFetchFn = require("./resourcetiming-gather").fetch;
const resourceTimingBufferSizeFn = require("./resourcetiming-buffer-size").exec;
const limit = require("limit-string-length");
const { URL } = require("url");
const fs = require("fs");

// create output streams
var outSites = fs.createWriteStream("output-sites.json");
var outUrls = fs.createWriteStream("output-urls.json");

//
// Functions
//
/**
 * Creates a new Crawler
 *
 * @param {string[]} sites Sites
 */
function Crawler(sites) {
    this.sites = sites;
}

/**
 * Starts the Crawler run
 */
Crawler.prototype.crawl = async function() {
    console.log(chalk.green("Starting Crawler"));

    // launch the browser
    let browser = await puppeteer.launch();

    // create a new page
    let page = await browser.newPage();

    // page responses
    let responses = [];

    // current URL we're downloading
    let currentUrl = "";

    // whether or not crawling is active
    let crawlingActive = false;

    // Listens for Page Responses
    page.on("response", async response => {
        if (!crawlingActive) {
            // don't track new responses if we're beyond monitoring
            return;
        }

        // skip the page itself
        if (response.url() === currentUrl ||
            response.url() === currentUrl + "/") {

            // update to the new location so we skip that too
            if (response.status() === 301 || response.status() === 302) {
                currentUrl = response.headers().location;
                console.log(`  -> redirect to ${currentUrl}`);
            }

            return;
        }

        if (response.status() === 301 || response.status() === 302) {
            // skip redirects
            return;
        }

        if (response.url().indexOf("http") !== 0) {
            // skip data: and other URLs
            return;
        }

        let resp = {
            url: response.url()
        };

        // track important headers
        const headers = response.headers();

        //
        // Content-Length
        //
        resp.contentLength = 0;
        if (headers["content-length"] && Number(headers["content-length"]) > 0) {
            resp.contentLength = Number(headers["content-length"]);
        } else {
            try {
                const buf = await response.buffer();
                resp.contentLength = buf.byteLength;
            } catch (e) {
                // NOP
            }
        }

        // Content-Type and Content-Encoding
        resp.contentType = headers["content-type"];
        resp.contentEncoding = headers["content-encoding"];

        // headers size
        var headerContents = "";
        for (var header in headers) {
            headerContents += header + ": " + headers[header] + "\n";
        }

        // header and transfer size
        resp.headerSize = headerContents.length;
        resp.transferSize = resp.contentLength + resp.headerSize;

        // find the asset type
        resp.assetType = getAssetTypeFor(resp.url, resp.contentType, resp.contentLength);
        if (!resp.assetType) {
            debug(`No asset type for ${resp.url}`);
        }

        // extract the host
        const urlParsed = new URL(resp.url);
        resp.host = urlParsed.host;

        console.log(
            "  ",
            chalk.underline(limit(resp.url, 80, " ")),
            resp.contentLength,
            resp.headerSize,
            resp.transferSize,
            resp.assetType);

        responses.push(resp);
    });

    // debug logging messages from the page
    page.on("console", function(msg) {
        debug(`Frame: ${msg.text()}`);
    });

    // make sure when the new document starts, we set the ResourceTiming buffer size listener
    page.evaluateOnNewDocument(resourceTimingBufferSizeFn);

    // run through each page
    for (let url of this.sites) {
        crawlingActive = false;

        if (url.indexOf("http://") !== 0 &&
            url.indexOf("https://") !== 0) {
            // start with the HTTP site
            url = "http://" + url + "/";
        }

        // reset responses and url
        responses = [];
        currentUrl = url;

        console.log(chalk.underline(url));

        //
        // Goto the specified URL
        //
        try {
            crawlingActive = true;

            await page.goto(url, {
                waitUntil: ["networkidle2", "load"],
                timeout: 30000
            });
        } catch (e) {
            console.log("Crawl timeout");
            continue;
        }

        //
        // Collect all ResourceTiming data
        //
        console.log("  [done loading, gathering ResourceTiming...]");

        let pageResourceTimingData = [];
        try {
            pageResourceTimingData = await page.evaluate(resourceTimingFetchFn);

            // done crawling, don't let other resources sneak in
            crawlingActive = false;

            console.log("  [done gathering, analyzing...]");

            // analyze ResourceTiming data
            await this.analyze(url, responses, pageResourceTimingData);
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

    // stop the browser
    browser.close();
};

/**
 * Analyzes the responses vs ResourceTiming
 *
 * @param {string} url URL
 * @param {Response} responses Responses
 * @param {object} pageResourceTimingData ResourceTimings
 */
Crawler.prototype.analyze = async function(url, responses, pageResourceTimingData) {
    const all = this.analyzeForAssetType(null, responses, pageResourceTimingData);
    const javascripts = this.analyzeForAssetType("javascript", responses, pageResourceTimingData);
    const css = this.analyzeForAssetType("css", responses, pageResourceTimingData);
    const images = this.analyzeForAssetType("image", responses, pageResourceTimingData);
    const xhrs = this.analyzeForAssetType("xhr", responses, pageResourceTimingData);
    const fonts = this.analyzeForAssetType("font", responses, pageResourceTimingData);
    const videos = this.analyzeForAssetType("video", responses, pageResourceTimingData);
    const pixels = this.analyzeForAssetType("pixel", responses, pageResourceTimingData);
    const html = this.analyzeForAssetType("html", responses, pageResourceTimingData);

    const bufferSize = pageResourceTimingData.bufferSize;
    const exceededDefaultBuffer = pageResourceTimingData.exceededDefaultBuffer;
    const mainFrameEntries = pageResourceTimingData.mainFrameEntries;

    // show the output
    console.log(all);

    // write the site JSON
    outSites.write(JSON.stringify({
        url, all, javascripts, css, images, xhrs, fonts, videos, pixels, html,
        bufferSize, exceededDefaultBuffer, mainFrameEntries
    }));

    outSites.write("\n");

    // write the URLs JSON
    for (let response of responses) {
        // link the site
        response.site = url;

        outUrls.write(JSON.stringify(response));
        outUrls.write("\n");
    }
};

/**
 * Analyzes the responses vs ResourceTiming for a specific asset type
 *
 * @param {string} assetType Asset type
 * @param {Response} responses Responses
 * @param {object} pageResourceTimingData ResourceTimings
 *
 * @returns {object} ResourceTiming data
 */
Crawler.prototype.analyzeForAssetType = function(assetType, responses, pageResourceTimingData) {
    let totalEntries = 0;
    let totalBytes = 0;
    let visibleEntries = 0;
    let visibleBytes = 0;
    let noTaoEntries = 0;
    let noTaoBytes = 0;
    let missingEntries = 0;
    let missingBytes = 0;

    for (let response of responses) {
        let url = response.url;

        // only look at the specified asset type
        if (assetType && assetType !== response.assetType) {
            continue;
        }

        // try to find a matching ResourceTiming
        let rt = pageResourceTimingData.resources.find(res => res.name === url);

        totalEntries++;
        totalBytes += response.transferSize;

        if (!rt) {
            // ResourceTiming Missing
            debug("\t", chalk.underline(url), "missing");
            missingEntries++;
            missingBytes += response.transferSize;
            response.missing = true;
        } else if (rt.noTao) {
            // ResourceTiming Restricted
            debug("\t", chalk.underline(url), "no TAO");
            noTaoEntries++;
            noTaoBytes += response.transferSize;
            response.noTao = true;
        } else {
            // ResourceTiming Visible
            visibleEntries++;
            visibleBytes += response.transferSize;
        }

        // track the frame depth too
        if (rt) {
            response.frameDepth = rt.frameDepth;
        }
    }

    return {
        totalEntries,
        totalBytes,
        visibleEntries,
        visibleBytes,
        noTaoEntries,
        noTaoBytes,
        missingEntries,
        missingBytes
    };
};

/**
 * Gets the asset type for a URL
 *
 * @param {string} url URL
 * @param {string} contentType Content-Type
 * @param {string} contentLength Content-Length
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
        if (url.indexOf(".woff") !== -1 ||
            url.indexOf(".ttf") !== -1) {
            return "font";
        } else if (url.indexOf(".html") !== -1) {
            return "html";
        }

        if (contentLength === 0) {
            return "pixel";
        }

        return undefined;
    }

    // fix content-type
    if (contentType.indexOf(";") !== -1) {
        contentType = contentType.substring(0, contentType.indexOf(";")).trim();
    }

    // Get Asset Type based on Content-Type
    switch (contentType.toLowerCase()) {
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

//
// Exports
//
module.exports = Crawler;
