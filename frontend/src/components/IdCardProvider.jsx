import React, { createContext, useContext, useState, useCallback, useRef } from "react";
import { PersonIdCard } from "./common/PersonIdCard";

const IdCardContext = createContext(null);

const DEFAULT_DURATION_MS = 1500;

/**
 * IdCardProvider manages the global state of the ID Card modal.
 */
export const IdCardProvider = ({ children }) => {
    const [activeScanCard, setActiveScanCard] = useState(null);
    const timerRef = useRef(null);

    const clearIdCardTimer = useCallback(() => {
        if (timerRef.current) {
            window.clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    const dismissIdCard = useCallback(() => {
        clearIdCardTimer();
        setActiveScanCard(null);
    }, [clearIdCardTimer]);

    const showIdCard = useCallback((personDetails, duration = DEFAULT_DURATION_MS) => {
        clearIdCardTimer();
        setActiveScanCard(personDetails);
        timerRef.current = window.setTimeout(() => {
            setActiveScanCard(null);
        }, duration);
    }, [clearIdCardTimer]);

    return (
        <IdCardContext.Provider value={{ showIdCard, dismissIdCard }}>
            {children}
            {activeScanCard && (
                <PersonIdCard person={activeScanCard} onDismiss={dismissIdCard} />
            )}
        </IdCardContext.Provider>
    );
};

export const useIdCard = () => {
    const context = useContext(IdCardContext);
    if (!context) {
        throw new Error("useIdCard must be used within an IdCardProvider");
    }
    return context;
};
