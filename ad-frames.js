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
     * Analyzes the IFRAMEs a frame is in (including the frame itself), up to the main frame.
     *
     * @param {Frame|null} frame Puppeteer Frame
     * @param {string} [frameUrl] URL of the frame, if known (e.g. for an IFRAME's own
     *  document request, before the Frame's URL has been updated)
     *
     * @returns {{
     *   adFrame: {url: string, filter: string}|null,
     *   crossOrigin: boolean,
     *   accessibleWithAdFrameException: boolean
     * }} The outermost ad IFRAME (and EasyList filter that matched), if any; whether any IFRAME
     *  is cross-origin to the main frame; and whether all of the cross-origin IFRAMEs are ad IFRAMEs
     *  (so the main frame could reach the frame if ad IFRAMEs were made accessible)
     */
    analyze(frame, frameUrl) {
        // IFRAMEs from the frame up to (but not including) the main frame
        const chain = [];
        let url = frameUrl ?? frame?.url();

        for (let parent = frame?.parentFrame(); parent; parent = parent.parentFrame()) {
            chain.push({ url, parentUrl: parent.url() });
            url = parent.url();
        }

        // after the walk, url is the main frame's
        const mainOrigin = originOf(url);

        let adFrame = null;
        let crossOrigin = false;
        let accessibleWithAdFrameException = true;

        for (const { url: iframeUrl, parentUrl } of chain) {
            const filter = this.matchUrl(iframeUrl, parentUrl);

            // keep the outermost ad IFRAME (the chain goes from innermost to outermost)
            if (filter) {
                adFrame = { url: iframeUrl, filter };
            }

            // about:blank and srcdoc IFRAMEs inherit their creator's origin, so are only
            // inaccessible if a frame above them is
            const iframeOrigin = originOf(iframeUrl);

            if (iframeOrigin && iframeOrigin !== mainOrigin) {
                crossOrigin = true;

                if (!filter) {
                    accessibleWithAdFrameException = false;
                }
            }
        }

        return {
            adFrame,
            crossOrigin,
            accessibleWithAdFrameException: crossOrigin && accessibleWithAdFrameException
        };
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

/**
 * Gets the origin of an HTTP(S) URL
 *
 * @param {string} url URL
 *
 * @returns {string|null} Origin, or null for non-HTTP(S) URLs (e.g. about:blank)
 */
function originOf(url) {
    return url?.startsWith("http") ? new URL(url).origin : null;
}
