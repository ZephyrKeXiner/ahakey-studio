import type { CSSProperties } from "react";

const paths = {
  microphone: (
    <>
      <rect x="9" y="2" width="6" height="13" rx="3" />
      <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" />
    </>
  ),
  check: <path d="m4 12 5 5L20 5" />,
  close: <path d="m5 5 14 14M19 5 5 19" />,
  backspace: (
    <>
      <path d="M9 4h11v16H9L2 12Z" />
      <path d="m11 9 6 6m0-6-6 6" />
    </>
  ),
  screen: (
    <>
      <rect x="2" y="4" width="20" height="15" rx="3" />
      <path d="M6 8h12v7H6Z" />
    </>
  ),
  light: (
    <>
      <path d="M3 10h18v5H3Z" />
      <path d="M7 10v5m5-5v5m5-5v5M12 2v3M4 4l2 2m14-2-2 2" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 7a9 9 0 0 0-15-2L2 8m0-5v5h5M4 17a9 9 0 0 0 15 2l3-3m0 5v-5h-5" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6m0-10v.1" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 4v.1" />
    </>
  ),
  tasks: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="3" />
      <path d="M8 8h8m-8 4h8m-8 4h5" />
    </>
  ),
  settings: (
    <>
      <path
        d="m10 2-1 3-3 1-3-1-1 4 3 2v3l-3 2 2 4 3-1 3 1 1 3 4-1 1-3 3-1 3 1 1-4-3-2v-3l3-2-2-4-3 1-3-1-1-3Z"
        transform="translate(1 -1) scale(.92)"
      />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  more: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M7 12h.1m4.9 0h.1m4.9 0h.1" />
    </>
  ),
  keyboard: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="3" />
      <path d="M6 9h1m4 0h1m4 0h1M6 13h1m4 0h1m4 0h1M7 16h10" />
    </>
  ),
  arrow: <path d="m9 5 7 7-7 7" />,
} as const;
export type IconName = keyof typeof paths;
export function StudioIcon({
  name,
  size = 20,
  style,
}: {
  name: IconName;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      {paths[name]}
    </svg>
  );
}
