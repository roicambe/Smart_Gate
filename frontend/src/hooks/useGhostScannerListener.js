import { useEffect, useRef } from "react";

const SCANNER_THRESHOLD_MS = 30;
const BUFFER_TIMEOUT_MS = 500;
const MIN_SCANNER_LENGTH = 5;

const isEditableElement = (element) => (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    element?.isContentEditable
);

const isPrintableKey = (event) => (
    event.key.length === 1 &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
);

const scrubLeakedCharacters = (element, leakedCount) => {
    if (
        !element ||
        leakedCount <= 0 ||
        !(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)
    ) {
        return;
    }

    if (element instanceof HTMLInputElement) {
        const supportedTypes = new Set([
            "text",
            "search",
            "tel",
            "url",
            "password"
        ]);

        if (!supportedTypes.has(element.type)) {
            return;
        }
    }

    const cursor = typeof element.selectionStart === "number"
        ? element.selectionStart
        : element.value.length;

    if (typeof cursor !== "number" || Number.isNaN(cursor)) {
        return;
    }

    const deleteStart = Math.max(0, cursor - leakedCount);
    try {
        element.setRangeText("", deleteStart, cursor, "end");
        element.dispatchEvent(new Event("input", { bubbles: true }));
    } catch (_) {
        // Some browser/input combos still reject selection APIs; skip scrubbing in that case.
    }
};

export const useGhostScannerListener = ({ enabled, onScanBuffer }) => {
    const callbackRef = useRef(onScanBuffer);
    const scannerStateRef = useRef({
        buffer: "",
        isScannerEvent: false,
        leakedCount: 0,
        sourceElement: null,
        lastKeyAt: 0,
        timeoutId: null
    });

    useEffect(() => {
        callbackRef.current = onScanBuffer;
    }, [onScanBuffer]);

    const resetBuffer = () => {
        const state = scannerStateRef.current;
        state.buffer = "";
        state.isScannerEvent = false;
        state.leakedCount = 0;
        state.sourceElement = null;

        if (state.timeoutId) {
            window.clearTimeout(state.timeoutId);
            state.timeoutId = null;
        }
    };

    useEffect(() => {
        if (!enabled) {
            resetBuffer();
            return undefined;
        }

        const handleKeyDown = (event) => {
            const state = scannerStateRef.current;
            const now = performance.now();
            const timeDiff = now - state.lastKeyAt;
            state.lastKeyAt = now;

            if (state.buffer.length > 0 && timeDiff > SCANNER_THRESHOLD_MS) {
                resetBuffer();
            }

            if (event.key === "Enter") {
                if (state.isScannerEvent) {
                    event.preventDefault();
                    event.stopPropagation();
                    if (state.buffer.length >= MIN_SCANNER_LENGTH) {
                        callbackRef.current?.(state.buffer);
                    }
                }
                resetBuffer();
                return;
            }

            if (!isPrintableKey(event)) {
                if (state.isScannerEvent) {
                    event.preventDefault();
                    event.stopPropagation();
                }
                return;
            }

            if (!state.buffer.length) {
                state.sourceElement = isEditableElement(event.target) ? event.target : null;
                state.leakedCount = 0;
            }

            if (state.buffer.length > 0 && timeDiff <= SCANNER_THRESHOLD_MS && !state.isScannerEvent) {
                state.isScannerEvent = true;
                scrubLeakedCharacters(state.sourceElement, state.leakedCount);
            }

            if (!state.isScannerEvent) {
                state.leakedCount += 1;
            } else {
                event.preventDefault();
                event.stopPropagation();
            }

            state.buffer += event.key;

            if (state.timeoutId) {
                window.clearTimeout(state.timeoutId);
            }

            state.timeoutId = window.setTimeout(() => {
                resetBuffer();
            }, BUFFER_TIMEOUT_MS);
        };

        window.addEventListener("keydown", handleKeyDown, { capture: true });
        return () => {
            window.removeEventListener("keydown", handleKeyDown, { capture: true });
            resetBuffer();
        };
    }, [enabled]);
};
