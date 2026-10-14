import React from "react";

interface IconProps {
  className?: string;
  size?: number;
}

export const CashIcon: React.FC<IconProps> = ({ className = "w-5 h-5", size }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={size ? { width: size, height: size } : undefined}
  >
    <rect x="2" y="5" width="20" height="14" rx="3" fill="#10B981" stroke="#059669" strokeWidth="1.5" />
    <circle cx="12" cy="12" r="3.5" fill="#047857" />
    <text
      x="12"
      y="14.5"
      fontFamily="system-ui, -apple-system, sans-serif"
      fontSize="7"
      fontWeight="900"
      fill="#ECFDF5"
      textAnchor="middle"
    >
      ₹
    </text>
    <circle cx="5.5" cy="12" r="1.2" fill="#6EE7B7" />
    <circle cx="18.5" cy="12" r="1.2" fill="#6EE7B7" />
  </svg>
);

export const CardIcon: React.FC<IconProps> = ({ className = "w-5 h-5", size }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={size ? { width: size, height: size } : undefined}
  >
    <rect x="2" y="5" width="20" height="14" rx="3" fill="#2563EB" stroke="#1D4ED8" strokeWidth="1.5" />
    <rect x="2" y="8.5" width="20" height="3.5" fill="#0F172A" />
    <rect x="4.5" y="14" width="4" height="2.8" rx="0.8" fill="#FBBF24" />
    <rect x="10.5" y="14.5" width="6" height="1" rx="0.5" fill="#93C5FD" />
    <rect x="10.5" y="16" width="3.5" height="1" rx="0.5" fill="#93C5FD" />
    <circle cx="18" cy="15" r="2" fill="#EF4444" fillOpacity="0.9" />
    <circle cx="20" cy="15" r="2" fill="#F59E0B" fillOpacity="0.9" />
  </svg>
);

export const UpiIcon: React.FC<IconProps> = ({ className = "w-5 h-5", size }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={size ? { width: size, height: size } : undefined}
  >
    <rect width="24" height="24" rx="5" fill="#FFFFFF" />
    <path d="M6.5 17.5L12 6.5H8L2.5 17.5H6.5Z" fill="#097939" />
    <path d="M11.5 17.5L17 6.5H13L7.5 17.5H11.5Z" fill="#F26722" />
    <text
      x="18"
      y="14.5"
      fontFamily="system-ui, -apple-system, sans-serif"
      fontSize="5.5"
      fontWeight="900"
      fontStyle="italic"
      fill="#1E293B"
      textAnchor="middle"
    >
      UPI
    </text>
  </svg>
);

export const SplitIcon: React.FC<IconProps> = ({ className = "w-5 h-5", size }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={size ? { width: size, height: size } : undefined}
  >
    <rect x="2" y="4" width="9" height="16" rx="2" fill="#8B5CF6" stroke="#7C3AED" strokeWidth="1" />
    <rect x="13" y="4" width="9" height="16" rx="2" fill="#A78BFA" stroke="#7C3AED" strokeWidth="1" />
    <line x1="12" y1="2.5" x2="12" y2="21.5" stroke="#DDD6FE" strokeWidth="1.2" strokeDasharray="1.5 1.5" />
    <text
      x="6.5"
      y="14"
      fontFamily="system-ui, -apple-system, sans-serif"
      fontSize="6.5"
      fontWeight="900"
      fill="#FFFFFF"
      textAnchor="middle"
    >
      ₹
    </text>
    <text
      x="17.5"
      y="14"
      fontFamily="system-ui, -apple-system, sans-serif"
      fontSize="6.5"
      fontWeight="900"
      fill="#FFFFFF"
      textAnchor="middle"
    >
      ₹
    </text>
  </svg>
);

