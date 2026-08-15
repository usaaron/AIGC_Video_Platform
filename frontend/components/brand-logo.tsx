import { Aperture } from "lucide-react";

interface BrandLogoProps {
  compact?: boolean;
  spin?: boolean;
}

export function BrandLogo({ compact = false, spin = false }: BrandLogoProps) {
  return (
    <div className={`brand-block ${compact ? "is-compact" : ""}`}>
      <span
        aria-hidden="true"
        className={`brand-mark ${spin ? "brand-mark-spin" : ""}`}
      >
        <Aperture size={20} />
      </span>

      <div className="brand-identity">
        <div className="brand-name">
          序幕
          <span>
            TV<sup className="brand-registered">®</sup>
          </span>
        </div>
        <small className="brand-module">剧本大师</small>
      </div>
    </div>
  );
}
