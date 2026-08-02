"use client";

import { useEffect } from "react";

type Props = {
  onDigit: (d: string) => void;
  onClear: () => void;
  onSubmit: () => void;
  disabled?: boolean;
  canSubmit?: boolean;
  hideSubmit?: boolean;
};

export function Keypad({
  onDigit,
  onClear,
  onSubmit,
  disabled,
  canSubmit,
  hideSubmit,
}: Props) {
  // Keyboard support — handy if a keyboard is plugged in.
  useEffect(() => {
    if (disabled) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key >= "0" && e.key <= "9") {
        onDigit(e.key);
      } else if (e.key === "Backspace" || e.key === "Delete" || e.key === "Escape") {
        onClear();
      } else if (e.key === "Enter") {
        if (canSubmit && !hideSubmit) onSubmit();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onDigit, onClear, onSubmit, disabled, canSubmit, hideSubmit]);

  const cells = [
    { label: "1", value: "1" },
    { label: "2", value: "2" },
    { label: "3", value: "3" },
    { label: "4", value: "4" },
    { label: "5", value: "5" },
    { label: "6", value: "6" },
    { label: "7", value: "7" },
    { label: "8", value: "8" },
    { label: "9", value: "9" },
  ];

  return (
    <div className="grid grid-cols-3 gap-3 select-none">
      {cells.map((c) => (
        <KeypadButton
          key={c.value}
          label={c.label}
          onPress={() => onDigit(c.value)}
          disabled={disabled}
        />
      ))}
      <KeypadButton
        label="✕"
        onPress={onClear}
        disabled={disabled}
        variant="ghost"
        ariaLabel="Clear"
      />
      <KeypadButton
        label="0"
        onPress={() => onDigit("0")}
        disabled={disabled}
      />
      {hideSubmit ? (
        <KeypadButton label="" onPress={() => {}} disabled invisible />
      ) : (
        <KeypadButton
          label="↵"
          onPress={onSubmit}
          disabled={disabled || !canSubmit}
          variant="accent"
          ariaLabel="Submit"
        />
      )}
    </div>
  );
}

function KeypadButton({
  label,
  onPress,
  disabled,
  variant = "default",
  ariaLabel,
  invisible,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: "default" | "ghost" | "accent";
  ariaLabel?: string;
  invisible?: boolean;
}) {
  const base =
    "h-20 rounded-2xl text-3xl font-semibold reveal flex items-center justify-center transition-all";
  const styles =
    variant === "accent"
      ? {
          background: "linear-gradient(180deg, #ffd35a 0%, #e0a91d 100%)",
          color: "#0a2540",
          boxShadow:
            "0 1px 0 rgba(255,255,255,0.4) inset, 0 6px 18px rgba(255,200,61,0.32)",
        }
      : variant === "ghost"
        ? {
            background: "rgba(255,255,255,0.06)",
            color: "rgba(255,255,255,0.85)",
            border: "1px solid rgba(255,255,255,0.10)",
          }
        : {
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.04) 100%)",
            color: "#fff",
            border: "1px solid rgba(255,255,255,0.10)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.10)",
          };

  if (invisible) {
    return <div className={base} style={{ visibility: "hidden" }} />;
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--reveal-x", `${e.clientX - rect.left}px`);
    e.currentTarget.style.setProperty("--reveal-y", `${e.clientY - rect.top}px`);
  };

  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
      onMouseMove={handleMouseMove}
      aria-label={ariaLabel ?? label}
      className={base}
      style={{
        ...styles,
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {label}
    </button>
  );
}
