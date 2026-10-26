// PROFILE AVATAR (Boss order 2026-10-27): photo ho to image, warna initials
// circle. Staff Management roster + Tours schedule table me naam ke saath.
export default function Avatar({
  photo,
  name,
  size = 28,
  className = ''
}: {
  photo?: string;
  name: string;
  size?: number;
  className?: string;
}) {
  const initials =
    (name || '?')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() || '')
      .join('') || '?';
  if (photo) {
    return (
      <img
        src={photo}
        alt={name}
        style={{ width: size, height: size }}
        className={`shrink-0 rounded-full border border-slate-600 bg-slate-800 object-cover ${className}`}
      />
    );
  }
  return (
    <div
      style={{ width: size, height: size, fontSize: Math.max(8, size * 0.4) }}
      className={`flex shrink-0 items-center justify-center rounded-full border border-slate-600 bg-gradient-to-br from-indigo-500/50 to-sky-500/30 font-bold text-slate-100 ${className}`}
    >
      {initials}
    </div>
  );
}
