import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../firebase/config';
import { Lock, Mail, RefreshCw, Key, ShieldAlert, CheckCircle2 } from 'lucide-react';

// ── Canvas animation ──────────────────────────────────────────────────────────
// Two-layer effect: drifting particle network + concentric dashed rotating rings.
// Pure Canvas 2D — no library, no WebGL.

const G = '34,197,94'; // app green (rgb)

interface Dot {
  x: number; y: number;
  vx: number; vy: number;
  bvx: number; bvy: number;
  r: number;
}

const RING_DEFS = [
  { f: 0.18, ar: 0.58, dash:  6, gap:  5, spd:  0.22, ph: 0.0, a: 0.62 },
  { f: 0.30, ar: 0.58, dash:  8, gap:  7, spd: -0.17, ph: 1.1, a: 0.54 },
  { f: 0.42, ar: 0.58, dash: 10, gap:  9, spd:  0.13, ph: 2.2, a: 0.46 },
  { f: 0.55, ar: 0.58, dash: 12, gap: 11, spd: -0.09, ph: 3.3, a: 0.36 },
  { f: 0.68, ar: 0.58, dash: 14, gap: 13, spd:  0.06, ph: 4.4, a: 0.26 },
  { f: 0.82, ar: 0.58, dash: 16, gap: 15, spd: -0.04, ph: 5.5, a: 0.17 },
  { f: 0.97, ar: 0.58, dash: 18, gap: 17, spd:  0.025,ph: 6.6, a: 0.09 },
] as const;

