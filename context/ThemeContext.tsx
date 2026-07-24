import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useColorScheme } from "react-native";

export type ThemeMode = "light" | "dark";

type ThemeContextType = {
  themeMode: ThemeMode | null;
  resolvedTheme: ThemeMode;
  isThemeLoaded: boolean;
  setThemeMode: (mode: ThemeMode) => Promise<void>;
  clearThemeMode: () => Promise<void>;
};

const ThemeContext = createContext<ThemeContextType | null>(null);
const THEME_STORAGE_KEY = "theme_mode";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [themeMode, setThemeModeState] = useState<ThemeMode | null>(null);
  const [isThemeLoaded, setIsThemeLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(THEME_STORAGE_KEY)
      .then((value) => {
        if (value === "light" || value === "dark") {
          setThemeModeState(value);
        }
      })
      .finally(() => setIsThemeLoaded(true));
  }, []);

  const setThemeMode = async (mode: ThemeMode) => {
    setThemeModeState(mode);
    await AsyncStorage.setItem(THEME_STORAGE_KEY, mode);
  };

  const clearThemeMode = async () => {
    setThemeModeState(null);
    await AsyncStorage.removeItem(THEME_STORAGE_KEY);
  };

  const resolvedTheme: ThemeMode = themeMode || (systemScheme === "dark" ? "dark" : "light");

  const value = useMemo(
    () => ({ themeMode, resolvedTheme, isThemeLoaded, setThemeMode, clearThemeMode }),
    [themeMode, resolvedTheme, isThemeLoaded]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemeMode() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useThemeMode must be used within ThemeProvider");
  return ctx;
}