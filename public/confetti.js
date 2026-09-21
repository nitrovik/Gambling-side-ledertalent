function createConfetti(canvas) {
  const ctx = canvas.getContext('2d');
  const COLORS = ['#f6b9e2', '#f6dd90', '#9db6ce', '#a8c29e', '#ff3b5c', '#ffffff'];
  let particles = [];
  let raf = null;

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  function loop() {
    function tick(now) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles = particles.filter((p) => now < p.deathTime);
      particles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += p.gravity;
        p.rot += p.vRot;
        const life = Math.max(0, (p.deathTime - now) / p.lifespan);
        ctx.save();
        ctx.globalAlpha = life;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 0.6);
        ctx.restore();
      });
      if (particles.length > 0) {
        raf = requestAnimationFrame(tick);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        raf = null;
      }
    }
    if (!raf) raf = requestAnimationFrame(tick);
  }

  // Rain confetti from the top of the screen (match reveals, sluttresultat).
  function fire(count) {
    const now = performance.now();
    const lifespan = 3200;
    const fresh = Array.from({ length: count || 140 }, () => ({
      x: Math.random() * canvas.width,
      y: -20 - Math.random() * canvas.height * 0.3,
      r: 4 + Math.random() * 5,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      vy: 2 + Math.random() * 3,
      vx: -1.5 + Math.random() * 3,
      gravity: 0,
      rot: Math.random() * Math.PI,
      vRot: -0.1 + Math.random() * 0.2,
      lifespan,
      deathTime: now + lifespan,
    }));
    particles.push(...fresh);
    loop();
  }

  // Radial burst of particles from a single point (the "punch" tap effect).
  function burst(x, y, color, count) {
    const now = performance.now();
    const lifespan = 650;
    const fresh = Array.from({ length: count || 16 }, () => {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 5;
      return {
        x,
        y,
        r: 3 + Math.random() * 4,
        color: color || COLORS[Math.floor(Math.random() * COLORS.length)],
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        gravity: 0.2,
        rot: Math.random() * Math.PI,
        vRot: -0.3 + Math.random() * 0.6,
        lifespan,
        deathTime: now + lifespan,
      };
    });
    particles.push(...fresh);
    loop();
  }

  return { fire, burst };
}
