//
// Imports
//
import { readFile } from "node:fs/promises";
import { FiltersEngine, Request } from "@ghostery/adblocker";

//
// Functions
//
/**
 * Detects whether a frame is (or is nested within) an ad IFRAME, according to EasyList
 */
export default class AdFrameDetector {
    /**
     * Creates a new AdFrameDetector
     *
     * @param {FiltersEngine} engine Ad-blocking filters engine
     */
    constructor(engine) {
        this.engine = engine;

        // cache of "frame URL\nparent frame URL" -> filter that matched (or null)
        this.cache = new Map();
    }

    /**
     * Loads an AdFrameDetector from an EasyList (Adblock Plus syntax) file
     *
     * @param {string} file EasyList file path
     *
     * @returns {Promise<AdFrameDetector>} AdFrameDetector
     */
    static async load(file) {
        const engine = FiltersEngine.parse(await readFile(file, "utf-8"), {
            loadCosmeticFilters: false
        });

        return new AdFrameDetector(engine);
    }

    /**
     * Finds the outermost ad IFRAME that a frame is in (including the frame itself).
     *
     * @param {Frame|null} frame Puppeteer Frame
     * @param {string} [frameUrl] URL of the frame, if known (e.g. for an IFRAME's own
     *  document request, before the Frame's URL has been updated)
     *
     * @returns {{url: string, filter: string}|null} Ad IFRAME URL and EasyList filter that matched, if any
     */
    match(frame, frameUrl) {
        let adFrame = null;
        let url = frameUrl ?? frame?.url();

        // walk up to (but not including) the main frame, keeping the outermost ad IFRAME
        for (let parent = frame?.parentFrame(); parent; parent = parent.parentFrame()) {
            const filter = this.matchUrl(url, parent.url());

            if (filter) {
                adFrame = { url, filter };
            }

            url = parent.url();
        }

        return adFrame;
    }

    /**
     * Determines if an IFRAME URL is blocked by EasyList
     *
     * @param {string} url IFRAME URL
     * @param {string} parentUrl URL of the frame containing the IFRAME
     *
     * @returns {string|null} EasyList filter that matched, if any
     */
    matchUrl(url, parentUrl) {
        if (!url?.startsWith("http")) {
            // about:blank, srcdoc, etc
            return null;
        }

        const key = `${url}\n${parentUrl}`;

        if (!this.cache.has(key)) {
            const { match, filter } = this.engine.match(Request.fromRawDetails({
                url,
                sourceUrl: parentUrl,
                type: "sub_frame"
            }));

            this.cache.set(key, match ? filter.toString() : null);
        }

        return this.cache.get(key);
    }
}
