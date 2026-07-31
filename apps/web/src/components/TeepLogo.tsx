import Image from "next/image";

type TeepLogoProps = {
  /** full = ícone + wordmark; icon = só símbolo */
  variant?: "full" | "icon";
  className?: string;
  /** Altura em px (largura automática) */
  height?: number;
  priority?: boolean;
};

/**
 * Logo TEEP estático em /public/brand.
 * full → logo-teep.png | icon → logo-teep-icon.png
 */
export function TeepLogo({
  variant = "full",
  className = "",
  height = 28,
  priority = false,
}: TeepLogoProps) {
  const src =
    variant === "icon" ? "/brand/logo-teep-icon.png" : "/brand/logo-teep.png";
  const width = variant === "icon" ? height : Math.round(height * (345 / 102));
  return (
    <Image
      src={src}
      alt="TEEP"
      width={width}
      height={height}
      className={className}
      priority={priority}
      unoptimized
    />
  );
}
