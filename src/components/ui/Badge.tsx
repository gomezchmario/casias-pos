type Props = {
  children: React.ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "info" | "accent";
  size?: "sm" | "md";
};

const TONES: Record<NonNullable<Props["tone"]>, { bg: string; fg: string }> = {
  neutral: { bg: "rgba(10,37,64,0.08)", fg: "#0a2540" },
  success: { bg: "rgba(28,140,86,0.14)", fg: "#1c8c56" },
  warning: { bg: "rgba(255,200,61,0.22)", fg: "#7a5a05" },
  danger:  { bg: "rgba(216,68,76,0.14)",  fg: "#a71d24" },
  info:    { bg: "rgba(31,63,100,0.12)",  fg: "#1f3f64" },
  accent:  { bg: "rgba(255,200,61,0.30)", fg: "#7a5a05" },
};

export function Badge({ children, tone = "neutral", size = "md" }: Props) {
  const t = TONES[tone];
  return (
    <span
      style={{
        backgroundColor: t.bg,
        color: t.fg,
        padding: size === "sm" ? "2px 8px" : "3px 10px",
        borderRadius: 999,
        fontSize: size === "sm" ? 11 : 12,
        fontWeight: 600,
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}
