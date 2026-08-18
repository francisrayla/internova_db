const ARC_GRADIENT_ID = "internova-arc-gradient";

export function LogoMark({ size = 40, className = "" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={ARC_GRADIENT_ID} x1="20" y1="20" x2="80" y2="80" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#5eb1ff" />
          <stop offset="100%" stopColor="#1a5fd6" />
        </linearGradient>
      </defs>

      {/* Badge background */}
      <circle cx="50" cy="50" r="48" fill="#0a1a3a" />

      {/* Orbit swoosh with arrowhead */}
      <path d="M27 24 A 34 34 0 1 0 70 26" fill="none" stroke={`url(#${ARC_GRADIENT_ID})`} strokeWidth="5" strokeLinecap="round" />
      <path d="M62 15 L76 21 L67 33 Z" fill={`url(#${ARC_GRADIENT_ID})`} />

      {/* Circuit accents */}
      <g stroke="#4a8fe8" strokeWidth="1.1" strokeLinecap="round">
        <line x1="26" y1="44" x2="34" y2="46" />
        <line x1="24" y1="54" x2="33" y2="53" />
        <line x1="74" y1="44" x2="66" y2="46" />
        <line x1="76" y1="54" x2="67" y2="53" />
      </g>
      <g fill="#4a8fe8">
        <circle cx="25" cy="44" r="1.8" />
        <circle cx="23" cy="54" r="1.8" />
        <circle cx="75" cy="44" r="1.8" />
        <circle cx="77" cy="54" r="1.8" />
      </g>

      {/* Graduation cap */}
      <path d="M50 27 L74 35.5 L50 44 L26 35.5 Z" fill="#ffffff" />
      <path d="M35.5 38 V49 c0 4.4 6.5 8 14.5 8 s14.5-3.6 14.5-8 V38 L50 44 Z" fill="#ffffff" opacity="0.95" />
      <line x1="74" y1="35.5" x2="74" y2="47" stroke="#ffffff" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="74" cy="49" r="2.1" fill="#ffffff" />

      {/* Person silhouette */}
      <circle cx="50" cy="54" r="8.5" fill="#ffffff" />
      <path d="M34 82 C34 68 41 61 50 61 C59 61 66 68 66 82 Z" fill="#ffffff" />

      {/* AI tag */}
      <rect x="28" y="73" width="24" height="15" rx="3.2" fill="#ffffff" />
      <text x="40" y="84.2" textAnchor="middle" fontSize="10" fontWeight="800" fill="#0a1a3a" fontFamily="Arial, sans-serif">AI</text>
    </svg>
  );
}

export default function Logo({ size = 32, wordmark = true, tagline = false, className = "", dark = false }) {
  const baseText = dark ? "text-white" : "text-slate-900";
  const accentText = dark ? "text-sky-400" : "text-blue-600";

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LogoMark size={size} />
      {wordmark && (
        <span className="leading-tight">
          <span
            className={`block font-bold uppercase tracking-wide ${baseText}`}
            style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: size * 0.5 }}
          >
            Inter<span className={accentText}>Nova</span>
          </span>
          {tagline && (
            <span className={`block text-[10px] font-medium uppercase tracking-[0.2em] ${dark ? "text-slate-300" : "text-slate-500"}`}>
              Empowering Future Professionals
            </span>
          )}
        </span>
      )}
    </span>
  );
}
