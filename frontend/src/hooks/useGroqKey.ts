"use client";

import { useState, useEffect, useCallback } from "react";

export const GROQ_STORAGE_KEY = "user_groq_key";
export const LEGACY_GROQ_KEY = "groq_api_key";
const EVENT_NAME = "groq-key-updated";

/**
 * Safely get the current Groq API key from localStorage,
 * migrating from legacy key if found.
 */
export function getSavedGroqKey(): string {
  if (typeof window === "undefined") return "";
  try {
    const current = localStorage.getItem(GROQ_STORAGE_KEY);
    if (current && current.trim()) {
      return current.trim();
    }
    // Migration fallback from old key name
    const legacy = localStorage.getItem(LEGACY_GROQ_KEY);
    if (legacy && legacy.trim()) {
      localStorage.setItem(GROQ_STORAGE_KEY, legacy.trim());
      localStorage.removeItem(LEGACY_GROQ_KEY);
      return legacy.trim();
    }
  } catch (err) {
    console.error("Failed to read Groq API key from localStorage:", err);
  }
  return "";
}

/**
 * Persist Groq key and notify all components/tabs.
 */
export function saveGroqKey(key: string): void {
  if (typeof window === "undefined") return;
  try {
    const cleanKey = key.trim();
    if (cleanKey) {
      localStorage.setItem(GROQ_STORAGE_KEY, cleanKey);
      localStorage.removeItem(LEGACY_GROQ_KEY);
    } else {
      localStorage.removeItem(GROQ_STORAGE_KEY);
      localStorage.removeItem(LEGACY_GROQ_KEY);
    }
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: cleanKey }));
  } catch (err) {
    console.error("Failed to save Groq API key:", err);
  }
}

/**
 * Custom React hook for dynamic BYOK state sync across all UI components.
 */
export function useGroqKey() {
  const [apiKey, setApiKeyState] = useState<string>("");
  const [isLoaded, setIsLoaded] = useState<boolean>(false);

  useEffect(() => {
    const initialKey = getSavedGroqKey();
    setApiKeyState(initialKey);
    setIsLoaded(true);

    const handleKeyChange = (e: Event) => {
      const customEvent = e as CustomEvent<string>;
      if (typeof customEvent.detail === "string") {
        setApiKeyState(customEvent.detail);
      } else {
        setApiKeyState(getSavedGroqKey());
      }
    };

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === GROQ_STORAGE_KEY || e.key === LEGACY_GROQ_KEY) {
        setApiKeyState(getSavedGroqKey());
      }
    };

    window.addEventListener(EVENT_NAME, handleKeyChange);
    window.addEventListener("storage", handleStorageChange);

    return () => {
      window.removeEventListener(EVENT_NAME, handleKeyChange);
      window.removeEventListener("storage", handleStorageChange);
    };
  }, []);

  const updateKey = useCallback((newKey: string) => {
    saveGroqKey(newKey);
    setApiKeyState(newKey.trim());
  }, []);

  const clearKey = useCallback(() => {
    saveGroqKey("");
    setApiKeyState("");
  }, []);

  return {
    apiKey,
    hasPersonalKey: Boolean(apiKey.trim()),
    isLoaded,
    updateKey,
    clearKey,
  };
}
