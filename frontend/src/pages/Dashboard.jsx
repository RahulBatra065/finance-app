import { useState, useEffect, useCallback, useRef } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, Legend,
} from 'recharts'
import api from '../api.js'

const COLORS = ['#6366F1', '#22C55E', '#F59E0B', '#F43F5E', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316', '#64748B', '#06B6D4']

function useCountUp(target, duration = 800) {
  const [value, setValue] = useState(0)
  const frameRef = useRef(null)
  const prevTarget = useRef(0)

  useEffect(() => {
    if (target == null || isNaN(target)) { setValue(target ?? 0); return }
    const start = prevTarget.current
    prevTarget.current = target
    const startTime = performance.now()
    function tick(now) {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3)
      setValue(start + (target - start) * eased)
      if (progress < 1) frameRef.current = requestAnimationFrame(tick)
    }
    if (frameRef.current) cancelAnimationFrame(frameRef.current)
    frameRef.current = requestAnimationFrame(tick)
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current) }
  }, [target, duration])

  return value
}

function AnimatedStat({ value, className, style }) {
  const animated = useCountUp(value)
  return <div className={className} style={style}>{fmt(animated)}</div>
}

function fmt(n) {
  if (n == null) return '₹0'
  const abs = Math.abs(n)
  if (abs >= 10000000) return `₹${(n / 10000000).toFixed(1)}Cr`
  if (abs >= 100000) return `₹${(n / 100000).toFixed(1)}L`
  if (abs >= 1000) return `₹${(n / 1000).toFixed(1)}K`
  return `₹${Number(n).toFixed(0)}`
}

