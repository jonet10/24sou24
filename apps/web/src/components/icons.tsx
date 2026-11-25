import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function BaseIcon({ children, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="20"
      height="20"
      {...props}
    >
      {children}
    </svg>
  );
}

export const DashboardIcon = (props: IconProps) => (
  <BaseIcon {...props}>
    <rect x="3" y="3" width="7" height="9" rx="2" />
    <rect x="14" y="3" width="7" height="5" rx="2" />
    <rect x="14" y="12" width="7" height="9" rx="2" />
    <rect x="3" y="16" width="7" height="5" rx="2" />
  </BaseIcon>
);

export const VideoIcon = (props: IconProps) => (
  <BaseIcon {...props}>
    <rect x="3" y="5" width="14" height="14" rx="2" />
    <path d="m17 10 4-2v8l-4-2z" />
  </BaseIcon>
);

export const ChannelIcon = (props: IconProps) => (
  <BaseIcon {...props}>
    <rect x="2.5" y="7" width="19" height="13" rx="4" />
    <path d="m10 11 5 2.5-5 2.5z" />
    <path d="M7 7 5.5 4m11.5 3 1.5-3" />
  </BaseIcon>
);

export const BroadcastIcon = (props: IconProps) => (
  <BaseIcon {...props}>
    <circle cx="12" cy="12" r="2.5" />
    <path d="M8 8a5.7 5.7 0 0 0 0 8m8-8a5.7 5.7 0 0 1 0 8" />
    <path d="M5 5a9.9 9.9 0 0 0 0 14m14-14a9.9 9.9 0 0 1 0 14" />
  </BaseIcon>
);

export const HistoryIcon = (props: IconProps) => (
  <BaseIcon {...props}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 4v4h4" />
    <path d="M12 7v5l3 2" />
  </BaseIcon>
);

export const SettingsIcon = (props: IconProps) => (
  <BaseIcon {...props}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21h-4v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3v-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5V3h4v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1H21v4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </BaseIcon>
);

export const AdminIcon = (props: IconProps) => (
  <BaseIcon {...props}>
    <path d="M12 3 4 6v6c0 4.6 3.2 8.3 8 9 4.8-.7 8-4.4 8-9V6z" />
    <path d="m9 12 2 2 4-4" />
  </BaseIcon>
);

export const MenuIcon = (props: IconProps) => (
  <BaseIcon {...props}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </BaseIcon>
);

export const LogoutIcon = (props: IconProps) => (
  <BaseIcon {...props}>
    <path d="M10 17l5-5-5-5" />
    <path d="M15 12H4" />
    <path d="M12 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5" />
  </BaseIcon>
);

export const ExternalIcon = (props: IconProps) => (
  <BaseIcon {...props}>
    <path d="M14 4h6v6" />
    <path d="M20 4 10 14" />
    <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
  </BaseIcon>
);
