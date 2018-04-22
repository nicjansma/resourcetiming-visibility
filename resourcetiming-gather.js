"use strict";
/* eslint-env browser */
//
// Exports
//
exports.fetch = async function() {
    /**
     * Determines if the frame is accessible and has the performance object
     *
     * @param {Frame} frame Frame
     *
     * @returns {boolean} True if accessible
     */
    function isFrameAccessible(frame) {
        /* eslint-disable-next-line no-unused-vars */
        var dummy;

        try {
            dummy = frame.location && frame.location.href;
            dummy = frame.document;

            if (("performance" in frame) && frame.performance) {
                return true;
            }
        } catch (e) {
            // NOP
        }

        return false;
    }

    /**
     * Crawls the frame
     *
     * @param {Frame} frame Frame
     * @param {boolean} isTopWindow If the top window
     * @param {number} depth Frame depth
     *
     * @returns {object} ResourceTiming data
     */
    function crawlFrame(frame, isTopWindow, depth) {
        console.log(`Crawling frame top: ${isTopWindow} depth: ${depth}`);

        let entries = [];

        try {
            if (!isFrameAccessible(frame)) {
                return [];
            }

            console.log(`  url: ${frame.location.href}`);

            if (frame.frames) {
                for (let i = 0; i < frame.frames.length; i++) {
                    entries = entries.concat(crawlFrame(frame.frames[i], false, depth + 1, i));
                }
            }

            if (typeof frame.performance.getEntriesByType !== "function") {
                return [];
            }

            let frameEntries = frame.performance.getEntriesByType("resource");

            for (let i = 0; frameEntries && i < frameEntries.length; i++) {
                let res = frameEntries[i];

                // reduce to what we want in the analyzer
                let rtEntry = {
                    name: res.name,
                    initiatorType: res.initiatorType,
                    transferSize: res.transferSize,
                    decodedBodySize: res.decodedBodySize,
                    noTao: res.responseStart === 0,
                    responseStart: res.responseStart,
                    frameDepth: depth
                };

                entries.push(rtEntry);
            }
        } catch (e) {
            // NOP
        }

        return entries;
    }

    return {
        resources: crawlFrame(window, true, 0, 0, 0),
        bufferSize: window.setResourceTimingBufferSize ? window.setResourceTimingBufferSize : 150,
        exceededDefaultBuffer: window.performance.getEntriesByType("resource").length >= 150,
        mainFrameEntries: window.performance.getEntriesByType("resource").length
    };
};
