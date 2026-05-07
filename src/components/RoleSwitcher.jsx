import { useState, useRef, useEffect } from 'react';

const ROLE_META = {
  admin: { label: 'Admin', color: '#EF4444', route: '#/admin' },
  commentator: { label: 'Commentator', color: '#10B981', route: '#/record' },
  coach: { label: 'Coach', color: '#8B5CF6', route: '#/coach' },
};

export default function RoleSwitcher({ currentUser, onSwitch }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const roles = currentUser?.roles || [currentUser?.role];
  const activeRole = currentUser?.role;
  const meta = ROLE_META[activeRole] || { label: activeRole, color: '#64748B' };

  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('click', close, true);
    return () => document.removeEventListener('click', close, true);
  }, [open]);

  // Only show switcher if user has multiple roles
  if (!roles || roles.length <= 1) {
    return (
      <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 99, background: meta.color + "22", color: meta.color, fontWeight: 700 }}>
        {meta.label}
      </span>
    );
  }

  return (
    <span ref={ref} style={{ position: "relative", display: "inline-flex" }}>
      <span onClick={() => setOpen(!open)} style={{
        fontSize: 9, padding: "2px 6px", borderRadius: 99, cursor: "pointer", userSelect: "none",
        background: meta.color + "22", color: meta.color, fontWeight: 700,
        border: open ? `1px solid ${meta.color}44` : "1px solid transparent",
        display: "inline-flex", alignItems: "center", gap: 3,
      }}>
        {meta.label} ▾
      </span>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 50,
          background: "#1E293B", borderRadius: 8, border: "1px solid #334155",
          boxShadow: "0 4px 12px rgba(0,0,0,0.4)", overflow: "hidden", minWidth: 130,
        }}>
          {roles.map(r => {
            const rm = ROLE_META[r] || { label: r, color: '#64748B', route: '' };
            const isActive = r === activeRole;
            return (
              <div key={r} onClick={() => { if (!isActive) { onSwitch(r); } setOpen(false); }}
                style={{
                  padding: "8px 12px", cursor: isActive ? "default" : "pointer",
                  display: "flex", alignItems: "center", gap: 6,
                  background: isActive ? rm.color + "11" : "transparent",
                }}>
                <div style={{ width: 6, height: 6, borderRadius: 3, background: rm.color, flexShrink: 0 }} />
                <div style={{ fontSize: 11, fontWeight: isActive ? 800 : 600, color: isActive ? rm.color : "#CBD5E1" }}>
                  {rm.label}
                </div>
                {isActive && <span style={{ fontSize: 9, color: "#64748B", marginLeft: "auto" }}>✓</span>}
              </div>
            );
          })}
        </div>
      )}
    </span>
  );
}

export { ROLE_META };
