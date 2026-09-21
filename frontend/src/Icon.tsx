export type IconName =
  | "sparkles"
  | "grid"
  | "briefcase"
  | "calendar"
  | "mail"
  | "bookmark"
  | "settings"
  | "arrow"
  | "search"
  | "chevron"
  | "plus"
  | "close"
  | "check"
  | "link"
  | "refresh"
  | "send"
  | "globe"
  | "pin"
  | "clock"
  | "filter"
  | "logout"
  | "external"
  | "menu"
  | "sliders";
const paths: Record<IconName, React.ReactNode> = {
  sparkles: (
    <>
      <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" />
      <path d="m20 2 .7 1.8L23 5l-2.3.7L20 8l-.7-2.3L17 5l2.3-1.2L20 2Z" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  briefcase: (
    <>
      <rect x="3" y="7" width="18" height="14" rx="2" />
      <path d="M8 7V4h8v3M3 12a24 24 0 0 0 18 0M12 11v4" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2m-8 3h2" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 6 9 7 9-7" />
    </>
  ),
  bookmark: <path d="M6 4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17l-6-4-6 4V4Z" />,
  settings: (
    <>
      <path d="m9 3-1 3-3 1-2 4 2 2v4l4 2 3-1 3 1 4-2v-4l2-2-2-4-3-1-1-3H9Z" />
      <circle cx="12" cy="11" r="3" />
    </>
  ),
  arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </>
  ),
  chevron: <path d="m9 5 7 7-7 7" />,
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  check: <path d="m5 12 4 4L19 6" />,
  link: (
    <>
      <path d="m10 13 4-4m-6 5-2 2a3 3 0 0 0 4 4l4-4a3 3 0 0 0 0-4m-4 0a3 3 0 0 1 0-4l4-4a3 3 0 0 1 4 4l-2 2" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 9a8 8 0 0 0-14-4L3 8m0-5v5h5m-4 7a8 8 0 0 0 14 4l3-3m0 5v-5h-5" />
    </>
  ),
  send: (
    <>
      <path d="m3 3 19 9-19 9 4-9-4-9Zm4 9h15" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <ellipse cx="12" cy="12" rx="4" ry="9" />
      <path d="M3 12h18" />
    </>
  ),
  pin: (
    <>
      <path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" />
      <circle cx="12" cy="10" r="2" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  filter: (
    <>
      <path d="M4 6h16M7 12h10m-7 6h4" />
    </>
  ),
  logout: (
    <>
      <path d="M9 3H4v18h5m5-14 5 5-5 5m-5-5h10" />
    </>
  ),
  external: (
    <>
      <path d="M14 3h7v7m0-7L10 14m0-11H3v18h18v-7" />
    </>
  ),
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  sliders: (
    <>
      <path d="M4 7h5m4 0h7M4 17h9m4 0h3" />
      <circle cx="11" cy="7" r="2" />
      <circle cx="15" cy="17" r="2" />
    </>
  ),
};
export default function Icon({
  name,
  size = 20,
  className = "",
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
