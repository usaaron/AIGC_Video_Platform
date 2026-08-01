import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function IconBase({ children, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="20"
      viewBox="0 0 24 24"
      width="20"
      {...props}
    >
      {children}
    </svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </IconBase>
  );
}

export function ScriptIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M7 3.75h7.6L18 7.2v13.05H7V3.75Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.6" />
      <path d="M14.4 3.9v3.6h3.4M9.5 11h6M9.5 14h6M9.5 17h4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
    </IconBase>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </IconBase>
  );
}

export function ArrowIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m9 5 7 7-7 7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
    </IconBase>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </IconBase>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="10.7" cy="10.7" r="6.2" stroke="currentColor" strokeWidth="1.6" />
      <path d="m15.4 15.4 4.1 4.1" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
    </IconBase>
  );
}

export function UserIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="8" r="3.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.75 20c.5-4 2.6-6 6.25-6s5.75 2 6.25 6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
    </IconBase>
  );
}

export function EditIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m14.8 5.2 4 4L9 19H5v-4L14.8 5.2Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" />
      <path d="m12.8 7.2 4 4" stroke="currentColor" strokeWidth="1.5" />
    </IconBase>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M5 7h14M9 7V4h6v3M7.5 7l.7 13h7.6l.7-13" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
    </IconBase>
  );
}