function BudgetBar({ label, spent, budget, currency = '₹' }) {
  const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0
  const over = budget > 0 && spent > budget
  const colorClass = pct >= 90 ? 'progress-bar-danger' : pct >= 70 ? 'progress-bar-warning' : 'progress-bar-success'

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{label}</span>
        <span style={{ fontSize: 12, color: over ? 'var(--danger)' : 'var(--text-secondary)' }}>
          {currency}{Number(spent).toFixed(0)} / {currency}{Number(budget).toFixed(0)}{' '}
          <strong style={{ color: pct >= 90 ? 'var(--danger)' : pct >= 70 ? 'var(--warning)' : 'var(--text-secondary)' }}>
            ({Math.round((spent / budget) * 100)}%)
          </strong>
        </span>
      </div>
      <div className="progress-bar-container">
        <div
          className={`progress-bar ${colorClass}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

const PERIODS = [
  { label: 'This Week', value: 'week' },
  { label: 'This Month', value: 'month' },
  { label: '3 Months', value: '3months' },
  { label: '12 Months', value: 'year' },
]

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', boxShadow: 'var(--shadow-md)' }}>
      <p style={{ fontWeight: 600, marginBottom: 4, fontSize: 13 }}>{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ fontSize: 13, color: p.color }}>
          {p.name}: ₹{Number(p.value).toLocaleString('en-IN')}
        </p>
      ))}
    </div>
  )
}

function SplitRow({ split, isLast, onSettled }) {
  const [settling, setSettling] = useState(false)
  const [amount, setAmount] = useState('')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef(null)

  async function handleSettle() {
    const val = parseFloat(amount)
    if (!val || val <= 0) return
    setSaving(true)
    try {
      await import('../api.js').then(m => m.default.patch(`/expenses/splits/${split.id}/settle`, { amount_received: val }))
      onSettled()
    } finally {
      setSaving(false)
      setSettling(false)
      setAmount('')
    }
  }

  const outstanding = split.amount_outstanding ?? (split.amount_owed - split.amount_received)
  const statusColor = split.status === 'partial' ? 'var(--warning, #F59E0B)' : 'var(--text-secondary)'

  return (
    <div style={{
      padding: '12px 0',
      borderBottom: isLast ? 'none' : '1px solid var(--border)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 500 }}>
            {split.transaction?.vendor ?? 'Unknown'} · {split.total_people} people
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
            {split.notes && <span>{split.notes} · </span>}
            <span style={{ color: statusColor }}>
              {split.status === 'partial' ? 'Partial · ' : ''}
            </span>
            Owed {fmt(outstanding)} of {fmt(split.amount_owed)}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--success)' }}>+{fmt(outstanding)}</span>
          {!settling ? (
            <button className="btn btn-sm btn-secondary" onClick={() => { setSettling(true); setTimeout(() => inputRef.current?.focus(), 50) }}>
              Settle
            </button>
          ) : (
            <>
              <input
                ref={inputRef}
                type="number" step="0.01" min="0"
                className="input" placeholder={`Max ${outstanding}`}
                value={amount} onChange={e => setAmount(e.target.value)}
                style={{ width: 90, padding: '4px 8px', fontSize: 13 }}
                onKeyDown={e => e.key === 'Enter' && handleSettle()}
              />
              <button className="btn btn-sm btn-primary" onClick={handleSettle} disabled={saving}>
                {saving ? '…' : '✓'}
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => { setSettling(false); setAmount('') }}>✕</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const [overview, setOverview] = useState(null)
  const [analytics, setAnalytics] = useState(null)
  const [period, setPeriod] = useState('month')
  const [loading, setLoading] = useState(true)
  const [analyticsLoading, setAnalyticsLoading] = useState(false)
  const [error, setError] = useState('')

  const fetchOverview = useCallback(async () => {
    try {
      const res = await api.get('/expenses/dashboard')
      setOverview(res.data)
    } catch (err) {
      setError('Failed to load dashboard data.')
    }
  }, [])

  const fetchAnalytics = useCallback(async (p) => {
    setAnalyticsLoading(true)
    try {
      const res = await api.get(`/expenses/analytics?period=${p}`)
      setAnalytics(res.data)
    } catch {
      // silently fail chart
    } finally {
      setAnalyticsLoading(false)
    }
  }, []) // stable — takes period as argument, no deps needed

  useEffect(() => {
    setLoading(true)
    fetchOverview().finally(() => setLoading(false))
  }, [fetchOverview])

  useEffect(() => {
    fetchAnalytics(period)
  }, [period]) // fetchAnalytics is stable, omit to avoid spurious re-runs

  if (loading) {
    return (
      <div className="loading-center">
        <div className="spinner" />
        <span>Loading dashboard...</span>
      </div>
    )
  }

  // Parse data from API
  const totalIn = overview?.total_in ?? overview?.total_credit ?? 0
  const totalOut = overview?.total_out ?? overview?.total_debit ?? 0
  const ccOutstanding = overview?.cc_outstanding ?? 0
  const netBalance = overview?.net_balance ?? (totalIn - totalOut - ccOutstanding)
  const avgDailySpend = overview?.avg_daily_spend ?? 0
  const pendingSplitsReceivable = overview?.pending_splits_receivable ?? 0
  const pendingSplits = overview?.pending_splits ?? []
  const budgets = overview?.budget_status ?? overview?.budgets ?? []
  const recentTxns = overview?.recent_transactions ?? overview?.recent ?? []
  const quickStats = overview?.quick_stats ?? {}
  const alerts = overview?.budget_alerts ?? []

  const periodStart = overview?.period?.start
  const periodEnd = overview?.period?.end
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''
  const periodLabel = periodStart
    ? `Pay period: ${fmtDate(periodStart)} – ${fmtDate(periodEnd)}`
    : null

  // Chart data
  const categoryData = analytics?.category_breakdown ?? analytics?.by_category ?? []
  const monthlyData = analytics?.monthly_trend ?? analytics?.monthly ?? []
  const chartBarData = categoryData.map(item => ({
    name: item.category ?? item.name,
    amount: item.amount ?? item.total,
  }))
  const chartLineData = monthlyData.map(item => ({
    name: item.month ?? item.label,
    amount: item.amount ?? item.total,
  }))

  return (
    <div>
      {/* Budget alerts */}
      {alerts.map((a, i) => (
        <div key={i} className="alert alert-warning">
          <span>⚠️</span>
          <span>Budget Alert: <strong>{a.category}</strong> is at <strong>{Math.round(a.percentage ?? a.pct)}%</strong> of limit</span>
        </div>
      ))}

      {error && (
        <div className="alert alert-danger">{error}</div>
      )}

      {/* Pay period label */}
      {periodLabel && (
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14, fontWeight: 500 }}>
          📅 {periodLabel}
        </div>
      )}

      {/* Overview stats */}
      <div className="stats-grid" style={{ marginBottom: 24 }}>
        <div className="stat-card animate-in" style={{ animationDelay: '0ms' }}>
          <div className="stat-label">Total In</div>
          <AnimatedStat value={totalIn} className="stat-value positive" />
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>Credits this pay period</div>
        </div>
        <div className="stat-card animate-in" style={{ animationDelay: '60ms' }}>
          <div className="stat-label">Total Out</div>
          <AnimatedStat value={totalOut} className="stat-value negative" />
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>Debits this pay period</div>
        </div>
        <div className="stat-card animate-in" style={{ animationDelay: '120ms' }}>
          <div className="stat-label">Net Balance</div>
          <AnimatedStat value={netBalance} className={`stat-value ${netBalance >= 0 ? 'positive' : 'negative'}`} />
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
            In - Out{ccOutstanding > 0 ? ` − CC ${fmt(ccOutstanding)}` : ''}
          </div>
        </div>
        <div className="stat-card animate-in" style={{ animationDelay: '180ms' }}>
          <div className="stat-label">Avg Daily Spend</div>
          <AnimatedStat value={avgDailySpend} className="stat-value" style={{ fontSize: 22 }} />
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>Per day this period</div>
        </div>
      </div>

      {/* Pending splits */}
      {pendingSplits.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div className="section-title" style={{ marginBottom: 0 }}>Pending Splits</div>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--success)' }}>
              +{fmt(pendingSplitsReceivable)} receivable
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {pendingSplits.map((split, i) => (
              <SplitRow
                key={split.id}
                split={split}
                isLast={i === pendingSplits.length - 1}
                onSettled={() => fetchOverview()}
              />
            ))}
          </div>
        </div>
      )}

      {/* Two-column layout for desktop */}
      <div style={{ display: 'grid', gap: 20, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', marginBottom: 20 }}>

        {/* Budget Status */}
        {budgets.length > 0 && (
          <div className="card">
            <div className="section-title">Budget Status</div>
            {budgets.map((b, i) => (
              <BudgetBar
                key={i}
                label={b.category ?? b.name}
                spent={b.spent ?? b.amount ?? 0}
                budget={b.budget ?? b.limit ?? 0}
              />
            ))}
          </div>
        )}

        {/* Quick Stats */}
        <div className="card">
          <div className="section-title">Quick Stats</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[
              {
                label: 'Most Frequent Vendor',
                value: quickStats.most_frequent_vendor ?? quickStats.top_vendor ?? '—',
                icon: '🏪',
              },
              {
                label: 'Top Spending Category',
                value: quickStats.top_category ?? quickStats.top_spending_category ?? '—',
                icon: '📊',
              },
              {
                label: 'Transaction Count',
                value: quickStats.transaction_count ?? overview?.transaction_count ?? '—',
                icon: '🔢',
              },
            ].map((stat, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    background: 'var(--bg-secondary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 18,
                    flexShrink: 0,
                  }}
                >
                  {stat.icon}
                </div>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 2 }}>{stat.label}</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{stat.value}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Category breakdown chart */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <div className="section-title" style={{ marginBottom: 0 }}>Category Breakdown</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {PERIODS.map(p => (
              <button
                key={p.value}
                className={`btn btn-sm ${period === p.value ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setPeriod(p.value)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        {analyticsLoading ? (
          <div className="loading-center" style={{ padding: '40px 0' }}><div className="spinner" /></div>
        ) : chartBarData.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📊</div>
            <h3>No data yet</h3>
            <p>Transactions will appear here once recorded.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 20 }}>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartBarData} margin={{ top: 5, right: 10, left: -10, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11, fill: 'var(--text-secondary)' }}
                  angle={-35}
                  textAnchor="end"
                  interval={0}
                />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} tickFormatter={v => `₹${v >= 1000 ? `${(v/1000).toFixed(0)}K` : v}`} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="amount" fill="var(--accent)" radius={[4, 4, 0, 0]}>
                  {chartBarData.map((_, index) => (
                    <Cell key={index} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>

            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={chartBarData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  dataKey="amount"
                  nameKey="name"
                  paddingAngle={2}
                >
                  {chartBarData.map((_, index) => (
                    <Cell key={index} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => `₹${Number(v).toLocaleString('en-IN')}`} />
                <Legend
                  formatter={(value) => <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{value}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Monthly trend */}
      {chartLineData.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="section-title">Monthly Spending Trend</div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartLineData} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} tickFormatter={v => `₹${v >= 1000 ? `${(v/1000).toFixed(0)}K` : v}`} />
              <Tooltip content={<CustomTooltip />} />
              <Line
                type="monotone"
                dataKey="amount"
                name="Spend"
                stroke="var(--accent)"
                strokeWidth={2.5}
                dot={{ r: 4, fill: 'var(--accent)', strokeWidth: 0 }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Recent transactions */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div className="section-title" style={{ marginBottom: 0 }}>Recent Transactions</div>
          <a href="/transactions" style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 500 }}>View all →</a>
        </div>

        {recentTxns.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">💳</div>
            <h3>No transactions yet</h3>
            <p>Transactions will appear here once received.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {recentTxns.slice(0, 5).map((txn, i) => {
              const isCredit = (txn.direction ?? txn.type) === 'credit'
              const date = txn.date ? new Date(txn.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : ''
              return (
                <div
                  key={txn.id ?? i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 0',
                    borderBottom: i < recentTxns.slice(0, 5).length - 1 ? '1px solid var(--border)' : 'none',
                    gap: 12,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                    <div
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: 10,
                        background: isCredit ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 16,
                        flexShrink: 0,
                      }}
                    >
                      {isCredit ? '↓' : '↑'}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {txn.vendor ?? txn.description ?? 'Unknown'}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 1 }}>
                        {txn.category ?? 'Uncategorized'} · {date}
                      </div>
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: 15,
                      fontWeight: 600,
                      color: isCredit ? 'var(--success)' : 'var(--danger)',
                      flexShrink: 0,
                    }}
                  >
                    {isCredit ? '+' : '-'}₹{Number(txn.amount ?? 0).toLocaleString('en-IN')}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