export const GPayLogo: React.FC<IconProps> = ({ className = "w-4 h-4", size }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={size ? { width: size, height: size } : undefined}
  >
    <rect width="24" height="24" rx="5" fill="#FFFFFF" />
    <path
      d="M12 7C13.65 7 14.8 7.7 15.45 8.3L17 6.75C15.75 5.6 14.05 5 12 5C8.95 5 6.4 6.75 5.2 9.3L7.35 10.95C7.9 8.65 9.75 7 12 7Z"
      fill="#EA4335"
    />
    <path
      d="M18.9 12.15C18.9 11.65 18.85 11.2 18.75 10.75H12V13.55H15.9C15.75 14.45 15.2 15.2 14.4 15.7L16.55 17.35C17.8 16.2 18.9 14.35 18.9 12.15Z"
      fill="#4285F4"
    />
    <path
      d="M7.35 13.05C7.2 12.6 7.15 12.05 7.15 11.5C7.15 10.95 7.2 10.4 7.35 9.95L5.2 8.3C4.75 9.25 4.5 10.35 4.5 11.5C4.5 12.65 4.75 13.75 5.2 14.7L7.35 13.05Z"
      fill="#FBBC05"
    />
    <path
      d="M12 18C14.05 18 15.75 17.3 17 16.15L14.85 14.5C14.1 15 13.15 15.3 12 15.3C9.75 15.3 7.9 13.65 7.35 11.35L5.2 13C6.4 15.55 8.95 18 12 18Z"
      fill="#34A853"
    />
  </svg>
);

export const PhonePeLogo: React.FC<IconProps> = ({ className = "w-4 h-4", size }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={size ? { width: size, height: size } : undefined}
  >
    <rect width="24" height="24" rx="5" fill="#5F259F" />
    <path
      d="M11 6.5V9H14C15.65 9 17 10.35 17 12C17 13.65 15.65 15 14 15H11V18H8.5V6.5H11ZM11 12.75H13.75C14.15 12.75 14.5 12.4 14.5 12C14.5 11.6 14.15 11.25 13.75 11.25H11V12.75Z"
      fill="#FFFFFF"
    />
    <path d="M13.25 6.5L16 4H18.25L15 6.5H13.25Z" fill="#FFFFFF" />
  </svg>
);

export const PaytmLogo: React.FC<IconProps> = ({ className = "w-4 h-4", size }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={size ? { width: size, height: size } : undefined}
  >
    <rect width="24" height="24" rx="5" fill="#002E6E" />
    <text
      x="7.5"
      y="14.5"
      fontFamily="system-ui, -apple-system, sans-serif"
      fontSize="7.5"
      fontWeight="900"
      fill="#FFFFFF"
      textAnchor="middle"
    >
      pay
    </text>
    <text
      x="16.5"
      y="14.5"
      fontFamily="system-ui, -apple-system, sans-serif"
      fontSize="7.5"
      fontWeight="900"
      fill="#00BAF2"
      textAnchor="middle"
    >
      tm
    </text>
  </svg>
);

export const OtherUpiLogo: React.FC<IconProps> = ({ className = "w-4 h-4", size }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={size ? { width: size, height: size } : undefined}
  >
    <rect width="24" height="24" rx="5" fill="#0F172A" stroke="#334155" strokeWidth="1" />
    <rect x="5" y="5" width="5.5" height="5.5" rx="1" fill="#38BDF8" />
    <rect x="13.5" y="5" width="5.5" height="5.5" rx="1" fill="#38BDF8" />
    <rect x="5" y="13.5" width="5.5" height="5.5" rx="1" fill="#38BDF8" />
    <rect x="13.5" y="13.5" width="2.5" height="2.5" fill="#38BDF8" />
    <rect x="16.5" y="16.5" width="2.5" height="2.5" fill="#38BDF8" />
  </svg>
);

export const VisaLogo: React.FC<IconProps> = ({ className = "w-4 h-4", size }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={size ? { width: size, height: size } : undefined}
  >
    <rect width="24" height="24" rx="5" fill="#1A1F71" />
    <text
      x="12"
      y="15"
      fontFamily="system-ui, -apple-system, sans-serif"
      fontSize="7.5"
      fontWeight="900"
      fontStyle="italic"
      fill="#FFFFFF"
      textAnchor="middle"
      letterSpacing="0.5"
    >
      VISA
    </text>
  </svg>
);

