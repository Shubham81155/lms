"use client";

import React from "react";
import { Sun, Moon } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";

export const ThemeToggle: React.FC<{ className?: string }> = ({ className = "" }) => {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      type="button"
      title={theme === "dark" ? "Switch to Light Theme" : "Switch to Dark Theme"}
      aria-label="Toggle theme"
      className={`p-2 rounded-xl border border-line bg-surface hover:bg-raised shadow-sm transition-all flex items-center justify-center ${
        theme === "dark" ? "text-accent" : "text-brand-fg"
      } ${className}`}
    >
      {theme === "dark" ? (
        <Sun className="h-4 w-4 transition-transform hover:rotate-45" />
      ) : (
        <Moon className="h-4 w-4 transition-transform hover:-rotate-12" />
      )}
    </button>
  );
};