function startAnimation(canvas: HTMLCanvasElement): () => void {
  const ctx = canvas.getContext('2d')!;
  let W = 0, H = 0;

  const onResize = () => {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  };
  onResize();
  window.addEventListener('resize', onResize);

  const mouse = { x: -9999, y: -9999, active: false };
  const REPEL_RADIUS = 120;
  const REPEL_FORCE  = 3.5;
  const RETURN_EASE  = 0.04;
  const CURSOR_LINK  = 180;

  const onMouseMove = (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = e.clientX - rect.left;
    mouse.y = e.clientY - rect.top;
    mouse.active = true;
  };
  const onMouseLeave = () => { mouse.active = false; mouse.x = -9999; mouse.y = -9999; };
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseleave', onMouseLeave);

  const PARTICLE_N = 110;
  const MAX_LINK   = 150;
  let dots: Dot[] = [];

  const spawnDots = () => {
    dots = Array.from({ length: PARTICLE_N }, () => {
      const bvx = (Math.random() - 0.5) * 0.56;
      const bvy = (Math.random() - 0.5) * 0.56;
      return { x: Math.random() * W, y: Math.random() * H, vx: bvx, vy: bvy, bvx, bvy, r: Math.random() * 1.2 + 0.4 };
    });
  };
  spawnDots();

  let raf: number;
  let t0: number | null = null;

  const tick = (ts: number) => {
    if (t0 === null) t0 = ts;
    const t = (ts - t0) / 1000;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#050c08';
    ctx.fillRect(0, 0, W, H);

    const cx = W / 2;
    const cy = H / 2;
    const base = Math.max(W, H) * 0.65;

    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, base * 0.9);
    glow.addColorStop(0,    `rgba(${G},.13)`);
    glow.addColorStop(0.40, `rgba(${G},.05)`);
    glow.addColorStop(1,    `rgba(${G},0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    for (const ring of RING_DEFS) {
      const rx    = ring.f * base;
      const ry    = rx * ring.ar;
      const angle = t * ring.spd + ring.ph;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      ctx.scale(1, ry / rx);
      ctx.beginPath();
      ctx.arc(0, 0, rx, 0, Math.PI * 2);
      ctx.setLineDash([ring.dash, ring.gap]);
      ctx.strokeStyle = `rgba(${G},${ring.a})`;
      ctx.lineWidth   = 1.6;
      ctx.stroke();
      ctx.restore();
    }

    for (const p of dots) {
      p.vx += (p.bvx - p.vx) * RETURN_EASE;
      p.vy += (p.bvy - p.vy) * RETURN_EASE;

      if (mouse.active) {
        const dx = p.x - mouse.x;
        const dy = p.y - mouse.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < REPEL_RADIUS && dist > 0.5) {
          const force = (1 - dist / REPEL_RADIUS) * REPEL_FORCE;
          p.vx += (dx / dist) * force;
          p.vy += (dy / dist) * force;
        }
      }

      const spd = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
      if (spd > 6) { p.vx = (p.vx / spd) * 6; p.vy = (p.vy / spd) * 6; }

      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0) p.x = W; else if (p.x > W) p.x = 0;
      if (p.y < 0) p.y = H; else if (p.y > H) p.y = 0;
    }

    ctx.setLineDash([]);
    for (let i = 0; i < dots.length; i++) {
      for (let j = i + 1; j < dots.length; j++) {
        const dx = dots[i].x - dots[j].x;
        const dy = dots[i].y - dots[j].y;
        const d  = Math.sqrt(dx * dx + dy * dy);
        if (d < MAX_LINK) {
          ctx.beginPath();
          ctx.moveTo(dots[i].x, dots[i].y);
          ctx.lineTo(dots[j].x, dots[j].y);
          ctx.strokeStyle = `rgba(${G},${(1 - d / MAX_LINK) * 0.16})`;
          ctx.lineWidth   = 0.7;
          ctx.stroke();
        }
      }
    }

    if (mouse.active) {
      for (const p of dots) {
        const dx = p.x - mouse.x;
        const dy = p.y - mouse.y;
        const d  = Math.sqrt(dx * dx + dy * dy);
        if (d < CURSOR_LINK) {
          const alpha = (1 - d / CURSOR_LINK) * 0.55;
          ctx.beginPath();
          ctx.moveTo(mouse.x, mouse.y);
          ctx.lineTo(p.x, p.y);
          ctx.strokeStyle = `rgba(${G},${alpha})`;
          ctx.lineWidth   = 1.1;
          ctx.stroke();
        }
      }

      const pulseR = REPEL_RADIUS * (0.82 + Math.sin(t * 3.5) * 0.08);
      const cursorGlow = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, pulseR);
      cursorGlow.addColorStop(0,   `rgba(${G},0.18)`);
      cursorGlow.addColorStop(0.5, `rgba(${G},0.06)`);
      cursorGlow.addColorStop(1,   `rgba(${G},0)`);
      ctx.fillStyle = cursorGlow;
      ctx.beginPath();
      ctx.arc(mouse.x, mouse.y, pulseR, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.arc(mouse.x, mouse.y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${G},0.9)`;
      ctx.fill();
    }

    for (const p of dots) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${G},.40)`;
      ctx.fill();
    }

    raf = requestAnimationFrame(tick);
  };

  raf = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
    canvas.removeEventListener('mousemove', onMouseMove);
    canvas.removeEventListener('mouseleave', onMouseLeave);
  };
}

// ── Component ─────────────────────────────────────────────────────────────────
export const Login: React.FC = () => {
  const { login, error } = useAuth();
  const [email,      setEmail]      = useState('');
  const [password,   setPassword]   = useState('');
  const [loading,    setLoading]    = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [resetSent,  setResetSent]  = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return startAnimation(canvas);
  }, []);

  const resolveEmail = (input: string) => {
    const trimmed = input.trim();
    if (trimmed.includes('@')) return trimmed;
    return `${trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '.')}@sosun-fihaara.internal`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    if (!email || !password) return;
    setLoading(true);
    try {
      await login(resolveEmail(email), password);
    } catch (err) {
      console.error('Authentication failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    setLocalError(null);
    if (!email) {
      setLocalError('Enter your username or email above, then click Forgot Password.');
      return;
    }
    const resolved = resolveEmail(email);
    if (!resolved.includes('@sosun-fihaara.internal')) {
      try {
        await sendPasswordResetEmail(auth, resolved);
        setResetSent(true);
      } catch (err: any) {
        setLocalError(err.message || 'Could not send reset email.');
      }
    } else {
      setLocalError('Password reset is not available for internal accounts. Contact your administrator.');
    }
  };

  const displayError = localError || error;

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <canvas
        ref={canvasRef}
        style={{ position: 'fixed', inset: 0, zIndex: 0, display: 'block', pointerEvents: 'all' }}
      />
      <div style={{
        position: 'relative', zIndex: 1, width: '100%', maxWidth: '400px', margin: '0 16px',
        backgroundColor: 'rgba(5, 14, 8, 0.78)',
        backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
        borderRadius: '16px', border: '1px solid rgba(34,197,94,0.18)',
        boxShadow: '0 0 60px rgba(34,197,94,0.08), 0 24px 64px rgba(0,0,0,0.7)',
        padding: '40px 36px 32px', pointerEvents: 'all',
      }}>
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div style={{
            width: '52px', height: '52px', borderRadius: '14px', margin: '0 auto 14px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '17px', fontWeight: 800, color: '#22c55e',
            background: 'rgba(34,197,94,0.10)', border: '1px solid rgba(34,197,94,0.28)',
            boxShadow: '0 0 20px rgba(34,197,94,0.12)', letterSpacing: '0.5px',
          }}>SF</div>
          <h2 style={{ fontSize: '20px', fontWeight: 800, color: '#e8f5ea', margin: 0 }}>Sosun Fihaara</h2>
          <p style={{ fontSize: '13px', color: 'rgba(134,194,150,0.65)', margin: '4px 0 0' }}>Marketing Operations Planner</p>
        </div>

        {displayError && (
          <div className="auth-error-alert" style={{ marginBottom: '16px' }}>
            <ShieldAlert size={16} style={{ flexShrink: 0 }} />
            <span>{displayError}</span>
          </div>
        )}

        {resetSent && (
          <div className="auth-error-alert" style={{ background: 'rgba(22,163,74,0.12)', borderColor: 'rgba(34,197,94,0.35)', color: '#4ade80', marginBottom: '16px' }}>
            <CheckCircle2 size={16} style={{ flexShrink: 0 }} />
            <span>Password reset email sent. Check your inbox.</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label style={{ fontSize: '11px', fontWeight: 700, color: 'rgba(134,194,150,0.75)', display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Name or Email
            </label>
            <div className="auth-input-group">
              <Mail size={15} className="auth-input-icon" style={{ color: 'rgba(34,197,94,0.55)' }} />
              <input
                type="text"
                placeholder="Username or Email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="username"
                className="auth-input"
                style={{ background: 'rgba(255,255,255,0.04)', borderColor: 'rgba(34,197,94,0.18)', color: '#e8f5ea' }}
              />
            </div>
          </div>

          <div className="form-group">
            <label style={{ fontSize: '11px', fontWeight: 700, color: 'rgba(134,194,150,0.75)', display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Password
            </label>
            <div className="auth-input-group">
              <Lock size={15} className="auth-input-icon" style={{ color: 'rgba(34,197,94,0.55)' }} />
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className="auth-input"
                style={{ background: 'rgba(255,255,255,0.04)', borderColor: 'rgba(34,197,94,0.18)', color: '#e8f5ea' }}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="auth-submit-btn"
            style={{
              background: loading ? 'rgba(34,197,94,0.6)' : 'rgba(34,197,94,0.85)',
              border: '1px solid rgba(34,197,94,0.4)',
              boxShadow: '0 0 20px rgba(34,197,94,0.2)',
              marginTop: '8px',
            }}
          >
            {loading ? <RefreshCw className="spinning-anim" size={16} /> : <Key size={16} />}
            <span>{loading ? 'Signing In...' : 'Sign In'}</span>
          </button>

          <div style={{ textAlign: 'center', marginTop: '14px' }}>
            <button
              type="button"
              onClick={handleForgotPassword}
              style={{ background: 'none', border: 'none', color: 'rgba(74,222,128,0.75)', fontSize: '12px', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
            >
              Forgot password?
            </button>
          </div>
        </form>

        <p style={{ textAlign: 'center', fontSize: '11px', color: 'rgba(100,150,110,0.45)', marginTop: '24px', marginBottom: 0 }}>
          Don't have an account? Contact your administrator.
        </p>
      </div>
    </div>
  );
};
