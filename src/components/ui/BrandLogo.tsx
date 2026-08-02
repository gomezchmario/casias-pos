import { TireMark } from "./TireMark";

type Props = {
  size?: "sm" | "md" | "lg";
  variant?: "light" | "dark";
};

export function BrandLogo({ size = "md", variant = "light" }: Props) {
  const tireSize = size === "lg" ? 56 : size === "md" ? 40 : 28;
  const titleSize =
    size === "lg" ? "text-3xl" : size === "md" ? "text-2xl" : "text-lg";
  const subSize = size === "lg" ? "text-sm" : "text-xs";
  const titleColor = variant === "dark" ? "text-brand-500" : "text-white";
  const subColor = variant === "dark" ? "text-brand-400" : "text-accent-500";

  return (
    <div className="flex items-center gap-3">
      <TireMark size={tireSize} />
      <div className="flex flex-col leading-tight">
        <span
          className={`${titleSize} ${titleColor} font-semibold tracking-tight`}
          style={{ letterSpacing: "-0.01em" }}
        >
          Casias Tire Shop
        </span>
        <span
          className={`${subSize} ${subColor} font-medium uppercase tracking-widest`}
        >
          Time Clock
        </span>
      </div>
    </div>
  );
}
