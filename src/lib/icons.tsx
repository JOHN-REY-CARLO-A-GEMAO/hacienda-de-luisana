import React from 'react'

type IconProps = React.SVGProps<SVGSVGElement> & { size?: number }

const base = (children: React.ReactNode) =>
  React.forwardRef<SVGSVGElement, IconProps>(({ size = 20, className = '', ...rest }, ref) => (
    <svg
      ref={ref}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  ))

export const Wifi = base(
  <>
    <path d="M5 12a10 10 0 0 1 14 0" />
    <path d="M8.5 15.5a5 5 0 0 1 7 0" />
    <circle cx="12" cy="19" r="1" fill="currentColor" />
  </>
)
export const Car = base(
  <>
    <path d="M3 13l2-5a2 2 0 0 1 2-1h10a2 2 0 0 1 2 1l2 5" />
    <path d="M3 13v4a1 1 0 0 0 1 1h2v-2h12v2h2a1 1 0 0 0 1-1v-4" />
    <circle cx="7" cy="15" r="1.2" />
    <circle cx="17" cy="15" r="1.2" />
  </>
)
export const Snow = base(
  <>
    <path d="M12 3v18" /><path d="M3 12h18" />
    <path d="M5 5l14 14" /><path d="M19 5L5 19" />
  </>
)
export const Chef = base(
  <>
    <path d="M6 10a3 3 0 1 1 3-3" /><path d="M18 10a3 3 0 1 0-3-3" />
    <path d="M9 7a3 3 0 0 1 6 0" />
    <path d="M6 10h12v6a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-6z" />
  </>
)
export const Pot = base(
  <>
    <path d="M4 10h16l-1 9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2l-1-9z" />
    <path d="M8 7v3" /><path d="M12 5v5" /><path d="M16 7v3" />
  </>
)
export const Fridge = base(
  <>
    <rect x="6" y="3" width="12" height="18" rx="2" />
    <path d="M6 10h12" /><path d="M9 6v2" /><path d="M9 13v3" />
  </>
)
export const Microwave = base(
  <>
    <rect x="3" y="6" width="18" height="12" rx="1.5" />
    <rect x="5" y="8" width="10" height="8" rx="0.5" />
    <circle cx="18.5" cy="10" r=".8" fill="currentColor" />
    <circle cx="18.5" cy="13" r=".8" fill="currentColor" />
  </>
)
export const Kettle = base(
  <>
    <path d="M6 11h11a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-7z" />
    <path d="M17 13l3-2v3l-3-1" />
    <path d="M9 8s.5-3 3-3 3 3 3 3" />
  </>
)
export const Tv = base(
  <>
    <rect x="3" y="5" width="18" height="12" rx="2" />
    <path d="M8 21h8" /><path d="M12 17v4" />
  </>
)
export const Table = base(
  <>
    <path d="M3 9h18" />
    <path d="M5 9v11" /><path d="M19 9v11" />
    <path d="M4 6l1-2h14l1 2" />
  </>
)
export const Flame = base(
  <>
    <path d="M12 3s5 4 5 9a5 5 0 0 1-10 0c0-2 1-3 2-4-1 3 1 5 3 5s3-2 3-4-3-4-3-6z" />
  </>
)
export const Campfire = base(
  <>
    <path d="M12 3c1 2 3 4 3 7a3 3 0 1 1-6 0c0-2 1-3 2-4-1 3 1 4 2 3s-.5-3-1-6z" />
    <path d="M4 20l16-5" /><path d="M4 15l16 5" />
  </>
)
export const Leaf = base(
  <>
    <path d="M5 20c0-10 8-14 15-14 0 8-4 15-13 15-1 0-2-.5-2-1z" />
    <path d="M5 20c3-5 7-8 12-10" />
  </>
)
export const Paw = base(
  <>
    <circle cx="6" cy="10" r="1.5" /><circle cx="10" cy="6" r="1.5" />
    <circle cx="14" cy="6" r="1.5" /><circle cx="18" cy="10" r="1.5" />
    <path d="M8 16c0-2 2-3 4-3s4 1 4 3-2 4-4 4-4-2-4-4z" />
  </>
)
export const MapPin = base(
  <>
    <path d="M12 22s-7-7-7-13a7 7 0 0 1 14 0c0 6-7 13-7 13z" />
    <circle cx="12" cy="9" r="2.5" />
  </>
)
export const Phone = base(
  <>
    <path d="M4 5c0-1 1-2 2-2h2l2 5-2 1a11 11 0 0 0 5 5l1-2 5 2v2c0 1-1 2-2 2A17 17 0 0 1 4 5z" />
  </>
)
export const Mail = base(
  <>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M3 7l9 6 9-6" />
  </>
)
export const ArrowRight = base(<><path d="M5 12h14" /><path d="M13 5l7 7-7 7" /></>)
export const ArrowDown = base(<><path d="M12 5v14" /><path d="M5 13l7 7 7-7" /></>)
export const Menu = base(<><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" /></>)
export const Close = base(<><path d="M6 6l12 12" /><path d="M18 6L6 18" /></>)
export const Chevron = base(<><path d="M6 9l6 6 6-6" /></>)
export const Star = base(<><path d="M12 3l2.9 6 6.6.6-5 4.5 1.5 6.5L12 17l-6 3.6L7.5 14l-5-4.5L9 9z" fill="currentColor" /></>)
export const Facebook = base(<><path d="M14 8h3V4h-3a4 4 0 0 0-4 4v2H7v4h3v8h4v-8h3l1-4h-4V8z" /></>)
export const Messenger = base(<><path d="M12 3C7 3 3 6.7 3 11.3c0 2.4 1.1 4.5 2.9 6v3.7l3.3-1.8c.9.3 1.9.4 2.8.4 5 0 9-3.7 9-8.3S17 3 12 3z" /><path d="M6 13l3-3 2 2 4-4-3 5-2-2-4 2z" /></>)
export const Instagram = base(<><rect x="3" y="3" width="18" height="18" rx="4" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r=".8" fill="currentColor" /></>)
export const Calendar = base(<><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4" /><path d="M16 3v4" /><path d="M3 10h18" /></>)
export const Users = base(<><circle cx="9" cy="8" r="3.2" /><path d="M2 21c0-3.5 3-6 7-6s7 2.5 7 6" /><circle cx="17" cy="9" r="2.6" /><path d="M15 21c0-2.5 2-4.5 5-4.5" /></>)
export const Bed = base(<><path d="M3 8v11" /><path d="M21 12v7" /><path d="M3 15h18" /><path d="M6 12h6a2 2 0 0 1 2 2v1" /><circle cx="8" cy="10.5" r="1.5" /></>)
export const Sparkle = base(<><path d="M12 3v6" /><path d="M12 15v6" /><path d="M3 12h6" /><path d="M15 12h6" /><path d="M6 6l3 3" /><path d="M15 15l3 3" /><path d="M18 6l-3 3" /><path d="M9 15l-3 3" /></>)
export const Compass = base(<><circle cx="12" cy="12" r="9" /><path d="M15 9l-2 6-6 2 2-6 6-2z" /></>)
export const House = base(
  <>
    <path d="M4 11.5L12 4l8 7.5" />
    <path d="M6 10.5V20h12v-9.5" />
    <path d="M10 20v-6h4v6" />
  </>
)
export const User = base(
  <>
    <circle cx="12" cy="8" r="3.2" />
    <path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" />
  </>
)
export const Share = base(
  <>
    <circle cx="18" cy="5" r="2.5" />
    <circle cx="6" cy="12" r="2.5" />
    <circle cx="18" cy="19" r="2.5" />
    <path d="M8.4 13.2L15.6 17.3" />
    <path d="M15.6 6.7L8.4 10.8" />
  </>
)
export const Clock = base(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </>
)

export const AMENITY_ICONS: Record<string, React.ComponentType<IconProps>> = {
  wifi: Wifi,
  parking: Car,
  ac: Snow,
  kitchen: Chef,
  cooking: Pot,
  fridge: Fridge,
  microwave: Microwave,
  kettle: Kettle,
  tv: Tv,
  'outdoor-dining': Table,
  grill: Flame,
  campfire: Campfire,
  garden: Leaf,
  pets: Paw,
}
