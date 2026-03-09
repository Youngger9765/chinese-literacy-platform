import React, { useEffect, useState } from 'react';

interface CelebrationOverlayProps {
  score: number | null;
}

const getStarInfo = (score: number | null): { stars: number; message: string } => {
  if (score === null) return { stars: 3, message: '恭喜完成！' };
  if (score >= 90) return { stars: 5, message: '完美！' };
  if (score >= 75) return { stars: 4, message: '太棒了！' };
  if (score >= 60) return { stars: 3, message: '做得好！' };
  return { stars: 2, message: '繼續加油！' };
};

const CONFETTI_COLORS = ['#f59e0b', '#10b981', '#6366f1', '#ec4899', '#3b82f6', '#f97316'];
const CONFETTI_COUNT = 30;

const confettiPieces = Array.from({ length: CONFETTI_COUNT }, (_, i) => ({
  id: i,
  color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
  left: `${(i / CONFETTI_COUNT) * 100}%`,
  delay: `${(i % 10) * 0.08}s`,
  duration: `${1.2 + (i % 5) * 0.2}s`,
  size: i % 3 === 0 ? 10 : i % 3 === 1 ? 7 : 5,
  rotate: `${(i * 37) % 360}deg`,
}));

const CelebrationOverlay: React.FC<CelebrationOverlayProps> = ({ score }) => {
  const [visible, setVisible] = useState(true);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const fadeTimer = setTimeout(() => setFading(true), 2500);
    const removeTimer = setTimeout(() => setVisible(false), 3000);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(removeTimer);
    };
  }, []);

  if (!visible) return null;

  const { stars, message } = getStarInfo(score);

  return (
    <>
      <style>{`
        @keyframes confetti-fall {
          0% { transform: translateY(-20px) rotate(0deg); opacity: 1; }
          100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
        }
        @keyframes star-pop {
          0% { transform: scale(0) rotate(-30deg); opacity: 0; }
          60% { transform: scale(1.3) rotate(10deg); opacity: 1; }
          100% { transform: scale(1) rotate(0deg); opacity: 1; }
        }
        @keyframes message-bounce {
          0% { transform: scale(0.5) translateY(20px); opacity: 0; }
          70% { transform: scale(1.08) translateY(-4px); opacity: 1; }
          100% { transform: scale(1) translateY(0); opacity: 1; }
        }
        .confetti-piece {
          position: fixed;
          top: 0;
          animation: confetti-fall linear forwards;
          pointer-events: none;
          z-index: 9999;
          border-radius: 2px;
        }
        .star-pop {
          display: inline-block;
          animation: star-pop 0.4s cubic-bezier(0.34,1.56,0.64,1) forwards;
        }
        .message-bounce {
          animation: message-bounce 0.5s cubic-bezier(0.34,1.56,0.64,1) 0.2s both;
        }
        .celebration-overlay {
          transition: opacity 0.5s ease;
        }
        .celebration-overlay.fading {
          opacity: 0;
        }
      `}</style>

      {/* Confetti pieces */}
      {confettiPieces.map(p => (
        <div
          key={p.id}
          className="confetti-piece"
          style={{
            left: p.left,
            width: p.size,
            height: p.size * 1.6,
            backgroundColor: p.color,
            animationDelay: p.delay,
            animationDuration: p.duration,
            transform: `rotate(${p.rotate})`,
          }}
        />
      ))}

      {/* Center modal */}
      <div
        className={`celebration-overlay fixed inset-0 flex items-center justify-center z-[9998] pointer-events-none ${fading ? 'fading' : ''}`}
      >
        <div className="bg-white rounded-3xl shadow-2xl px-10 py-8 flex flex-col items-center gap-3 border-4 border-yellow-300">
          {/* Stars */}
          <div className="flex gap-2">
            {Array.from({ length: 5 }, (_, i) => (
              <span
                key={i}
                className="star-pop text-4xl"
                style={{ animationDelay: `${i * 0.1}s`, opacity: 0 }}
              >
                {i < stars ? '★' : '☆'}
              </span>
            ))}
          </div>

          {/* Message */}
          <p className="message-bounce text-3xl font-black text-gray-900 tracking-wide">
            {message}
          </p>

          {/* Score badge */}
          {score !== null && (
            <div className="bg-accent/10 text-accent px-4 py-1 rounded-full text-lg font-bold">
              {score} 分
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default CelebrationOverlay;
