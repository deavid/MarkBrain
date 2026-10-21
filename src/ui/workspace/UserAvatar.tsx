import React, { useEffect, useState } from 'react';
import { User as UserIcon } from 'lucide-react';

/**
 * The account avatar. Google hosts avatar URLs that refuse hotlinking, so a
 * photoURL existing does not mean the image loads — without an onError guard
 * the button shows a broken-image box. On failure (or with no URL) fall back
 * to the generic account glyph in a recessed circle.
 */
export const UserAvatar: React.FC<{
  src?: string | null;
  size?: 'sm' | 'md';
  className?: string;
}> = ({ src, size = 'sm', className = '' }) => {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  const box = size === 'md' ? 'w-10 h-10' : 'w-6 h-6';
  const glyph = size === 'md' ? 'w-5 h-5' : 'w-3.5 h-3.5';

  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        onError={() => setFailed(true)}
        className={`${box} rounded-full ${className}`}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={`${box} rounded-full bg-recess-1 shadow-well flex items-center justify-center text-[#8ab1e0] ${className}`}
    >
      <UserIcon className={glyph} />
    </span>
  );
};
