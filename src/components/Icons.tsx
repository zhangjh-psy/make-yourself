/**
 * 全部图标：手写的内联 SVG，不依赖任何图标库。
 *
 * 为什么不用图标库：一是省掉一个依赖（这个项目只依赖 React + 农历库），
 * 二是能保证风格统一 —— 全部 24×24 网格、线宽 1.8、圆头圆角、颜色继承 currentColor
 * （所以放到任何文字颜色的位置都自动匹配）。
 *
 * 加新图标：照抄任何一个的写法，用 base(size) 拿统一属性即可。
 */
interface IconProps {
  size?: number;
  className?: string;
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

export const IconToday = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <rect x="3" y="4.5" width="18" height="16" rx="3" />
    <path d="M3 9.5h18M8 3v3M16 3v3" />
    <circle cx="12" cy="15" r="1.6" fill="currentColor" stroke="none" />
  </svg>
);

export const IconHourglass = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M7 3h10M7 21h10" />
    <path d="M8 3v3.2c0 1 .4 1.6 1.2 2.3L12 11l2.8-2.5c.8-.7 1.2-1.3 1.2-2.3V3" />
    <path d="M8 21v-3.2c0-1 .4-1.6 1.2-2.3L12 13l2.8 2.5c.8.7 1.2 1.3 1.2 2.3V21" />
  </svg>
);

export const IconCalendar = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <rect x="3" y="4.5" width="18" height="16" rx="3" />
    <path d="M3 9.5h18M8 3v3M16 3v3" />
    <path d="M7.5 13h2M11 13h2M14.5 13h2M7.5 16.5h2M11 16.5h2" />
  </svg>
);

/** 任务 / 待办清单 */
export const IconTasks = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M3.5 6.5l1.8 1.8 3.2-3.4" />
    <path d="M3.5 13l1.8 1.8 3.2-3.4" />
    <path d="M3.5 19.4l1.8 1.8 3.2-3.4" />
    <path d="M12.5 6.5h8M12.5 13h8M12.5 19.5h8" />
  </svg>
);

/** 截止日 / 图钉 */
export const IconDeadline = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M12 3.5l3 3-5.5 5.5H6.8l-.9.9 6.7 6.7.9-.9v-2.7L19 10.5l-3-3z" />
    <path d="M4 20l4.2-4.2" />
  </svg>
);

/** 日记本 */
export const IconDiary = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M6 3.5h11.5A1.5 1.5 0 0 1 19 5v14a1.5 1.5 0 0 1-1.5 1.5H6" />
    <path d="M6 3.5A2.5 2.5 0 0 0 3.5 6v12A2.5 2.5 0 0 0 6 20.5" />
    <path d="M7.5 8h8M7.5 11.5h8M7.5 15h5" />
  </svg>
);

/** 慎独 / 叶子 */
export const IconLeaf = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M4.5 19.5c0-8 5.5-13.5 15-14.5.8 9.5-4.5 15-12.5 15" />
    <path d="M4.5 19.5C8 16 11.5 13 16 11" />
  </svg>
);

/** 折叠箭头 */
export const IconChevronDown = ({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M5.5 9l6.5 6.5L18.5 9" />
  </svg>
);

/** 拖动排序手柄 */
export const IconDragHandle = ({ size = 14, className }: IconProps) => (
  <svg {...base(size)} className={className} strokeWidth={2.2}>
    <path d="M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01" strokeLinecap="round" />
  </svg>
);

export const IconSettings = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
  </svg>
);

export const IconPlus = ({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconCheck = ({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className} strokeWidth={2.6}>
    <path d="M4.5 12.5l5 5 10-11" />
  </svg>
);

export const IconClose = ({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export const IconChevronLeft = ({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M14.5 5.5L8 12l6.5 6.5" />
  </svg>
);

export const IconChevronRight = ({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M9.5 5.5L16 12l-6.5 6.5" />
  </svg>
);

export const IconPin = ({ size = 14, className }: IconProps) => (
  <svg {...base(size)} className={className} fill="currentColor" stroke="none">
    <path d="M14.5 2.5l7 7-2.1 2.1-1.1-1.1-3.4 3.4.5 3.6-1.6 1.6-4.2-4.2-4.6 4.6-1.1-1.1 4.6-4.6L4.3 9.6 5.9 8l3.6.5 3.4-3.4-1.1-1.1z" />
  </svg>
);

export const IconTrash = ({ size = 14, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M4 7h16M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4L17.5 7" />
  </svg>
);

export const IconEdit = ({ size = 14, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3z" />
    <path d="M15.5 6.5l2 2" />
  </svg>
);

export const IconBell = ({ size = 14, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6" />
    <path d="M10.3 20a2 2 0 0 0 3.4 0" />
  </svg>
);

export const IconClock = ({ size = 14, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);

export const IconRepeat = ({ size = 12, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M4 9a5 5 0 0 1 5-5h9l-2.5-2.5M20 15a5 5 0 0 1-5 5H6l2.5 2.5" />
  </svg>
);

export const IconMinimize = ({ size = 14, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M5 12h14" />
  </svg>
);

export const IconSearch = ({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4 4" />
  </svg>
);

export const IconChart = ({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </svg>
);

export const IconDownload = ({ size = 15, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M12 3v12M7.5 10.5L12 15l4.5-4.5M4 20h16" />
  </svg>
);

export const IconUpload = ({ size = 15, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M12 16V4M7.5 8.5L12 4l4.5 4.5M4 20h16" />
  </svg>
);

export const IconFolder = ({ size = 15, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M3 7.5A2 2 0 0 1 5 5.5h3.6l1.8 2.2H19a2 2 0 0 1 2 2v8.8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);

export const IconFloat = ({ size = 15, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <rect x="12" y="10" width="7" height="7" rx="2" fill="currentColor" stroke="none" opacity="0.9" />
  </svg>
);

export const IconSparkle = ({ size = 15, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
    <path d="M18.5 15.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" />
  </svg>
);
