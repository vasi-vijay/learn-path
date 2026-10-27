import React, { useState, useEffect } from 'react';
import { ShieldCheck, RefreshCw, X, AlertTriangle, CheckCircle, Clock, DollarSign, Users, FileText, ArrowUpRight } from 'lucide-react';
import { auth } from '../lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';

export default function AdminPortal() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'audit' | 'orders' | 'stats'>('stats');
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<any>(null);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [refundReason, setRefundReason] = useState('');
  const [refundingOrderId, setRefundingOrderId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Check verified admin identity against the backend
  useEffect(() => {
    const ADMIN_EMAILS = ['vasivenkatavijay@gmail.com', 'made.by.vijayy@gmail.com'];
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      const userEmail = currentUser?.email?.toLowerCase().trim();
      if (currentUser && userEmail && ADMIN_EMAILS.includes(userEmail)) {
        try {
          const token = await currentUser.getIdToken();
          const res = await fetch('/api/auth/verify-session', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            }
          });
          if (res.ok) {
            const data = await res.json();
            if (data.user?.isAdmin) {
              setIsAdmin(true);
            } else {
              setIsAdmin(false);
            }
          } else {
            setIsAdmin(false);
          }
        } catch {
          setIsAdmin(false);
        }
      } else {
        setIsAdmin(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const fetchAdminData = async () => {
    if (!user) return;
    setLoading(true);
    setMessage(null);
    try {
      const token = await user.getIdToken();
      const [statsRes, logsRes] = await Promise.all([
        fetch('/api/admin/stats', {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch('/api/admin/audit-logs', {
          headers: { 'Authorization': `Bearer ${token}` }
        })
      ]);

      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData.stats);
      }
      if (logsRes.ok) {
        const logsData = await logsRes.json();
        setAuditLogs(logsData.logs || []);
      }
    } catch (err: any) {
      setMessage('Failed to fetch administrative data: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && isAdmin) {
      fetchAdminData();
    }
  }, [isOpen, isAdmin]);

  const handleRefund = async (orderId: string) => {
    if (!user) return;
    setRefundingOrderId(orderId);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/admin/refund', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          orderId,
          reason: refundReason || 'Refund authorized by Administrator'
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setMessage('Refund processed successfully for order: ' + orderId);
        setRefundReason('');
        await fetchAdminData();
      } else {
        setMessage('Refund failed: ' + (data.error || 'Unknown error'));
      }
    } catch (err: any) {
      setMessage('Error processing refund: ' + err.message);
    } finally {
      setRefundingOrderId(null);
    }
  };

  if (!isAdmin) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-[99999] font-sans antialiased text-sm">
      {/* Floating Admin Badge */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="flex items-center gap-2.5 px-4 py-2.5 rounded-full bg-zinc-950/95 text-white border border-emerald-500/50 shadow-[0_8px_30px_rgba(16,185,129,0.3)] backdrop-blur-md hover:scale-105 hover:border-emerald-400 transition-all cursor-pointer group"
          title="Open Administrator Console (vasivenkatavijay@gmail.com)"
        >
          <div className="relative flex items-center justify-center">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping absolute" />
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 relative" />
          </div>
          <ShieldCheck className="w-4 h-4 text-emerald-400 group-hover:rotate-12 transition-transform" />
          <div className="text-left flex flex-col">
            <span className="text-[9px] text-emerald-400 uppercase font-mono tracking-wider font-extrabold leading-none">
              Admin Verified
            </span>
            <span className="text-xs font-bold text-white leading-tight">
              Control Center
            </span>
          </div>
        </button>
      )}

      {/* Admin Control Center Modal */}
      {isOpen && (
        <div className="w-[94vw] sm:w-[580px] max-h-[88vh] overflow-y-auto rounded-3xl bg-zinc-950/98 text-zinc-100 border border-zinc-800 shadow-[0_25px_70px_rgba(0,0,0,0.85)] backdrop-blur-2xl p-5 flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-200">
          {/* Header */}
          <div className="flex items-start justify-between border-b border-zinc-800/80 pb-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-sm">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-extrabold text-base tracking-tight text-white flex items-center gap-2">
                  Administrator Console
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-mono">
                    Authorized
                  </span>
                </h3>
                <p className="text-xs text-zinc-400 font-mono">
                  {user?.email}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={fetchAdminData}
                disabled={loading}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
                title="Refresh Data"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center gap-1.5 p-1 bg-black/60 rounded-xl border border-zinc-800">
            <button
              onClick={() => setActiveTab('stats')}
              className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                activeTab === 'stats' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
              }`}
            >
              <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
              Overview
            </button>
            <button
              onClick={() => setActiveTab('audit')}
              className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                activeTab === 'audit' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
              }`}
            >
              <FileText className="w-3.5 h-3.5 text-blue-400" />
              Security Audit ({auditLogs.length})
            </button>
          </div>

          {message && (
            <div className="p-3 rounded-xl bg-blue-950/40 border border-blue-500/30 text-xs text-blue-200 flex items-center justify-between">
              <span>{message}</span>
              <button onClick={() => setMessage(null)} className="text-zinc-400 hover:text-white">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Tab 1: Stats & Overview */}
          {activeTab === 'stats' && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3.5 rounded-2xl bg-zinc-900/80 border border-zinc-800 text-center">
                  <span className="text-[10px] text-zinc-500 uppercase font-mono font-bold block">Paid Orders</span>
                  <span className="text-xl font-black text-emerald-400">{stats?.paidOrders ?? 0}</span>
                </div>
                <div className="p-3.5 rounded-2xl bg-zinc-900/80 border border-zinc-800 text-center">
                  <span className="text-[10px] text-zinc-500 uppercase font-mono font-bold block">Pro Members</span>
                  <span className="text-xl font-black text-blue-400">{stats?.proMembersCount ?? 0}</span>
                </div>
                <div className="p-3.5 rounded-2xl bg-zinc-900/80 border border-zinc-800 text-center">
                  <span className="text-[10px] text-zinc-500 uppercase font-mono font-bold block">Revenue</span>
                  <span className="text-xl font-black text-white">₹{stats?.totalRevenueINR ?? 0}</span>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-zinc-900/60 border border-zinc-800 space-y-2">
                <div className="text-xs font-bold text-white flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-emerald-400" />
                    Firebase Database & Configuration
                  </div>
                  <a
                    href="https://console.firebase.google.com/project/copper-circle-lds98/firestore/databases/ai-studio-08ed8d06-1a88-41fd-9a21-86f1b17bb938/data"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1 font-mono hover:underline"
                  >
                    Open in Console <ArrowUpRight className="w-3 h-3" />
                  </a>
                </div>
                <div className="text-xs text-zinc-300 font-mono space-y-1 bg-black/40 p-2.5 rounded-xl border border-zinc-800/80 select-all">
                  <div><span className="text-zinc-500">Project ID:</span> copper-circle-lds98</div>
                  <div><span className="text-zinc-500">Database ID:</span> ai-studio-08ed8d06-1a88-41fd-9a21-86f1b17bb938</div>
                </div>
                <ul className="text-xs text-zinc-400 space-y-1 font-mono pt-1">
                  <li>• Server-side rate limiter: ACTIVE (10 req/min payments, 30 req/min auth)</li>
                  <li>• Razorpay HMAC-SHA256 signature verification: ACTIVE</li>
                  <li>• Webhook payload integrity validation: ACTIVE</li>
                  <li>• Administrator allowlist: vasivenkatavijay@gmail.com</li>
                </ul>
              </div>
            </div>
          )}

          {/* Tab 2: Security Audit Trail */}
          {activeTab === 'audit' && (
            <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
              {auditLogs.length === 0 ? (
                <div className="p-8 text-center text-xs text-zinc-500">No security audit logs recorded yet.</div>
              ) : (
                auditLogs.map((log) => (
                  <div
                    key={log.id}
                    className="p-3 rounded-xl bg-zinc-900/70 border border-zinc-800/80 text-xs font-mono space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className={`font-bold ${log.status === 'SUCCESS' ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {log.action}
                      </span>
                      <span className="text-[10px] text-zinc-500">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="text-[11px] text-zinc-300">
                      Actor: {log.actorEmail} ({log.ip})
                    </div>
                    {log.details && (
                      <div className="text-[10px] text-zinc-500 truncate">
                        {JSON.stringify(log.details)}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
