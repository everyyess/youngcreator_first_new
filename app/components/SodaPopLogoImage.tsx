"use client";

type SodaPopLogoImageProps = {
  variant?: "horizontal" | "stacked";
  className?: string;
};

export default function SodaPopLogoImage({ variant = "horizontal", className = "" }: SodaPopLogoImageProps) {
  return (
    <img
      src={variant === "stacked" ? "/brand/soda-pop-ver2.png" : "/brand/soda-pop-ver1.png"}
      alt="SODA POP"
      className={className}
      draggable={false}
    />
  );
}