export const MastercardLogo: React.FC<IconProps> = ({ className = "w-4 h-4", size }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={size ? { width: size, height: size } : undefined}
  >
    <rect width="24" height="24" rx="5" fill="#1E293B" />
    <circle cx="9.5" cy="12" r="5.5" fill="#EB001B" />
    <circle cx="14.5" cy="12" r="5.5" fill="#F79E1B" fillOpacity="0.88" />
  </svg>
);

export const RuPayLogo: React.FC<IconProps> = ({ className = "w-4 h-4", size }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={size ? { width: size, height: size } : undefined}
  >
    <rect width="24" height="24" rx="5" fill="#0F172A" />
    <text
      x="10"
      y="14.5"
      fontFamily="system-ui, sans-serif"
      fontSize="6"
      fontWeight="900"
      fill="#FFFFFF"
      textAnchor="middle"
    >
      RuPay
    </text>
    <polygon points="17,10 18.5,12 17,14" fill="#F26522" />
    <polygon points="19,10 20.5,12 19,14" fill="#00A651" />
  </svg>
);

export const AmexLogo: React.FC<IconProps> = ({ className = "w-4 h-4", size }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={size ? { width: size, height: size } : undefined}
  >
    <rect width="24" height="24" rx="5" fill="#006FCF" />
    <text
      x="12"
      y="14"
      fontFamily="system-ui, sans-serif"
      fontSize="5"
      fontWeight="900"
      fill="#FFFFFF"
      textAnchor="middle"
      letterSpacing="0.3"
    >
      AMEX
    </text>
  </svg>
);

export const OtherCardLogo: React.FC<IconProps> = ({ className = "w-4 h-4", size }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={size ? { width: size, height: size } : undefined}
  >
    <rect width="24" height="24" rx="5" fill="#334155" />
    <rect x="5" y="8" width="14" height="8" rx="1.5" stroke="#FFFFFF" strokeWidth="1.2" />
    <line x1="5" y1="10.5" x2="19" y2="10.5" stroke="#FFFFFF" strokeWidth="1" />
  </svg>
);

export const EdcTerminalIcon: React.FC<IconProps> = ({ className = "w-10 h-10", size }) => (
  <svg
    viewBox="0 0 48 48"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={size ? { width: size, height: size } : undefined}
  >
    <rect x="12" y="4" width="24" height="40" rx="6" fill="#1E293B" stroke="#3B82F6" strokeWidth="2" />
    <rect x="16" y="8" width="16" height="12" rx="2" fill="#0F172A" />
    <text x="24" y="16.5" fontFamily="system-ui, monospace" fontSize="6.5" fontWeight="bold" fill="#38BDF8" textAnchor="middle">
      SWIPE / TAP
    </text>
    <rect x="16" y="24" width="3" height="3" rx="0.5" fill="#64748B" />
    <rect x="22.5" y="24" width="3" height="3" rx="0.5" fill="#64748B" />
    <rect x="29" y="24" width="3" height="3" rx="0.5" fill="#64748B" />
    <rect x="16" y="29" width="3" height="3" rx="0.5" fill="#64748B" />
    <rect x="22.5" y="29" width="3" height="3" rx="0.5" fill="#64748B" />
    <rect x="29" y="29" width="3" height="3" rx="0.5" fill="#64748B" />
    <rect x="16" y="34" width="3" height="3" rx="0.5" fill="#EF4444" />
    <rect x="22.5" y="34" width="3" height="3" rx="0.5" fill="#F59E0B" />
    <rect x="29" y="34" width="3" height="3" rx="0.5" fill="#10B981" />
  </svg>
);

export const CheckmarkIcon: React.FC<IconProps> = ({ className = "w-6 h-6", size }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={size ? { width: size, height: size } : undefined}
  >
    <circle cx="12" cy="12" r="10" fill="#10B981" />
    <path d="M7.5 12L10.5 15L16.5 9" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const WarningAlertIcon: React.FC<IconProps> = ({ className = "w-4 h-4", size }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={size ? { width: size, height: size } : undefined}
  >
    <path
      d="M12 3L2 21H22L12 3Z"
      fill="#F59E0B"
      stroke="#D97706"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <line x1="12" y1="9" x2="12" y2="14" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />
    <circle cx="12" cy="17.5" r="1.2" fill="#FFFFFF" />
  </svg>
);
